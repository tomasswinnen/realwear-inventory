"""
github_update.py — Download NetSuite reports from OneDrive and upsert to Supabase.

Called by .github/workflows/daily-update.yml. Requires these env vars:
    SUPABASE_URL, SUPABASE_SERVICE_KEY
    MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET
    ONEDRIVE_USER   (UPN / email of the OneDrive owner, e.g. user@realwear.com)
    ONEDRIVE_FOLDER (optional, default: "NetSuite Reports")
"""

import os
import sys
import tempfile
from datetime import date, datetime

import msal
import requests
from lxml import etree
from supabase import create_client, Client

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL      = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
MS_TENANT_ID      = os.environ["MS_TENANT_ID"]
MS_CLIENT_ID      = os.environ["MS_CLIENT_ID"]
MS_CLIENT_SECRET  = os.environ["MS_CLIENT_SECRET"]
ONEDRIVE_USER     = os.environ["ONEDRIVE_USER"]   # e.g. tomas@realwear.com
ONEDRIVE_FOLDER   = os.environ.get("ONEDRIVE_FOLDER", "NetSuite Reports")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
today = date.today().isoformat()

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# ── Microsoft Graph auth ──────────────────────────────────────────────────────

def get_access_token() -> str:
    app = msal.ConfidentialClientApplication(
        MS_CLIENT_ID,
        authority=f"https://login.microsoftonline.com/{MS_TENANT_ID}",
        client_credential=MS_CLIENT_SECRET,
    )
    result = app.acquire_token_for_client(
        scopes=["https://graph.microsoft.com/.default"]
    )
    if "access_token" not in result:
        raise RuntimeError(
            f"MSAL auth failed: {result.get('error_description', result)}"
        )
    return result["access_token"]


def graph_get(token: str, url: str) -> dict:
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    return r.json()


# ── OneDrive download ──────────────────────────────────────────────────────────

# Name fragments used to identify each report; matched case-insensitively.
FILE_PATTERNS = {
    "valuation": ["inventoryvaluation", "inventorysummary"],
    "snapshot":  ["currentinventorysnapshot", "custominventorysnapshot"],
    "sales":     ["itemquantitysold", "itemqtysold"],
}


def _matches(name: str, patterns: list[str]) -> bool:
    normalised = name.lower().replace(" ", "").replace("_", "")
    return any(p in normalised for p in patterns)


def list_folder(token: str) -> list[dict]:
    url = (
        f"{GRAPH_BASE}/users/{ONEDRIVE_USER}/drive"
        f"/root:/{ONEDRIVE_FOLDER}:/children"
        "?$select=id,name,@microsoft.graph.downloadUrl"
        "&$top=100"
    )
    data = graph_get(token, url)
    return data.get("value", [])


def _download(token: str, item: dict, dest: str):
    dl_url = item.get("@microsoft.graph.downloadUrl")
    if dl_url:
        r = requests.get(dl_url, stream=True, timeout=120)
    else:
        item_id = item["id"]
        r = requests.get(
            f"{GRAPH_BASE}/users/{ONEDRIVE_USER}/drive/items/{item_id}/content",
            headers={"Authorization": f"Bearer {token}"},
            stream=True,
            timeout=120,
        )
    r.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in r.iter_content(chunk_size=65536):
            f.write(chunk)


def download_reports(token: str, tmpdir: str) -> dict[str, str]:
    """Download the 3 report files. Returns {key: local_path}."""
    items = list_folder(token)
    print(f"  {len(items)} items found in OneDrive/{ONEDRIVE_FOLDER}/")

    downloaded: dict[str, str] = {}
    for item in items:
        name = item.get("name", "")
        if not name.lower().endswith((".xls", ".xlsx")):
            continue
        for key, patterns in FILE_PATTERNS.items():
            if key not in downloaded and _matches(name, patterns):
                dest = os.path.join(tmpdir, name)
                print(f"  Downloading [{key}] {name}")
                _download(token, item, dest)
                downloaded[key] = dest
                break

    missing = [k for k in FILE_PATTERNS if k not in downloaded]
    if missing:
        print(f"  WARNING: no file matched for: {', '.join(missing)}")
    return downloaded


# ── XML parsing (NetSuite SpreadsheetML .xls) ─────────────────────────────────

NS = "{urn:schemas-microsoft-com:office:spreadsheet}"


def parse_xls_xml(path: str) -> list[list[str]]:
    with open(path, "rb") as f:
        content = f.read()
    parser = etree.XMLParser(recover=True, encoding="utf-8")
    root = etree.fromstring(content, parser=parser)
    ws = root.findall(f"{NS}Worksheet")[0]
    table = ws.find(f"{NS}Table")
    if table is None:
        return []
    result = []
    for row_el in table.findall(f"{NS}Row"):
        cells = row_el.findall(f"{NS}Cell")
        row_data: dict[int, str] = {}
        col = 0
        for c in cells:
            idx = c.get(f"{NS}Index")
            if idx:
                col = int(idx) - 1
            d = c.find(f"{NS}Data")
            row_data[col] = (d.text or "").strip() if d is not None else ""
            col += 1
        max_col = max(row_data.keys()) if row_data else -1
        result.append([row_data.get(i, "") for i in range(max_col + 1)])
    return result


def safe_int(v) -> int | None:
    try:
        return int(float(v)) if v and str(v).strip() not in ("", "nan") else None
    except (ValueError, TypeError):
        return None


def safe_float(v) -> float | None:
    try:
        return float(v) if v and str(v).strip() not in ("", "nan") else None
    except (ValueError, TypeError):
        return None


def is_valid_sku(v: str) -> bool:
    s = str(v).strip()
    if not s or s.lower() in ("nan", "none", "", "assembly/bill of materials"):
        return False
    if ":" in s:
        return False
    if s.startswith(("EarBud", "Flash Drive")):
        return False
    return any(c.isdigit() for c in s)


# ── Snapshot column layout (from update_inventory.py) ────────────────────────
COL_HK_ONHAND   = 75
COL_HK_ONORDER  = 76
COL_PDX_ONHAND  = 89
COL_PDX_ONORDER = 90
COL_TOT_ONHAND  = 208
COL_TOT_ONORDER = 209


# ── Readers ───────────────────────────────────────────────────────────────────

def read_valuation(path: str) -> tuple[list, dict, dict]:
    rows = parse_xls_xml(path)
    db_rows, ppu_by_sku, desc_by_sku = [], {}, {}
    for r in rows[8:]:
        sku = r[0].strip() if len(r) > 0 else ""
        if not is_valid_sku(sku):
            continue
        desc = r[1].strip() if len(r) > 1 and r[1] else None
        inv_value = safe_float(r[2]) if len(r) > 2 else None
        on_hand = safe_int(r[4]) if len(r) > 4 else None
        if desc:
            desc_by_sku[sku] = desc
        if inv_value and on_hand and on_hand > 0:
            ppu_by_sku[sku] = round(inv_value / on_hand, 4)
        db_rows.append({
            "sku": sku,
            "updated_at": today,
            "on_hand": on_hand or 0,
            "inv_value": inv_value or 0.0,
        })
    return db_rows, ppu_by_sku, desc_by_sku


def read_snapshot(path: str) -> tuple[list, dict]:
    rows = parse_xls_xml(path)
    db_rows, supplier_by_sku = [], {}
    for r in rows[8:]:
        sku = r[0].strip() if len(r) > 0 else ""
        if not is_valid_sku(sku):
            continue
        supplier = r[2].strip() if len(r) > 2 and r[2] else None
        if supplier:
            supplier_by_sku[sku] = supplier

        def col(idx, _r=r):
            return safe_int(_r[idx]) if idx < len(_r) and _r[idx] else None

        db_rows.append({
            "sku": sku,
            "updated_at": today,
            "on_hand_total":    col(COL_TOT_ONHAND)  or 0,
            "on_hand_portland": col(COL_PDX_ONHAND)  or 0,
            "on_hand_hk":       col(COL_HK_ONHAND)   or 0,
            "on_order":         col(COL_TOT_ONORDER)  or 0,
        })
    return db_rows, supplier_by_sku


def read_monthly_sales(path: str) -> list:
    rows = parse_xls_xml(path)
    if not rows:
        return []

    anchor: date | None = None
    for r in rows[1:]:
        raw = r[3] if len(r) > 3 else ""
        if raw:
            try:
                d = datetime.fromisoformat(raw.split("T")[0]).date()
                if anchor is None or d > anchor:
                    anchor = d
            except Exception:
                pass
    if anchor is None:
        anchor = date.today()
    current_month = anchor.replace(day=1)

    def month_str(offset: int) -> str:
        m = current_month.month - offset
        y = current_month.year
        while m <= 0:
            m += 12
            y -= 1
        return date(y, m, 1).isoformat()

    db_rows = []
    for r in rows[1:]:
        sku = r[1].strip() if len(r) > 1 else ""
        if not is_valid_sku(sku):
            continue
        for offset, col_idx in enumerate(range(5, min(18, len(r)))):
            qty = safe_int(r[col_idx])
            if qty is None:
                continue
            db_rows.append({"sku": sku, "month": month_str(offset), "qty_sold": qty})
    return db_rows


# ── DB helpers ─────────────────────────────────────────────────────────────────

def upsert(table: str, rows: list, conflict_col: str = None) -> int:
    if not rows:
        print(f"  {table}: 0 rows -- skipped")
        return 0
    kwargs = {"on_conflict": conflict_col} if conflict_col else {}
    supabase.table(table).upsert(rows, **kwargs).execute()
    print(f"  {table}: upserted {len(rows)} rows")
    return len(rows)


def cleanup_invalid_skus():
    child_tables = ["po_history", "inventory_valuation", "monthly_sales", "inventory_snapshot"]
    all_tables = child_tables + ["skus"]
    patterns = ["%:%", "EarBud%", "Flash Drive%"]
    total = 0
    for table in all_tables:
        for pattern in patterns:
            res = supabase.table(table).delete().like("sku", pattern).execute()
            if res.data:
                total += len(res.data)
    print(f"  cleanup_invalid_skus: {total} rows removed")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("=== RealWear Inventory Auto-Update ===")
    print(f"Date: {today}  |  OneDrive user: {ONEDRIVE_USER}\n")

    print("1. Authenticating with Microsoft Graph API...")
    token = get_access_token()
    print("   Auth OK\n")

    with tempfile.TemporaryDirectory() as tmpdir:
        print(f"2. Downloading files from OneDrive/{ONEDRIVE_FOLDER}/...")
        files = download_reports(token, tmpdir)
        print()

        if not files:
            print("ERROR: No report files downloaded. Check folder name and app permissions.")
            sys.exit(1)

        print("3. Cleaning up invalid SKUs...")
        cleanup_invalid_skus()
        print()

        val_rows:  list = []
        snap_rows: list = []
        sales_rows: list = []
        ppu_by_sku:  dict = {}
        desc_by_sku: dict = {}
        supplier_by_sku: dict = {}

        print("4. Parsing files...")
        if "valuation" in files:
            val_rows, ppu_by_sku, desc_by_sku = read_valuation(files["valuation"])
            print(f"   valuation:  {len(val_rows)} SKUs")

        if "snapshot" in files:
            snap_rows, supplier_by_sku = read_snapshot(files["snapshot"])
            print(f"   snapshot:   {len(snap_rows)} SKUs")

        if "sales" in files:
            sales_rows = read_monthly_sales(files["sales"])
            print(f"   sales:      {len(sales_rows)} records")
        print()

        # Build SKU parent rows
        all_skus = (
            {r["sku"] for r in val_rows}
            | {r["sku"] for r in snap_rows}
            | {r["sku"] for r in sales_rows}
        )
        sku_rows = [
            {
                "sku": sku,
                "description": desc_by_sku.get(sku),
                "supplier": supplier_by_sku.get(sku),
                "supplier_email": None,
                "lead_time_days": None,
                "moq": None,
                "unit_cost": ppu_by_sku.get(sku),
                "attach_rate": None,
            }
            for sku in sorted(all_skus)
        ]

        print("5. Upserting to Supabase...")
        totals = {
            "skus":                upsert("skus", sku_rows, conflict_col="sku"),
            "inventory_valuation": upsert("inventory_valuation", val_rows),
            "inventory_snapshot":  upsert("inventory_snapshot", snap_rows),
            "monthly_sales":       upsert("monthly_sales", sales_rows, conflict_col="sku,month"),
        }

    print("\n=== Summary ===")
    for table, count in totals.items():
        print(f"  {table:<26} {count:>5} rows")
    print("\nDone.")


if __name__ == "__main__":
    main()
