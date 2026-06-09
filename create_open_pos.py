"""One-time script to create the open_pos table in Supabase."""
import os, requests
from dotenv import load_dotenv
load_dotenv()

url = os.environ['SUPABASE_URL']
key = os.environ['SUPABASE_SERVICE_KEY']
ref = url.replace('https://', '').replace('.supabase.co', '')

SQL = (
    "CREATE TABLE IF NOT EXISTS open_pos ("
    "  sku text NOT NULL REFERENCES skus(sku),"
    "  po_number text NOT NULL,"
    "  vendor text,"
    "  status text,"
    "  qty_ordered int DEFAULT 0,"
    "  open_amount numeric DEFAULT 0,"
    "  date date,"
    "  PRIMARY KEY (sku, po_number)"
    ");"
    "CREATE INDEX IF NOT EXISTS idx_open_pos_sku ON open_pos(sku);"
    "ALTER TABLE open_pos ENABLE ROW LEVEL SECURITY;"
    "CREATE POLICY IF NOT EXISTS \"anon read open_pos\" ON open_pos FOR SELECT USING (true);"
)

r = requests.post(
    f'https://api.supabase.com/v1/projects/{ref}/database/query',
    headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
    json={'query': SQL},
    timeout=10,
)
print(f'Management API status: {r.status_code}')
if r.status_code == 200:
    print('open_pos table created.')
else:
    print('Needs OAuth token. Run this SQL manually in the Supabase SQL editor:')
    print()
    print("""CREATE TABLE IF NOT EXISTS open_pos (
  sku         text NOT NULL REFERENCES skus(sku),
  po_number   text NOT NULL,
  vendor      text,
  status      text,
  qty_ordered int     DEFAULT 0,
  open_amount numeric DEFAULT 0,
  date        date,
  PRIMARY KEY (sku, po_number)
);
CREATE INDEX IF NOT EXISTS idx_open_pos_sku ON open_pos(sku);
ALTER TABLE open_pos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read open_pos" ON open_pos FOR SELECT USING (true);""")
