import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { formatCurrency, isValidSku } from '../utils/coverage';

// Margen por SKU: precio de venta REAL de los últimos 90 días (facturas menos
// notas de crédito, solo líneas con precio) contra el costo promedio actual
// del inventario (inv_value / on_hand). Fuente: tabla sku_margins.
//
// Ojo interpretando: el costo es el promedio de lo que hay EN STOCK hoy, no el
// costo de las unidades vendidas. Para decisiones de precio alcanza; para
// contabilidad exacta de COGS, no.
async function fetchMargins() {
  const [mRes, skusRes] = await Promise.all([
    supabase.from('sku_margins').select('*').order('revenue_90d', { ascending: false }),
    excludeSkus(supabase.from('skus').select('sku, description')),
  ]);
  if (mRes.error) throw new Error(mRes.error.message);
  return { rows: mRes.data ?? [], skus: skusRes.data ?? [] };
}

function marginClass(pct) {
  if (pct == null) return 'text-muted';
  if (pct < 0) return 'text-danger';
  if (pct < 20) return 'text-warning';
  return 'text-success';
}

export function Margins() {
  const { data, loading, error, refetch } = useQuery(fetchMargins, []);
  const [soloCatalogo, setSoloCatalogo] = useState(true);

  const { rows, kpis } = useMemo(() => {
    if (!data) return { rows: [], kpis: null };
    const descBySku = Object.fromEntries(data.skus.map(s => [s.sku, s.description]));
    const enCatalogo = new Set(data.skus.map(s => s.sku));
    const rows = data.rows
      .filter(r => !soloCatalogo || enCatalogo.has(r.sku))
      .map(r => ({ ...r, description: descBySku[r.sku] ?? '' }));

    const revenue = rows.reduce((s, r) => s + (r.revenue_90d ?? 0), 0);
    const conCosto = rows.filter(r => r.margin_pct != null && r.revenue_90d);
    // margen ponderado por revenue, no promedio simple: un SKU de $100 no
    // puede pesar lo mismo que uno de $500.000
    const ponderado = conCosto.length
      ? conCosto.reduce((s, r) => s + r.margin_pct * r.revenue_90d, 0)
        / conCosto.reduce((s, r) => s + r.revenue_90d, 0)
      : null;
    return {
      rows,
      kpis: {
        revenue,
        margen: ponderado,
        skus: rows.length,
        sinCosto: rows.filter(r => r.margin_pct == null).length,
      },
    };
  }, [data, soloCatalogo]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Margins</h1>
        <p className="text-xs text-muted font-mono mt-0.5">Real selling price (last 90 days) vs current average inventory cost</p>
      </div>

      {loading ? <KPISkeleton count={4} /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="Revenue 90d" value={formatCurrency(kpis.revenue)} />
          <KPICard label="Weighted Margin" value={kpis.margen != null ? `${kpis.margen.toFixed(1)}%` : '—'} />
          <KPICard label="SKUs Sold" value={kpis.skus} />
          <KPICard label="No Cost Data" value={kpis.sinCosto} />
        </div>
      )}

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-mono text-muted cursor-pointer">
          <input type="checkbox" checked={soloCatalogo} onChange={e => setSoloCatalogo(e.target.checked)} />
          Only catalog SKUs
        </label>
        {!loading && <span className="ml-auto text-xs font-mono text-muted">{rows.length} SKUs</span>}
      </div>

      {loading ? <TableSkeleton rows={10} cols={7} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['SKU', 'Description', 'Qty 90d', 'Revenue 90d', 'Avg Price', 'Avg Cost', 'Margin'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.sku} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5">
                      {isValidSku(r.sku)
                        ? <Link to={`/item/${r.sku}`} className="font-mono text-accent hover:text-accent/80">{r.sku}</Link>
                        : <span className="font-mono text-muted">{r.sku}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted font-sans max-w-[240px] truncate" title={r.description}>{r.description}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-300">{r.qty_90d?.toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{formatCurrency(r.revenue_90d)}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-300">{formatCurrency(r.avg_price)}</td>
                    <td className="px-4 py-2.5 font-mono text-muted">{r.avg_cost != null ? formatCurrency(r.avg_cost) : '—'}</td>
                    <td className={`px-4 py-2.5 font-mono ${marginClass(r.margin_pct)}`}>
                      {r.margin_pct != null ? `${r.margin_pct.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
            Cost is today's average inventory cost, not the cost of the units actually sold —
            good for pricing decisions, not for exact COGS accounting.
          </p>
        </div>
      )}
    </div>
  );
}
