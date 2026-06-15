"""
update_inventory.py — load RealWear inventory from NetSuite XML .xls export files.

Expects these files in the given directory (default: current dir):
  ItemQuantitySoldperMonthResults*.xls   -> monthly_sales
  CustomCurrentInventorySnapshot*.xls   -> inventory_snapshot  +  skus (supplier)
  InventoryValuationSummary*.xls         -> inventory_valuation +  skus (desc, cost)
  PurchaseOrderHistory*.xls              -> po_history
  Bryant_sOpenPurchaseOrders*.xls        -> open_pos

Usage:
    python update_inventory.py "C:\\Users\\swinn\\Desktop\\Accessory Invt Mngt"
"""

import os
import sys
import glob
from datetime import date, datetime
from lxml import etree
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
today = date.today().isoformat()

SEARCH_DIR = sys.argv[1] if len(sys.argv) > 1 else "."

NS_PREFIX = "{urn:schemas-microsoft-com:office:spreadsheet}"


# ── XML / file helpers ────────────────────────────────────────────────────────

def parse_xls_xml(path: str) -> list[list[str]]:
    """Parse a NetSuite XML SpreadsheetML .xls into a list of dense string rows."""
    with open(path, "rb") as f:
        content = f.read()
    parser = etree.XMLParser(recover=True, encoding="utf-8")
    root = etree.fromstring(content, parser=parser)

    ws = root.findall(f"{NS_PREFIX}Worksheet")[0]
    table = ws.find(f"{NS_PREFIX}Table")
    if table is None:
        return []

    result = []
    for row_el in table.findall(f"{NS_PREFIX}Row"):
        cells = row_el.findall(f"{NS_PREFIX}Cell")
        row_data: dict[int, str] = {}
        col = 0
        for c in cells:
            idx = c.get(f"{NS_PREFIX}Index")
            if idx:
                col = int(idx) - 1  # 1-based -> 0-based
            d = c.find(f"{NS_PREFIX}Data")
            row_data[col] = (d.text or "").strip() if d is not None else ""
            col += 1
        max_col = max(row_data.keys()) if row_data else -1
        result.append([row_data.get(i, "") for i in range(max_col + 1)])

    return result


def find_file(pattern: str) -> str | None:
    matches = [
        m for m in glob.glob(os.path.join(SEARCH_DIR, pattern))
        if not os.path.basename(m).startswith("~$")
    ]
    return matches[0] if matches else None


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


def upsert(table: str, rows: list, conflict_col: str = None):
    if not rows:
        print(f"  {table}: 0 rows -- skipped")
        return
    kwargs = {"on_conflict": conflict_col} if conflict_col else {}
    supabase.table(table).upsert(rows, **kwargs).execute()
    print(f"  {table}: upserted {len(rows)} rows")


# ── Snapshot column layout (confirmed by inspection of CustomCurrentInventorySnapshot-404.xls)
# Row 6 = location header row, Row 7 = sub-header row
#   Col 73: "4 - Hong Kong"  ->  Col 75 On Hand, Col 76 On Order
#   Col 87: "6 - 3pl Portland" -> Col 89 On Hand, Col 90 On Order
#   Col 206: "Total"           -> Col 208 On Hand, Col 209 On Order

COL_HK_ONHAND  = 75
COL_HK_ONORDER = 76
COL_PDX_ONHAND = 89
COL_PDX_ONORDER = 90
COL_TOT_ONHAND  = 208
COL_TOT_ONORDER = 209


# ── Readers (data only, no DB writes) ────────────────────────────────────────

def read_valuation() -> tuple[list, dict, dict]:
    """Returns (db_rows, ppu_by_sku, desc_by_sku)."""
    path = find_file("InventoryValuationSummary*.xls")
    if not path:
        print("  InventoryValuationSummary*.xls not found -- skipping")
        return [], {}, {}

    print(f"  {os.path.basename(path)}")
    rows = parse_xls_xml(path)

    db_rows, ppu_by_sku, desc_by_sku = [], {}, {}
    # Row 6 = col headers, Row 7 = category header, Rows 8+ = data
    # Cols: 0=Item, 1=Description, 2=Inv.Value, 3=%ofInv, 4=OnHand
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


def read_snapshot() -> tuple[list, dict]:
    """Returns (db_rows, supplier_by_sku)."""
    # NetSuite exports the file with or without the "Custom" prefix depending on the run
    path = find_file("CustomCurrentInventorySnapshot*.xls") \
        or find_file("CurrentInventorySnapshot*.xls")
    if not path:
        print("  CurrentInventorySnapshot*.xls not found -- skipping")
        return [], {}

    print(f"  {os.path.basename(path)}")
    rows = parse_xls_xml(path)

    db_rows, supplier_by_sku = [], {}
    # Rows 0-7 = metadata + headers; data starts at row 8
    for r in rows[8:]:
        sku = r[0].strip() if len(r) > 0 else ""
        if not is_valid_sku(sku):
            continue
        supplier = r[2].strip() if len(r) > 2 and r[2] else None
        if supplier:
            supplier_by_sku[sku] = supplier

        def col(idx):
            return safe_int(r[idx]) if idx < len(r) and r[idx] else None

        db_rows.append({
            "sku": sku,
            "updated_at": today,
            "on_hand_total":    col(COL_TOT_ONHAND) or 0,
            "on_hand_portland": col(COL_PDX_ONHAND) or 0,
            "on_hand_hk":       col(COL_HK_ONHAND)  or 0,
            "on_order":         col(COL_TOT_ONORDER) or 0,
        })

    return db_rows, supplier_by_sku


def read_monthly_sales() -> list:
    """Returns db_rows for monthly_sales."""
    path = find_file("ItemQuantitySoldperMonthResults*.xls")
    if not path:
        print("  ItemQuantitySoldperMonthResults*.xls not found -- skipping")
        return []

    print(f"  {os.path.basename(path)}")
    rows = parse_xls_xml(path)
    if not rows:
        return []

    # Row 0 = headers:  col 1=Item, col 3=MaxLastSoldDate, cols 5-17=monthly qty
    # Cols 5..17 = offset 0 (current month) through 12 months ago

    # Anchor: max Last Sold Date across all rows -> determines "current month"
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


def read_po_history() -> list:
    path = find_file("PurchaseOrderHistory*.xls")
    if not path:
        print("  PurchaseOrderHistory*.xls not found -- skipping")
        return []

    print(f"  {os.path.basename(path)}")
    rows = parse_xls_xml(path)

    # Detect header row
    data_start = 0
    for i, r in enumerate(rows):
        if r and any("item" in str(v).lower() or "sku" in str(v).lower() for v in r[:3]):
            data_start = i + 1
            break

    STATUS_MAP = {
        "pending receipt": "Pending", "fully billed": "Received",
        "closed": "Received", "open": "Open", "partial": "Partial",
        "cancelled": "Cancelled", "canceled": "Cancelled",
    }

    db_rows = []
    for r in rows[data_start:]:
        sku = r[0].strip() if r else ""
        if not is_valid_sku(sku):
            continue
        po_number = r[3].strip() if len(r) > 3 and r[3] else None
        if not po_number:
            continue
        raw_status = r[4].strip() if len(r) > 4 and r[4] else "Open"
        status = STATUS_MAP.get(raw_status.lower(), raw_status)
        db_rows.append({
            "sku": sku,
            "po_number": po_number,
            "vendor": r[2].strip() if len(r) > 2 else None,
            "status": status,
            "qty_ordered": safe_int(r[5]) or 0 if len(r) > 5 else 0,
            "unit_cost": safe_float(r[6]) if len(r) > 6 else None,
            "created_at": today,
        })

    return db_rows


OPEN_PO_SKIP = {"closed", "rejected by supervisor", "nan", "none", ""}


def _build_open_po_row(sku, vendor, po_number, status, qty, cost, date=None):
    """Build a single open_pos DB row, or None if status/sku should be excluded."""
    if not is_valid_sku(sku):
        return None
    if not po_number or str(po_number).strip().lower() in ("nan", "none", ""):
        return None
    if not status or str(status).strip().lower() in OPEN_PO_SKIP:
        return None
    qty = safe_int(qty) or 0
    cost = safe_float(cost) or 0.0
    return {
        "sku":         sku.strip(),
        "po_number":   str(po_number).strip(),
        "vendor":      vendor.strip() if vendor else None,
        "status":      str(status).strip(),
        "qty_ordered": qty,
        "open_amount": round(qty * cost, 2),
        "date":        str(date).strip() if date and str(date).strip() not in ("nan", "None", "") else None,
    }


def read_open_pos():
    """Primary: Bryant_sOpenPurchaseOrders*.xls (NetSuite SpreadsheetML XML).

    Returns a list of rows, or None if the file is not found (signals fallback).
    NetSuite column layout: SKU(0), Description(1), Vendor(2), PO#(3),
    Status(4), Qty Ordered(5), Unit Cost(6), Expected Date(7).
    """
    path = find_file("Bryant_sOpenPurchaseOrders*.xls")
    if not path:
        return None  # caller will try xlsx fallback

    print(f"  {os.path.basename(path)}")
    rows = parse_xls_xml(path)

    # Skip metadata rows until we hit the header
    data_start = 0
    for i, r in enumerate(rows):
        if r and any(str(v).lower() in ("item", "sku") for v in r[:2]):
            data_start = i + 1
            break

    db_rows = []
    for r in rows[data_start:]:
        if not r or len(r) < 5:
            continue
        row = _build_open_po_row(
            sku=r[0], vendor=r[2] if len(r) > 2 else None,
            po_number=r[3] if len(r) > 3 else None,
            status=r[4] if len(r) > 4 else None,
            qty=r[5] if len(r) > 5 else None,
            cost=r[6] if len(r) > 6 else None,
            date=r[7] if len(r) > 7 else None,
        )
        if row:
            db_rows.append(row)
    return db_rows


def read_open_pos_xlsx():
    """Fallback: Accessory_Inv_Mgmt_*.xlsx → 'PO History' sheet.

    Column layout (0-indexed): SKU(0), Description(1), Vendor(2),
    PO Number(3), Status(4), Qty Ordered(5), Unit Cost(6).
    Data starts at row index 3 (rows 0-2 are title/filter/header).
    """
    import openpyxl
    matches = [m for m in glob.glob(os.path.join(SEARCH_DIR, "Accessory_Inv_Mgmt_*.xlsx"))
               if not os.path.basename(m).startswith("~$")]
    if not matches:
        print("  Accessory_Inv_Mgmt_*.xlsx not found -- skipping open POs")
        return []

    path = sorted(matches)[-1]
    print(f"  {os.path.basename(path)} [PO History sheet]")

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    if "PO History" not in wb.sheetnames:
        wb.close()
        print("  'PO History' sheet not found -- skipping open POs")
        return []

    ws = wb["PO History"]
    db_rows = []
    for i, r in enumerate(ws.iter_rows(values_only=True)):
        if i < 3:  # title row, filter control row, header row
            continue
        if not r or r[0] is None:
            continue
        row = _build_open_po_row(
            sku=str(r[0]), vendor=str(r[2]) if r[2] else None,
            po_number=r[3], status=r[4],
            qty=r[5], cost=r[6],
        )
        if row:
            db_rows.append(row)
    wb.close()
    return db_rows


# ── Demand forecast ───────────────────────────────────────────────────────────

def build_demand_forecast(sales_rows: list) -> list:
    """Pre-compute avg_3m and avg_6m per SKU, always dividing by 3 or 6."""
    from collections import defaultdict
    by_sku: dict = defaultdict(list)
    for r in sales_rows:
        by_sku[r["sku"]].append((r["month"], r["qty_sold"]))

    rows = []
    for sku, entries in by_sku.items():
        entries.sort(key=lambda x: x[0], reverse=True)  # newest first
        qtys = [q for _, q in entries]
        rows.append({
            "sku":        sku,
            "avg_3m":     round(sum(qtys[:3]) / 3, 4),
            "avg_6m":     round(sum(qtys[:6]) / 6, 4),
            "updated_at": today,
        })
    return rows


# ── Cleanup ───────────────────────────────────────────────────────────────────

def cleanup_invalid_skus():
    """Delete rows with invalid SKU formats from all tables.

    Invalid formats: contains ':', starts with 'EarBud' or 'Flash Drive'.
    Child tables are deleted before the skus parent to respect FK constraints.
    """
    child_tables = ["po_history", "inventory_valuation", "monthly_sales", "inventory_snapshot", "demand_forecast"]
    all_tables = child_tables + ["skus"]
    patterns = ["%:%", "EarBud%", "Flash Drive%"]
    total = 0
    for table in all_tables:
        for pattern in patterns:
            res = supabase.table(table).delete().like("sku", pattern).execute()
            if res.data:
                total += len(res.data)
    print(f"  cleanup_invalid_skus: {total} rows removed")


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"Directory: {os.path.abspath(SEARCH_DIR)}\n")

    # Step 0: remove any rows with invalid SKU formats
    print("Cleaning up invalid SKUs...")
    cleanup_invalid_skus()
    print()

    # Step 1: read all files (no DB writes yet)
    print("Reading valuation...")
    val_rows, ppu_by_sku, desc_by_sku = read_valuation()

    print("Reading snapshot...")
    snap_rows, supplier_by_sku = read_snapshot()  # matches Custom* or plain Current*

    print("Reading monthly sales...")
    sales_rows = read_monthly_sales()

    print("Reading PO history...")
    po_rows = read_po_history()

    print("Reading open POs...")
    open_po_rows = read_open_pos()
    if open_po_rows is None:
        print("  Bryant_sOpenPurchaseOrders*.xls not found -- trying Excel fallback")
        open_po_rows = read_open_pos_xlsx()

    # Step 2: collect all SKUs that need a parent row in skus table
    # (open_po_rows excluded here — filtered to known SKUs after skus upsert)
    all_skus = (
        {r["sku"] for r in val_rows}
        | {r["sku"] for r in snap_rows}
        | {r["sku"] for r in sales_rows}
        | {r["sku"] for r in po_rows}
    )

    # Step 3: upsert in FK-safe order
    print("\n>> skus (FK parent)")
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
    upsert("skus", sku_rows, conflict_col="sku")

    print("\n>> inventory_valuation")
    upsert("inventory_valuation", val_rows)

    print("\n>> inventory_snapshot")
    upsert("inventory_snapshot", snap_rows)

    print("\n>> monthly_sales")
    upsert("monthly_sales", sales_rows, conflict_col="sku,month")

    print("\n>> demand_forecast")
    forecast_rows = build_demand_forecast(sales_rows)
    upsert("demand_forecast", forecast_rows, conflict_col="sku")

    print("\n>> po_history")
    upsert("po_history", po_rows)

    print("\n>> open_pos")
    # Filter to SKUs already in the skus table (FK safety + per user spec)
    valid_open_po = [r for r in open_po_rows if r["sku"] in all_skus]
    skipped = len(open_po_rows) - len(valid_open_po)
    if skipped:
        print(f"  ({skipped} rows skipped — SKU not in skus table)")
    print(f"  {len(valid_open_po)} rows ready to upsert")
    try:
        # Full refresh: clear stale POs before reloading current state
        supabase.table("open_pos").delete().neq("sku", "").execute()
        upsert("open_pos", valid_open_po)
    except Exception as e:
        msg = str(e)
        if "qty_ordered" in msg:
            # Table exists but is missing qty_ordered column — retry without it
            print("  qty_ordered column missing; run:")
            print("    ALTER TABLE open_pos ADD COLUMN IF NOT EXISTS qty_ordered int DEFAULT 0;")
            rows_slim = [{k: v for k, v in r.items() if k != "qty_ordered"} for r in valid_open_po]
            supabase.table("open_pos").delete().neq("sku", "").execute()
            upsert("open_pos", rows_slim)
        else:
            print(f"  open_pos failed: {e}")
            print("  Ensure the open_pos table exists -- run the SQL in supabase_schema.sql")

    print("\nDone.")


if __name__ == "__main__":
    main()
