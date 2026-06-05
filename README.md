# RealWear Inventory Dashboard

Internal inventory management dashboard for RealWear accessories — tracking stock levels, demand forecasts, purchase orders, and reorder alerts across Portland (PDX) and Hong Kong (HK) warehouses.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Styling | Tailwind CSS v3 (dark theme) |
| Charts | Recharts |
| Database | Supabase (PostgreSQL) |
| Hosting | Vercel |
| Data pipeline | Python 3 + lxml + supabase-py |

## Pages

| Page | Route | Description |
|---|---|---|
| Dashboard | `/` | KPI overview, needs-reorder table with PDX/HK months, stock coverage chart |
| Demand Forecast | `/forecast` | All SKUs sorted by coverage, trend sparklines |
| By Location | `/locations` | PDX vs HK on-hand with critical-only filter |
| Item Forecast | `/item/:sku` | Per-SKU deep-dive: 8-month history, 12-month projection, location breakdown |
| PO History | `/po-history` | All purchase orders with status filter |
| On Order | `/on-order` | Outstanding POs with follow-up email drafts |
| Reorder Alerts | `/reorder` | SKUs under 3 months coverage with suggested order quantities |

## Running Locally

```bash
# 1. Clone the repo
git clone https://github.com/tomasswinnen/realwear-inventory.git
cd realwear-inventory

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env.local
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 4. Start dev server
npm run dev
# Opens at http://localhost:5173
```

## Environment Variables

Create `.env.local` (never commit this file):

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

For the Python data pipeline, create `.env` in the project root:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   # service_role key — never expose to browser
```

## Database Setup

Run `supabase_schema.sql` once in the Supabase SQL editor to create all tables and RLS policies.

Tables: `skus`, `inventory_snapshot`, `monthly_sales`, `inventory_valuation`, `po_history`, `open_pos`.

## Updating Data

The data pipeline reads NetSuite XML export files (`.xls` format) and upserts into Supabase.

### Step 1 — Export from NetSuite

Download these reports from NetSuite and place them in the same folder:

| NetSuite Report | File pattern |
|---|---|
| Item Quantity Sold per Month | `ItemQuantitySoldperMonthResults*.xls` |
| Current Inventory Snapshot | `CurrentInventorySnapshot*.xls` or `CustomCurrentInventorySnapshot*.xls` |
| Inventory Valuation Summary | `InventoryValuationSummary*.xls` |
| Purchase Order History | `PurchaseOrderHistory*.xls` *(optional)* |
| Bryant's Open Purchase Orders | `Bryant_sOpenPurchaseOrders*.xls` *(optional)* |

### Step 2 — Run the pipeline

```bash
# Install Python dependencies (first time only)
pip install lxml supabase python-dotenv

# Run — point at the folder containing your NetSuite exports
python update_inventory.py "C:\Users\swinn\Desktop\Accessory Invt Mngt"
```

Example output:

```
>> skus (FK parent)       upserted 129 rows
>> inventory_valuation    upserted 124 rows
>> inventory_snapshot     upserted 124 rows
>> monthly_sales          upserted 413 rows
```

The script is safe to re-run — all operations are upserts, keyed on SKU + date/month.

## Deploying

The project auto-deploys to Vercel on every `git push` to `master`.

For a first-time or manual deploy:

```bash
npx vercel --prod
```

Set these in Vercel project settings → Environment Variables:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

## Automated Daily Updates (GitHub Actions)

The workflow `.github/workflows/daily-update.yml` runs at **2:00 AM UTC every day**.  
It downloads the 3 NetSuite report files from OneDrive and upserts them to Supabase automatically via `github_update.py`.

You can also trigger it manually from **GitHub → Actions → Daily Inventory Update → Run workflow**.

### Required GitHub Secrets

Go to **GitHub repo → Settings → Secrets and variables → Actions** and add:

| Secret | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL (`https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Supabase `service_role` key (has write access) |
| `MS_TENANT_ID` | Azure AD tenant ID (from Entra ID → Overview) |
| `MS_CLIENT_ID` | App registration client ID |
| `MS_CLIENT_SECRET` | App registration client secret value |

### Required GitHub Variable

Under the same **Secrets and variables → Variables** tab, add:

| Variable | Example value |
|---|---|
| `ONEDRIVE_USER` | `tomas.swinnen@realwear.com` |

This is the UPN (email) of the Microsoft 365 user whose OneDrive contains the `/NetSuite Reports` folder.

### Microsoft App Registration (Graph API access)

The workflow authenticates as a service principal using the [client credentials flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow) — no user login required.

**Steps to set up in [Azure Portal → Entra ID → App registrations](https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps):**

1. **New registration** — name it e.g. `realwear-inventory-sync`, single tenant.

2. **Certificates & secrets** → New client secret → copy the **Value** (this is `MS_CLIENT_SECRET`).

3. **API permissions** → Add a permission → Microsoft Graph → **Application permissions** → add:
   - `Files.Read.All` — to read OneDrive files without a signed-in user

4. Click **Grant admin consent** for your organisation.

5. Copy **Application (client) ID** → `MS_CLIENT_ID`  
   Copy **Directory (tenant) ID** → `MS_TENANT_ID`

> **Note:** `Files.Read.All` is an app-level permission. The app can read any user's OneDrive in the tenant. Restrict access further via SharePoint site policies if needed.

### OneDrive folder structure expected

The script looks for files in `/{ONEDRIVE_USER}'s OneDrive/NetSuite Reports/` and matches by name:

| Report | Name must contain |
|---|---|
| Inventory Valuation Summary | `InventoryValuation` |
| Current Inventory Snapshot | `CurrentInventorySnapshot` or `CustomCurrentInventorySnapshot` |
| Item Quantity Sold per Month | `ItemQuantitySold` |

Files can have any suffix (e.g. date stamps) as long as they end in `.xls` or `.xlsx`.

---

## Roadmap

### Other planned improvements

- Email / Slack alerts when a SKU drops below its reorder threshold
- Attach rate tracking (accessory units per device sold)
- Supplier lead time analytics and on-time delivery scoring
- Multi-currency cost comparison (HK USD vs Portland USD landed cost)
