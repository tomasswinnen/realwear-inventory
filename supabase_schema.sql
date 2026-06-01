-- RealWear Inventory Dashboard — Supabase schema
-- Run this in your Supabase SQL editor

create table if not exists skus (
  sku text primary key,
  description text,
  supplier text,
  supplier_email text,
  lead_time_days int,
  moq int,
  unit_cost numeric,
  attach_rate numeric
);

create table if not exists inventory_snapshot (
  id serial primary key,
  sku text references skus(sku),
  updated_at date not null default current_date,
  on_hand_total int default 0,
  on_hand_portland int default 0,
  on_hand_hk int default 0,
  on_order int default 0
);
create index if not exists idx_inv_snap_sku_date on inventory_snapshot(sku, updated_at desc);

create table if not exists monthly_sales (
  id serial primary key,
  sku text references skus(sku),
  month date not null,
  qty_sold int default 0,
  unique(sku, month)
);
create index if not exists idx_monthly_sales_sku_month on monthly_sales(sku, month desc);

create table if not exists inventory_valuation (
  id serial primary key,
  sku text references skus(sku),
  updated_at date not null default current_date,
  on_hand int default 0,
  inv_value numeric default 0
);
create index if not exists idx_inv_val_sku_date on inventory_valuation(sku, updated_at desc);

create table if not exists po_history (
  id serial primary key,
  sku text references skus(sku),
  po_number text,
  vendor text,
  status text default 'Open',
  qty_ordered int default 0,
  unit_cost numeric,
  created_at date not null default current_date
);
create index if not exists idx_po_sku on po_history(sku);
create index if not exists idx_po_status on po_history(status);

-- Enable Row Level Security (recommended)
alter table skus enable row level security;
alter table inventory_snapshot enable row level security;
alter table monthly_sales enable row level security;
alter table inventory_valuation enable row level security;
alter table po_history enable row level security;

-- Allow anon read access (dashboard is read-only from browser)
create policy "anon read skus" on skus for select using (true);
create policy "anon read inventory_snapshot" on inventory_snapshot for select using (true);
create policy "anon read monthly_sales" on monthly_sales for select using (true);
create policy "anon read inventory_valuation" on inventory_valuation for select using (true);
create policy "anon read po_history" on po_history for select using (true);
