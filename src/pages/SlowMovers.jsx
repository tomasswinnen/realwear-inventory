import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { formatCurrency, isValidSku } from '../utils/coverage';

// Slow movers: SKUs con stock pero sin ventas hace N meses — plata dormida en
// el depósito. Cruza inventory_valuation (qué hay y cuánto vale) con
// monthly_sales (última venta). Todo ya está en Supabase.
async function fetchSlowMovers() {
  const [skusRes, valRes] = await Promise.all([
    excludeSkus(supabase.from('skus').select('sku, description')),
    excludeSkus(supabase.from('inventory_valuation').select('sku, on_hand, inv_value')),
  ]);
  if (valRes.error) throw new Error(valRes.error.message);

  // monthly_sales acumula meses × SKUs y puede pasar el tope de 1000: paginar
  const ventas = [];
  for (let desde = 0; desde < 5000; desde += 1000) {
    const res = await supabase.from('monthly_sales')
      .select('sku, month, qty_sold').gt('qty_sold', 0)
      .order('month', { ascending: false })
      .range(desde, desde + 999);
    if (res.error) throw new Error(res.error.message);
    ventas.push(...(res.data ?? []));
    if ((res.data ?? []).length < 1000) break;
  }
  return { skus: skusRes.data ?? [], valuation: valRes.data ?? [], ventas };
}

function mesesDesde(mes) {
  if (!mes) return null;
  const d = new Date(mes + 'T00:00:00');
  const hoy = new Date();
  return (hoy.getFullYear() - d.getFullYear()) * 12 + (hoy.getMonth() - d.getMonth());
}

const UMBRALES = [[3, '3+ months'], [6, '6+ months'], [12, '12+ months']];

export function SlowMovers() {
  const { data, loading, error, refetch } = useQuery(fetchSlowMovers, []);
  const [umbral, setUmbral] = useState(6);

  const { filas, kpis } = useMemo(() => {
    if (!data) return { filas: [], kpis: null };
    const descBySku = Object.fromEntries(data.skus.map(s => [s.sku, s.description]));
    const ultimaVenta = new Map();
    for (const v of data.ventas) {
      const prev = ultimaVenta.get(v.sku);
      if (!prev || v.month > prev) ultimaVenta.set(v.sku, v.month);
    }

    const conStock = data.valuation.filter(r => (r.on_hand ?? 0) > 0);
    const valorTotal = conStock.reduce((s, r) => s + (r.inv_value ?? 0), 0);

    const filas = conStock
      .map(r => {
        const mes = ultimaVenta.get(r.sku) ?? null;
        return {
          sku: r.sku,
          description: descBySku[r.sku] ?? '',
          on_hand: r.on_hand ?? 0,
          inv_value: r.inv_value ?? 0,
          ultima: mes,
          meses: mes ? mesesDesde(mes) : null, // null = sin ventas registradas
        };
      })
      .filter(r => r.meses === null || r.meses >= umbral)
      .sort((a, b) => b.inv_value - a.inv_value);

    const kpis = {
      skus: filas.length,
      valor: filas.reduce((s, r) => s + r.inv_value, 0),
      unidades: filas.reduce((s, r) => s + r.on_hand, 0),
      porcentaje: valorTotal ? Math.round(filas.reduce((s, r) => s + r.inv_value, 0) / valorTotal * 100) : 0,
    };
    return { filas, kpis };
  }, [data, umbral]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Slow Movers</h1>
        <p className="text-xs text-muted font-mono mt-0.5">Stock on hand with no sales in months — capital sitting in the warehouse</p>
      </div>

      {loading ? <KPISkeleton count={4} /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="Slow SKUs" value={kpis.skus} />
          <KPICard label="Value Tied Up" value={formatCurrency(kpis.valor)} />
          <KPICard label="Units" value={kpis.unidades.toLocaleString()} />
          <KPICard label="% of Inventory Value" value={`${kpis.porcentaje}%`} />
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="flex border border-white/[0.12] rounded overflow-hidden text-xs font-mono">
          {UMBRALES.map(([m, label]) => (
            <button key={m} onClick={() => setUmbral(m)}
              className={`px-3 py-2 transition-colors ${umbral === m ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-white/5'}`}>
              {label}
            </button>
          ))}
        </div>
        {!loading && <span className="ml-auto text-xs font-mono text-muted">{filas.length} SKUs</span>}
      </div>

      {loading ? <TableSkeleton rows={10} cols={6} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['SKU', 'On Hand', 'Value', 'Last Sale', 'Months Still'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted font-mono">Nothing this slow — good sign</td></tr>
                ) : filas.map(r => (
                  <tr key={r.sku} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5 max-w-[340px]">
                      {isValidSku(r.sku)
                        ? <Link to={`/item/${r.sku}`} className="font-mono text-accent hover:text-accent/80">{r.sku}</Link>
                        : <span className="font-mono text-muted">{r.sku}</span>}
                      {r.description && (
                        <p className="text-[10px] text-muted font-sans truncate" title={r.description}>{r.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-white">{r.on_hand.toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{formatCurrency(r.inv_value)}</td>
                    <td className="px-4 py-2.5 font-mono text-muted">{r.ultima ? r.ultima.slice(0, 7) : 'never (12 mo window)'}</td>
                    <td className="px-4 py-2.5 font-mono">
                      {r.meses === null
                        ? <span className="text-danger">12+</span>
                        : <span className={r.meses >= 12 ? 'text-danger' : r.meses >= 6 ? 'text-warning' : 'text-slate-300'}>{r.meses}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
            "Never" means no sales in the 12 months of history we track. Sorted by value tied up — the top rows are the liquidation candidates.
          </p>
        </div>
      )}
    </div>
  );
}
