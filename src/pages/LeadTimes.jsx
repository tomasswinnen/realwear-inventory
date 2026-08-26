import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { isValidSku } from '../utils/coverage';

// Lead time REAL: días entre la fecha de la PO y la fecha de cada recepción,
// medido de las transacciones (no el lead_time_days configurado a mano en el
// catálogo). Fuente: tabla lead_times, una fila por recepción desde 2024.
async function fetchLeadTimes() {
  const [res, skusRes] = await Promise.all([
    supabase.from('lead_times').select('*').order('receipt_date', { ascending: false }),
    excludeSkus(supabase.from('skus').select('sku, description')),
  ]);
  if (res.error) throw new Error(res.error.message);
  return { rows: res.data ?? [], skus: skusRes.data ?? [] };
}

function agrupar(rows, clave) {
  const g = new Map();
  for (const r of rows) {
    const k = r[clave] ?? '(sin dato)';
    if (!g.has(k)) g.set(k, { clave: k, dias: [], last: null, vendors: new Set(), skus: new Set() });
    const e = g.get(k);
    if (r.dias != null) e.dias.push(r.dias);
    if (!e.last || (r.receipt_date && r.receipt_date > e.last)) e.last = r.receipt_date;
    if (r.vendor) e.vendors.add(r.vendor);
    if (r.sku) e.skus.add(r.sku);
  }
  return [...g.values()].map(e => {
    const d = e.dias.slice().sort((a, b) => a - b);
    return {
      clave: e.clave,
      n: d.length,
      avg: d.length ? Math.round(d.reduce((s, x) => s + x, 0) / d.length) : null,
      min: d.length ? d[0] : null,
      max: d.length ? d[d.length - 1] : null,
      // mediana: menos sensible que el promedio a una recepción atrasada suelta
      p50: d.length ? d[Math.floor(d.length / 2)] : null,
      last: e.last,
      otros: e.clave && e.vendors.has(e.clave) ? e.skus.size : e.vendors.size,
    };
  }).sort((a, b) => (b.n - a.n));
}

export function LeadTimes() {
  const { data, loading, error, refetch } = useQuery(fetchLeadTimes, []);
  const [por, setPor] = useState('sku');

  const { grupos, kpis, descBySku } = useMemo(() => {
    if (!data) return { grupos: [], kpis: null, descBySku: {} };
    const descBySku = Object.fromEntries(data.skus.map(s => [s.sku, s.description]));
    const grupos = agrupar(data.rows, por);
    const todos = data.rows.filter(r => r.dias != null).map(r => r.dias).sort((a, b) => a - b);
    const kpis = {
      recepciones: todos.length,
      mediana: todos.length ? todos[Math.floor(todos.length / 2)] : null,
      promedio: todos.length ? Math.round(todos.reduce((s, x) => s + x, 0) / todos.length) : null,
    };
    return { grupos, kpis, descBySku };
  }, [data, por]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Lead Times</h1>
        <p className="text-xs text-muted font-mono mt-0.5">Real PO → receipt days, measured from transactions since 2024</p>
      </div>

      {loading ? <KPISkeleton count={3} /> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KPICard label="Receipts Measured" value={kpis.recepciones.toLocaleString()} />
          <KPICard label="Median Lead Time" value={kpis.mediana != null ? `${kpis.mediana} days` : '—'} />
          <KPICard label="Average Lead Time" value={kpis.promedio != null ? `${kpis.promedio} days` : '—'} />
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="flex border border-white/[0.12] rounded overflow-hidden text-xs font-mono">
          {[['sku', 'By SKU'], ['vendor', 'By Vendor']].map(([v, label]) => (
            <button key={v} onClick={() => setPor(v)}
              className={`px-3 py-2 transition-colors ${por === v ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-white/5'}`}>
              {label}
            </button>
          ))}
        </div>
        {!loading && <span className="ml-auto text-xs font-mono text-muted">{grupos.length} {por === 'sku' ? 'SKUs' : 'vendors'}</span>}
      </div>

      {loading ? <TableSkeleton rows={10} cols={7} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {[por === 'sku' ? 'SKU' : 'Vendor', 'Receipts', 'Median', 'Average', 'Fastest', 'Slowest', 'Last Receipt'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grupos.map(g => (
                  <tr key={g.clave} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5 max-w-[320px]">
                      {por === 'sku' && isValidSku(g.clave)
                        ? <Link to={`/item/${g.clave}`} className="font-mono text-accent hover:text-accent/80">{g.clave}</Link>
                        : <span className="font-sans text-slate-300">{g.clave}</span>}
                      {por === 'sku' && descBySku[g.clave] && (
                        <p className="text-[10px] text-muted font-sans truncate" title={descBySku[g.clave]}>
                          {descBySku[g.clave]}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-muted">{g.n}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{g.p50 != null ? `${g.p50} d` : '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-300">{g.avg != null ? `${g.avg} d` : '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-success">{g.min != null ? `${g.min} d` : '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-danger">{g.max != null ? `${g.max} d` : '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-muted whitespace-nowrap">{g.last ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
            Median is more robust than average when a single late receipt skews a supplier.
            Use these instead of the hand-set lead_time_days when planning orders.
          </p>
        </div>
      )}
    </div>
  );
}
