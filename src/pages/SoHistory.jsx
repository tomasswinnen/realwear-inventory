import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { StatusBadge } from '../components/StatusBadge';
import { formatCurrency } from '../utils/coverage';

// Historial de sales orders (18 meses, cerradas incluidas) enfocado en el
// COSTO DE ENVÍO: qué se le cobró de envío al cliente en cada orden
// (so_history, del pipeline) contra lo que se le pagó al carrier
// (shipping_costs, cargada desde facturas — fase 2; hasta que haya facturas
// la columna muestra "—"). El puente entre ambas es el tracking number:
// shipping_costs.tracking → so_tracking → orden.
const PAGINA = 1000;

async function paginado(armar) {
  const filas = [];
  for (let desde = 0; desde < 20000; desde += PAGINA) {
    const res = await armar().range(desde, desde + PAGINA - 1);
    if (res.error) throw new Error(res.error.message);
    filas.push(...(res.data ?? []));
    if ((res.data ?? []).length < PAGINA) break;
  }
  return filas;
}

async function fetchSoHistory() {
  const historia = await paginado(() =>
    supabase.from('so_history').select('*').order('so_date', { ascending: false }));

  // Costos reales (fase 2). Tabla puede estar vacía o no existir todavía.
  let costos = [];
  try {
    costos = await paginado(() => supabase.from('shipping_costs').select('*'));
  } catch { costos = []; }

  // Mapear cada costo a su orden vía el tracking number
  const pagadoPorSo = new Map();
  if (costos.length) {
    const trackings = [...new Set(costos.map(c => c.tracking).filter(Boolean))];
    const mapa = new Map(); // tracking -> so_number
    for (let i = 0; i < trackings.length; i += 100) {
      const res = await supabase.from('so_tracking')
        .select('so_number, tracking')
        .in('tracking', trackings.slice(i, i + 100));
      if (res.error) break;
      for (const t of res.data ?? []) mapa.set(t.tracking, t.so_number);
    }
    for (const c of costos) {
      const so = mapa.get(c.tracking);
      if (!so) continue;
      pagadoPorSo.set(so, (pagadoPorSo.get(so) ?? 0) + (c.cost ?? 0));
    }
  }

  return { historia, pagadoPorSo, hayCostos: costos.length > 0 };
}

export function SoHistory() {
  const { data, loading, error, refetch } = useQuery(fetchSoHistory, []);
  const [search, setSearch] = useState('');
  const [soloConEnvio, setSoloConEnvio] = useState(false);
  const [exportando, setExportando] = useState(false);

  const { filas, kpis } = useMemo(() => {
    if (!data) return { filas: [], kpis: null };
    const q = search.toLowerCase();
    const filas = data.historia
      .map(r => ({
        ...r,
        pagado: data.pagadoPorSo.get(r.so_number) ?? null,
      }))
      .filter(r => {
        if (soloConEnvio && !(r.shipping_charged > 0) && r.pagado == null) return false;
        return !q
          || r.so_number?.toLowerCase().includes(q)
          || r.customer?.toLowerCase().includes(q)
          || r.status?.toLowerCase().includes(q);
      });

    const kpis = {
      ordenes: filas.length,
      cobrado: filas.reduce((s, r) => s + (r.shipping_charged ?? 0), 0),
      pagado: filas.reduce((s, r) => s + (r.pagado ?? 0), 0),
      conEnvio: filas.filter(r => (r.shipping_charged ?? 0) > 0).length,
    };
    return { filas, kpis };
  }, [data, search, soloConEnvio]);

  const exportar = async () => {
    if (exportando) return;
    setExportando(true);
    try {
      const XLSX = await import('xlsx');
      const datos = filas.map(r => ({
        'SO Number': r.so_number,
        'Date': r.so_date,
        'Customer': r.customer,
        'Status': r.status,
        'Amount': r.amount,
        'Shipping Charged': r.shipping_charged,
        'Shipping Paid': r.pagado ?? '',
        'Shipping Diff': r.pagado != null ? (r.shipping_charged ?? 0) - r.pagado : '',
      }));
      const ws = XLSX.utils.json_to_sheet(datos);
      ws['!cols'] = [{ wch: 12 }, { wch: 11 }, { wch: 32 }, { wch: 20 },
                     { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'SO History');
      XLSX.writeFile(wb, `so_history_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch { /* export fallido: no rompe la página */ }
    setExportando(false);
  };

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">SO History</h1>
        <p className="text-xs text-muted font-mono mt-0.5">
          Every sales order from the last 18 months — shipping charged to the customer vs. paid to the carrier
        </p>
      </div>

      {loading ? <KPISkeleton count={4} /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="Orders" value={kpis.ordenes.toLocaleString()} sub={`${kpis.conEnvio} charged shipping`} />
          <KPICard label="Shipping Charged" value={formatCurrency(kpis.cobrado)} />
          <KPICard
            label="Shipping Paid"
            value={data?.hayCostos ? formatCurrency(kpis.pagado) : '—'}
            sub={data?.hayCostos ? undefined : 'loads from carrier invoices'}
          />
          <KPICard
            label="Shipping Balance"
            value={data?.hayCostos ? formatCurrency(kpis.cobrado - kpis.pagado) : '—'}
            sub={data?.hayCostos ? 'charged − paid' : 'needs invoice data'}
          />
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          placeholder="SO #, customer or status…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-64"
        />
        <label className="flex items-center gap-2 text-xs font-mono text-muted cursor-pointer select-none">
          <input type="checkbox" checked={soloConEnvio} onChange={e => setSoloConEnvio(e.target.checked)}
            className="accent-current" />
          only orders with shipping
        </label>
        <button type="button" onClick={exportar} disabled={exportando}
          className="px-4 py-2 rounded border border-white/[0.12] text-xs font-mono text-slate-300 hover:text-white hover:border-accent/50 disabled:opacity-60 transition-colors">
          {exportando ? 'Exporting…' : 'Export Excel'}
        </button>
        {!loading && <span className="ml-auto text-xs font-mono text-muted">{filas.length} orders</span>}
      </div>

      {loading ? <TableSkeleton rows={12} cols={7} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['SO Number', 'Date', 'Customer', 'Status', 'Amount', 'Shipping Charged', 'Shipping Paid', 'Diff'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted font-mono">
                    No data yet — runs with the pipeline (SQL_so_history.sql + one run)
                  </td></tr>
                ) : filas.slice(0, 500).map(r => {
                  const diff = r.pagado != null ? (r.shipping_charged ?? 0) - r.pagado : null;
                  return (
                    <tr key={r.so_number} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5 font-mono text-white whitespace-nowrap">{r.so_number}</td>
                      <td className="px-4 py-2.5 font-mono text-muted whitespace-nowrap">{r.so_date}</td>
                      <td className="px-4 py-2.5 font-sans text-slate-300 max-w-[260px] truncate" title={r.customer}>{r.customer}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-2.5 font-mono text-slate-300">{formatCurrency(r.amount)}</td>
                      <td className="px-4 py-2.5 font-mono text-white">
                        {(r.shipping_charged ?? 0) > 0 ? formatCurrency(r.shipping_charged) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-300">
                        {r.pagado != null ? formatCurrency(r.pagado) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-2.5 font-mono">
                        {diff == null ? <span className="text-muted">—</span> : (
                          <span className={diff < 0 ? 'text-danger' : 'text-success'}>
                            {diff >= 0 ? '+' : ''}{formatCurrency(diff)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
            Showing up to 500 rows — search to narrow, or Export Excel for everything.
            "Shipping paid" fills in as carrier invoices are loaded; the link between an invoice
            and an order is the tracking number.
          </p>
        </div>
      )}
    </div>
  );
}
