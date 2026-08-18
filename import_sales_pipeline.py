"""
import_sales_pipeline.py — load a HubSpot "Sales Pipeline" deal export into the
sales_pipeline table.

HubSpot's CSV export double-encodes UTF-8 as Latin-1 (e.g. "RealWear NavigatorÂ® 520"
instead of "RealWear Navigator® 520"). This script undoes that, normalizes whitespace,
picks a primary distributor when a deal lists more than one, and pairs each line item
name with its HubSpot line item id.

Usage:
    python import_sales_pipeline.py "C:\\Users\\swinn\\Downloads\\Sales Pipeline _ (1).csv"

If no path is given, the newest "Sales Pipeline*.csv" file in Downloads is used.
"""

import csv
import glob
import os
import re
import sys
from datetime import datetime

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

DOWNLOADS = os.path.join(os.path.expanduser("~"), "Downloads")


def find_csv() -> str:
    matches = glob.glob(os.path.join(DOWNLOADS, "Sales Pipeline*.csv"))
    if not matches:
        sys.exit("No 'Sales Pipeline*.csv' file found in Downloads. Pass a path explicitly.")
    return max(matches, key=os.path.getmtime)


def fix_mojibake(s: str) -> str:
    if not s:
        return s
    try:
        return s.encode("latin1").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        return s


def clean(s) -> str:
    if not s:
        return ""
    s = fix_mojibake(str(s)).strip()
    return re.sub(r"\s+", " ", s)


def safe_float(v) -> float | None:
    v = (v or "").strip()
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def safe_date(v) -> str | None:
    v = (v or "").strip()
    return v.split(" ")[0] if v else None  # "2026-11-04 00:55" -> "2026-11-04"


def safe_timestamp(v) -> str | None:
    v = (v or "").strip()
    if not v:
        return None
    try:
        return datetime.strptime(v, "%Y-%m-%d %H:%M").isoformat()
    except ValueError:
        return safe_date(v)


def split_list(v) -> list[str]:
    return [clean(x) for x in (v or "").split(";") if clean(x)]


def build_line_items(names_raw, ids_raw) -> list[dict]:
    names = split_list(names_raw)
    ids = [x.strip() for x in (ids_raw or "").split(";")]
    ids = [i for i in ids if i]
    return [{"name": name, "id": ids[i] if i < len(ids) else None} for i, name in enumerate(names)]


def parse_row(row: dict) -> dict:
    distributors = split_list(row.get("Distributor"))
    return {
        "record_id": clean(row.get("Record ID")),
        "deal_name": clean(row.get("Deal Name")) or None,
        "deal_owner": clean(row.get("Deal owner")) or None,
        "amount": safe_float(row.get("Amount")),
        "company": clean(row.get("Associated Company (Primary)")) or None,
        "distributor": distributors[0] if distributors else None,
        "distributor_raw": "; ".join(distributors) if distributors else None,
        "reseller": clean(row.get("Reseller")) or None,
        "close_date": safe_date(row.get("Close Date")),
        "deal_stage": clean(row.get("Deal Stage")) or None,
        "line_items": build_line_items(row.get("Associated Line item"), row.get("Associated Line item IDs")),
        "geography": clean(row.get("Geography (Deal Level) ")) or None,
        "country": clean(row.get("Country/Region")) or None,
        "state_region": clean(row.get("State/Region")) or None,
        "create_date": safe_date(row.get("Create Date")),
        "last_modified_date": safe_timestamp(row.get("Last Modified Date")),
    }


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else find_csv()
    print(f"Reading {path}")
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = [parse_row(r) for r in reader if (r.get("Record ID") or "").strip()]

    # Stamp every row with this sync's timestamp so the Dashboard's "last updated"
    # indicator reflects when the CSV was actually imported, not the first insert.
    sync_ts = datetime.utcnow().isoformat()
    for row in rows:
        row["updated_at"] = sync_ts

    print(f"Parsed {len(rows)} deals")
    chunk_size = 200
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i:i + chunk_size]
        supabase.table("sales_pipeline").upsert(chunk, on_conflict="record_id").execute()
        print(f"  upserted {i + len(chunk)}/{len(rows)}")

    print("Done.")


if __name__ == "__main__":
    main()
