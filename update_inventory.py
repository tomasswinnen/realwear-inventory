"""
update_inventory.py — upsert RealWear inventory data from Excel into Supabase.

Usage:
    pip install supabase openpyxl pandas python-dotenv
    python update_inventory.py path/to/inventory.xlsx

Expected sheet names: SKUs, Inventory, Sales, Valuation, POs
"""

import os
import sys
import pandas as pd
from datetime import date
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]  # Use service role key for writes

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

today = date.today().isoformat()


def upsert(table: str, rows: list[dict], conflict_col: str = None):
    if not rows:
        print(f"  {table}: no rows, skipping")
        return
    kwargs = {}
    if conflict_col:
        kwargs["on_conflict"] = conflict_col
    res = supabase.table(table).upsert(rows, **kwargs).execute()
    print(f"  {table}: upserted {len(rows)} rows")
    return res


def process_skus(df: pd.DataFrame):
    rows = []
    for _, row in df.iterrows():
        rows.append({
            "sku": str(row["SKU"]).strip(),
            "description": str(row.get("Description", "")).strip() or None,
            "supplier": str(row.get("Supplier", "")).strip() or None,
            "supplier_email": str(row.get("Supplier Email", "")).strip() or None,
            "lead_time_days": int(row["Lead Time Days"]) if pd.notna(row.get("Lead Time Days")) else None,
            "moq": int(row["MOQ"]) if pd.notna(row.get("MOQ")) else None,
            "unit_cost": float(row["Unit Cost"]) if pd.notna(row.get("Unit Cost")) else None,
            "attach_rate": float(row["Attach Rate"]) if pd.notna(row.get("Attach Rate")) else None,
        })
    upsert("skus", rows, conflict_col="sku")


def process_inventory(df: pd.DataFrame):
    rows = []
    for _, row in df.iterrows():
        rows.append({
            "sku": str(row["SKU"]).strip(),
            "updated_at": today,
            "on_hand_total": int(row["On Hand Total"]) if pd.notna(row.get("On Hand Total")) else 0,
            "on_hand_portland": int(row["On Hand Portland"]) if pd.notna(row.get("On Hand Portland")) else 0,
            "on_hand_hk": int(row["On Hand HK"]) if pd.notna(row.get("On Hand HK")) else 0,
            "on_order": int(row["On Order"]) if pd.notna(row.get("On Order")) else 0,
        })
    upsert("inventory_snapshot", rows)


def process_sales(df: pd.DataFrame):
    rows = []
    for _, row in df.iterrows():
        month_val = row.get("Month")
        if pd.isna(month_val):
            continue
        month_str = pd.to_datetime(month_val).date().replace(day=1).isoformat()
        rows.append({
            "sku": str(row["SKU"]).strip(),
            "month": month_str,
            "qty_sold": int(row["Qty Sold"]) if pd.notna(row.get("Qty Sold")) else 0,
        })
    upsert("monthly_sales", rows)


def process_valuation(df: pd.DataFrame):
    rows = []
    for _, row in df.iterrows():
        rows.append({
            "sku": str(row["SKU"]).strip(),
            "updated_at": today,
            "on_hand": int(row["On Hand"]) if pd.notna(row.get("On Hand")) else 0,
            "inv_value": float(row["Inv Value"]) if pd.notna(row.get("Inv Value")) else 0.0,
        })
    upsert("inventory_valuation", rows)


def process_pos(df: pd.DataFrame):
    rows = []
    for _, row in df.iterrows():
        rows.append({
            "sku": str(row["SKU"]).strip(),
            "po_number": str(row.get("PO Number", "")).strip() or None,
            "vendor": str(row.get("Vendor", "")).strip() or None,
            "status": str(row.get("Status", "Open")).strip(),
            "qty_ordered": int(row["Qty Ordered"]) if pd.notna(row.get("Qty Ordered")) else 0,
            "unit_cost": float(row["Unit Cost"]) if pd.notna(row.get("Unit Cost")) else None,
            "created_at": pd.to_datetime(row["Created At"]).date().isoformat() if pd.notna(row.get("Created At")) else today,
        })
    upsert("po_history", rows)


SHEET_HANDLERS = {
    "SKUs": process_skus,
    "Inventory": process_inventory,
    "Sales": process_sales,
    "Valuation": process_valuation,
    "POs": process_pos,
}


def main():
    if len(sys.argv) < 2:
        print("Usage: python update_inventory.py <path_to_excel.xlsx>")
        sys.exit(1)

    path = sys.argv[1]
    print(f"Loading: {path}")
    xl = pd.ExcelFile(path)

    for sheet_name, handler in SHEET_HANDLERS.items():
        if sheet_name in xl.sheet_names:
            print(f"\nProcessing sheet: {sheet_name}")
            df = xl.parse(sheet_name)
            handler(df)
        else:
            print(f"\nSkipping sheet: {sheet_name} (not found)")

    print("\nDone.")


if __name__ == "__main__":
    main()
