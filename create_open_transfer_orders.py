"""One-time script to create the open_transfer_orders table in Supabase."""
import os
import requests
from dotenv import load_dotenv

load_dotenv()

url = os.environ['SUPABASE_URL']
key = os.environ['SUPABASE_SERVICE_KEY']
ref = url.replace('https://', '').replace('.supabase.co', '')

SQL = (
    "CREATE TABLE IF NOT EXISTS open_transfer_orders ("
    "  sku text not null references skus(sku),"
    "  transfer_order_number text not null,"
    "  vendor text,"
    "  status text,"
    "  origin_location text,"
    "  destination_location text,"
    "  qty_ordered int default 0,"
    "  qty_open int default 0,"
    "  unit_price numeric default 0,"
    "  amount_remaining numeric default 0,"
    "  transfer_date date,"
    "  primary key (transfer_order_number, sku)"
    ");"
    "CREATE INDEX IF NOT EXISTS idx_open_transfer_orders_sku ON open_transfer_orders(sku);"
    "ALTER TABLE open_transfer_orders ADD COLUMN IF NOT EXISTS origin_location text;"
    "ALTER TABLE open_transfer_orders ADD COLUMN IF NOT EXISTS destination_location text;"
    "ALTER TABLE open_transfer_orders ENABLE ROW LEVEL SECURITY;"
    "DROP POLICY IF EXISTS \"anon read open_transfer_orders\" ON open_transfer_orders;"
    "CREATE POLICY \"anon read open_transfer_orders\" ON open_transfer_orders FOR SELECT USING (true);"
)

r = requests.post(
    f'https://api.supabase.com/v1/projects/{ref}/database/query',
    headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
    json={'query': SQL},
    timeout=30,
)
print(f'Management API status: {r.status_code}')
if r.status_code == 200:
    print('open_transfer_orders table created.')
else:
    print('Could not create open_transfer_orders automatically. Run this SQL manually in Supabase SQL editor:')
    print(SQL)
