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


import re as _re
_PO_RE = _re.compile(r'^PO\d+$', _re.IGNORECASE)

OPEN_PO_SKIP = {"closed", "rejected by supervisor", "nan", "none", ""}

# Statuses accepted for open_pos rows
VALID_OPEN_PO_STATUSES = {
    "Pending Receipt",
    "Partially Received",
    "Pending Bill",
    "Pending Billing/Partially Received",
}

# Non-data rows whose col0 text we skip outright
_SKIP_COL0 = {"Purchase Orders", "Open Inventory Purchase Orders", ""}


def _build_open_po_row(sku, vendor, po_number, status, qty, cost, date=None):
    """Build a single open_pos DB row for Bryant's/xlsx fallback parsers."""
    if not is_valid_sku(sku):
        return None
    if "total" in str(sku).lower():
        return None
    po_str = str(po_number).strip() if po_number else ""
    if not _PO_RE.match(po_str):
        return None
    if not status or str(status).strip().lower() in OPEN_PO_SKIP:
        return None
    qty_val = safe_int(qty) or 0
    unit_cost = safe_float(cost) or 0.0
    return {
        "sku":         sku.strip(),
        "po_number":   po_str.upper(),
        "vendor":      vendor.strip() if vendor else None,
        "status":      str(status).strip(),
        "qty_ordered": qty_val,
        "unit_cost":   unit_cost if unit_cost else None,
        "open_amount": round(qty_val * unit_cost, 2),
        "date":        str(date).strip() if date and str(date).strip() not in ("nan", "None", "") else None,
    }


def read_open_pos_xls_inventory():
    """Parse OpenInventoryPurchaseOrders*.xls (NetSuite grouped layout).

    Exact column layout (header at row 6):
      col 0: Document Number  — PO number on PO rows, blank on line items
      col 1: Vendor
      col 2: Current Status
      col 3: PO Total
      col 4: Item Display Name
      col 5: Item Type
      col 6: Item Full Name   — SKU
      col 7: Requestor
      col 8: Quantity         — qty_ordered
      col 9: Quantity Received— qty_received
      col10: Quantity Billed
      col11: Quantity Open    — qty_open
      col12: Unit Price       — unit_price
      col13: $ Remaining      — amount_remaining

    Row types (all after skipping rows 0-6):
      • col0 starts with "Total"  → subtotal row, skip
      • col0 contains "/"         → date header row, update current_date
      • col0 matches ^PO\d+$      → PO number row, update current_po
      • col0 is empty AND col1 has vendor → line item, parse and store
      • anything else             → section header, ignore

    Returns list of DB-ready dicts, or None if file not found.
    """
    path = find_file("OpenInventoryPurchaseOrders*.xls")
    if not path:
        return None

    print(f"  {os.path.basename(path)}")
    raw = parse_xls_xml(path)

    db_rows = []
    current_po   = None
    current_date = None
    skipped      = []

    for r in raw[7:]:   # rows 0-6 are title/header rows
        if not r:
            continue
        col0 = str(r[0]).strip() if r[0] else ""

        # ── subtotal / total rows ── skip unconditionally
        if "total" in col0.lower():
            continue

        # ── PO number row ──
        if _PO_RE.match(col0):
            current_po = col0.upper()
            continue

        # ── date header row (contains "/", e.g. "1/22/2025") ──
        if "/" in col0:
            current_date = col0
            continue

        # ── line item row: col0 is blank, col1 has vendor ──
        if col0 == "" and len(r) > 1 and str(r[1]).strip():
            if not current_po:
                continue
            if len(r) < 14:
                skipped.append(f"  SKIP (too few cols {len(r)}): po={current_po}")
                continue

            sku              = str(r[6]).strip()  if len(r) > 6  and r[6]  else ""
            vendor           = str(r[1]).strip()  if r[1]                  else ""
            status           = str(r[2]).strip()  if len(r) > 2  and r[2]  else ""
            qty_ordered      = safe_int(r[8])     if len(r) > 8            else None
            qty_received     = safe_int(r[9])     if len(r) > 9            else None
            qty_open         = safe_int(r[11])    if len(r) > 11           else None
            unit_price       = safe_float(r[12])  if len(r) > 12           else None
            amount_remaining = safe_float(r[13])  if len(r) > 13           else None

            # PO number must be ^PO\d+$
            if not _PO_RE.match(current_po):
                skipped.append(f"  SKIP (bad PO): {current_po} sku={sku}")
                continue

            # SKU must be non-empty, is_valid_sku, and must start with a digit
            # (filters out supplier-side codes like GOE-0010-V*, Optic Mod UO-1)
            if not sku:
                skipped.append(f"  SKIP (empty SKU): po={current_po}")
                continue
            if not is_valid_sku(sku):
                skipped.append(f"  SKIP (invalid SKU): '{sku}' po={current_po}")
                continue
            if not sku[0].isdigit():
                skipped.append(f"  SKIP (non-accessory SKU): '{sku}' po={current_po}")
                continue

            # Status must be in the allowed set
            if status not in VALID_OPEN_PO_STATUSES:
                skipped.append(f"  SKIP (status='{status}'): '{sku}' po={current_po}")
                continue

            row = {
                "sku":              sku,
                "po_number":        current_po,
                "vendor":           vendor or None,
                "status":           status,
                "date":             current_date,
                "qty_ordered":      qty_ordered  if qty_ordered  is not None else 0,
                "qty_received":     qty_received if qty_received is not None else 0,
                "qty_open":         qty_open     if qty_open     is not None else 0,
                "unit_price":       unit_price,
                "unit_cost":        unit_price,          # backward compat — existing DB column
                "amount_remaining": amount_remaining,
                "open_amount":      amount_remaining,    # backward compat — existing DB column
            }
            db_rows.append(row)
            print(f"    + {row['po_number']}  {row['sku']:<14}  qty={row['qty_ordered']}  "
                  f"rcvd={row['qty_received']}  open={row['qty_open']}  "
                  f"unit=${row['unit_price'] or 0:.2f}  remaining=${row['amount_remaining'] or 0:,.2f}"
                  f"  [{row['status']}]")

        # ── anything else (section headers, etc.) ── ignore
        # e.g. "Purchase Orders"

    if skipped:
        print(f"  Skipped {len(skipped)} row(s):")
        for s in skipped:
            print(s)
    print(f"  Parsed {len(db_rows)} valid line item(s)")
    return db_rows


def read_open_pos():
    """Primary: OpenInventoryPurchaseOrders*.xls (grouped NetSuite format with qtys).

    Falls back to Bryant's XLS, then to xlsx.
    Returns a list of rows, or None if no file found (signals xlsx fallback).
    """
    result = read_open_pos_xls_inventory()
    if result is not None:
        return result  # found file; even if 0 rows, don't try Bryant's

    path = find_file("Bryant'sOpenPurchaseOrders*.xls") or find_file("Bryant_sOpenPurchaseOrders*.xls")
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

    path = max(matches, key=os.path.getmtime)
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
    """Pre-compute avg_3m, avg_6m, and total_12m per SKU using calendar months."""
    from collections import defaultdict

    by_sku: dict = defaultdict(dict)
    for r in sales_rows:
        by_sku[r["sku"]][r["month"]] = r["qty_sold"]

    # Anchor = most recent month in the entire dataset
    all_months = [r["month"] for r in sales_rows]
    if not all_months:
        return []
    anchor = max(all_months)  # e.g. "2026-03-01"
    ay, am = int(anchor[:4]), int(anchor[5:7])

    def calendar_sum(month_map: dict, n: int) -> int:
        """Sum qty_sold over the last n calendar months from anchor."""
        total = 0
        for i in range(n):
            mo, yr = am - i, ay
            while mo <= 0:
                mo += 12
                yr -= 1
            key = f"{yr}-{str(mo).zfill(2)}-01"
            total += month_map.get(key, 0)
        return total

    rows = []
    for sku, month_map in by_sku.items():
        all_qty = list(month_map.values())
        rows.append({
            "sku":        sku,
            "avg_3m":     round(calendar_sum(month_map, 3) / 3, 4),
            "avg_6m":     round(calendar_sum(month_map, 6) / 6, 4),
            "total_12m":  sum(all_qty),
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
        print("  No XLS open POs file found -- trying Excel fallback")
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
    valid_open_po = [r for r in open_po_rows if r["sku"] in all_skus]
    skipped = len(open_po_rows) - len(valid_open_po)
    if skipped:
        print(f"  ({skipped} rows skipped — SKU not in skus table)")
    print(f"  {len(valid_open_po)} rows ready to insert")
    # Full refresh: delete ALL existing rows first, then insert current file data
    supabase.table("open_pos").delete().neq("sku", "").execute()
    _NEW_OPEN_PO_COLS = {
        "qty_received":     "integer DEFAULT 0",
        "qty_open":         "integer DEFAULT 0",
        "unit_price":       "numeric",
        "unit_cost":        "numeric",
        "amount_remaining": "numeric",
        "qty_ordered":      "integer DEFAULT 0",
    }
    if valid_open_po:
        try:
            upsert("open_pos", valid_open_po)
        except Exception as e:
            msg = str(e)
            # Any "column not found" error means the new columns haven't been added yet.
            # Strip ALL new columns and retry with only the pre-existing schema.
            if "column" in msg.lower() and ("not found" in msg.lower() or "PGRST204" in msg):
                new_cols = list(_NEW_OPEN_PO_COLS.keys())
                print("  New columns not yet in open_pos schema. Add them with:")
                for col, dtype in _NEW_OPEN_PO_COLS.items():
                    print(f"    ALTER TABLE open_pos ADD COLUMN IF NOT EXISTS {col} {dtype};")
                rows_slim = [{k: v for k, v in r.items() if k not in new_cols} for r in valid_open_po]
                upsert("open_pos", rows_slim)
                print("  Inserted with existing columns only (unit_cost, open_amount).")
            else:
                print(f"  open_pos failed: {e}")
                print("  Ensure the open_pos table exists — run the SQL in supabase_schema.sql")

    print("\nDone.")


if __name__ == "__main__":
    main()
