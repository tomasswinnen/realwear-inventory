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

create table if not exists open_pos (
  sku         text not null references skus(sku),
  po_number   text not null,
  vendor      text,
  status      text,
  qty_ordered int     default 0,
  open_amount numeric default 0,
  date        date,
  primary key (sku, po_number)
);
create index if not exists idx_open_pos_sku on open_pos(sku);

create table if not exists open_transfer_orders (
  sku                     text not null references skus(sku),
  transfer_order_number   text not null,
  vendor                  text,
  status                  text,
  origin_location         text,
  destination_location    text,
  qty_ordered             int     default 0,
  qty_open                int     default 0,
  unit_price              numeric default 0,
  amount_remaining        numeric default 0,
  transfer_date           date,
  primary key (transfer_order_number, sku)
);
create index if not exists idx_open_transfer_orders_sku on open_transfer_orders(sku);
alter table open_transfer_orders add column if not exists origin_location text;
alter table open_transfer_orders add column if not exists destination_location text;

create table if not exists demand_forecast (
  sku        text primary key references skus(sku),
  avg_3m     numeric default 0,
  avg_6m     numeric default 0,
  updated_at date not null default current_date
);
create index if not exists idx_demand_forecast_sku on demand_forecast(sku);

-- sku is NOT a FK to skus(sku): distributor reports use their own part numbers/codes
-- (accessory SKUs, service/bundle SKUs, etc.) that don't reliably match our catalog.
create table if not exists distributor_stock (
  distributor text not null,
  sku         text not null,
  qty_on_hand int     default 0,
  updated_at  date not null default current_date,
  primary key (distributor, sku)
);
create index if not exists idx_distributor_stock_sku on distributor_stock(sku);

-- Sales pipeline deals imported from the HubSpot "Sales Pipeline" export.
-- distributor is the cleaned-up primary distributor (for grouping); distributor_raw
-- keeps the full original value since a deal can list more than one.
-- line_items is [{ "name": "...", "id": "..." }] — HubSpot line item name + record id,
-- not necessarily a catalog SKU from the skus table.
create table if not exists sales_pipeline (
  record_id          text primary key,
  deal_name          text,
  deal_owner         text,
  amount             numeric,
  company            text,
  distributor        text,
  distributor_raw    text,
  reseller           text,
  close_date         date,
  deal_stage         text,
  line_items         jsonb not null default '[]'::jsonb,
  geography          text,
  country            text,
  state_region       text,
  create_date        date,
  last_modified_date timestamptz,
  updated_at         timestamptz not null default now()
);
create index if not exists idx_sales_pipeline_distributor on sales_pipeline(distributor);
create index if not exists idx_sales_pipeline_stage on sales_pipeline(deal_stage);

-- Enable Row Level Security (recommended)
alter table skus enable row level security;
alter table inventory_snapshot enable row level security;
alter table monthly_sales enable row level security;
alter table inventory_valuation enable row level security;
alter table po_history enable row level security;
alter table open_pos enable row level security;
alter table demand_forecast enable row level security;
alter table distributor_stock enable row level security;
alter table sales_pipeline enable row level security;

-- Allow anon read access (dashboard is read-only from browser)
drop policy if exists "anon read skus" on skus;
create policy "anon read skus" on skus for select using (true);
drop policy if exists "anon read inventory_snapshot" on inventory_snapshot;
create policy "anon read inventory_snapshot" on inventory_snapshot for select using (true);
drop policy if exists "anon read monthly_sales" on monthly_sales;
create policy "anon read monthly_sales" on monthly_sales for select using (true);
drop policy if exists "anon read inventory_valuation" on inventory_valuation;
create policy "anon read inventory_valuation" on inventory_valuation for select using (true);
drop policy if exists "anon read po_history" on po_history;
create policy "anon read po_history" on po_history for select using (true);
drop policy if exists "anon read open_pos" on open_pos;
create policy "anon read open_pos" on open_pos for select using (true);
drop policy if exists "anon read open_transfer_orders" on open_transfer_orders;
create policy "anon read open_transfer_orders" on open_transfer_orders for select using (true);
drop policy if exists "anon read demand_forecast" on demand_forecast;
create policy "anon read demand_forecast" on demand_forecast for select using (true);
drop policy if exists "anon read distributor_stock" on distributor_stock;
create policy "anon read distributor_stock" on distributor_stock for select using (true);
drop policy if exists "anon read sales_pipeline" on sales_pipeline;
create policy "anon read sales_pipeline" on sales_pipeline for select using (true);
