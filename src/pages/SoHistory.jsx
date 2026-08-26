import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { StatusBadge } from '../components/StatusBadge';
import { formatCurrency, isValidSku } from '../utils/coverage';

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

  // Tracking numbers de cada orden (tabla chica, se trae entera)
  let trackTodos = [];
  try {
    trackTodos = await paginado(() =>
      supabase.from('so_tracking').select('so_number, tracking, ship_date'));
  } catch { trackTodos = []; }
  const trackBySo = new Map();
  for (const t of trackTodos) {
    if (!trackBySo.has(t.so_number)) trackBySo.set(t.so_number, []);
    trackBySo.get(t.so_number).push(t);
  }

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
      // Primero se intenta por tracking (NetSuite); si la factura ya trae la
      // orden directa (detalle Javelin: shipping_costs.so_number), se usa esa.
      const so = mapa.get(c.tracking) || c.so_number || null;
      if (!so) continue;
      pagadoPorSo.set(so, (pagadoPorSo.get(so) ?? 0) + (c.cost ?? 0));
    }
  }

  const skusRes = await excludeSkus(supabase.from('skus').select('sku, description'));
  const descBySku = Object.fromEntries((skusRes.data ?? []).map(s => [s.sku, s.description]));

  // Warehouse de origen por orden: sale de las líneas (so_lines.location).
  // Se traen solo esas dos columnas; si la tabla/columna aún no existe, la
  // página funciona sin la columna de warehouse.
  const whBySo = new Map();
  try {
    const lineas = await paginado(() =>
      supabase.from('so_lines').select('so_number, location').order('id', { ascending: true }));
    for (const l of lineas) {
      if (!l.location) continue;
      if (!whBySo.has(l.so_number)) whBySo.set(l.so_number, new Set());
      whBySo.get(l.so_number).add(l.location);
    }
  } catch { /* sin location todavía */ }

  return { historia, pagadoPorSo, trackBySo, descBySku, whBySo, hayCostos: costos.length > 0 };
}

// Nombres cortos de depósito para la tabla
function warehouseCorto(loc) {
  if (!loc) return null;
  const l = loc.toLowerCase();
  if (l.includes('portland')) return 'Portland';
  if (l.includes('hong kong')) return 'Hong Kong';
  return loc.replace(/^\d+\s*-\s*/, '').trim();
}

// Detalle de UNA orden, cargado recién al desplegarla: qué items llevaba
// (so_lines) y qué seriales salieron (serial_shipments).
async function fetchDetalleSo(so) {
  const [linesRes, serRes] = await Promise.all([
    supabase.from('so_lines').select('*').eq('so_number', so),
    supabase.from('serial_shipments').select('serial, sku, doc_type, fecha')
      .eq('so_number', so).limit(1000),
  ]);
  return {
    lines: linesRes.error ? null : linesRes.data ?? [], // null = tabla ausente
    serials: serRes.error ? [] : (serRes.data ?? []).filter(s => s.doc_type === 'ItemShip'),
  };
}

// Fila + su detalle desplegado (el detalle solo se monta al abrir, así la
// consulta por orden se hace recién ahí)
function FragmentoFila({ open, detalle, children }) {
  return (
    <>
      {children}
      {open && (
        <tr className="border-b border-white/[0.04] bg-white/[0.015]">
          <td colSpan={10}>{detalle}</td>
        </tr>
      )}
    </>
  );
}

function Chevron({ open }) {
  return (
    <svg className={`w-3.5 h-3.5 inline-block transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function DetalleSo({ so, descBySku }) {
  const { data, loading } = useQuery(() => fetchDetalleSo(so), [so]);
  if (loading) return <p className="px-6 py-3 text-xs font-mono text-muted">Loading order detail…</p>;
  const nombre = sku => (descBySku[sku] ? `${sku} — ${descBySku[sku]}` : sku);
  return (
    <div className="px-6 py-3 space-y-3">
      {data?.lines === null ? (
        <p className="text-xs font-mono text-muted">
          Line detail not loaded yet — run SQL_so_lines.sql in Supabase plus one pipeline run.
        </p>
      ) : (data?.lines ?? []).length === 0 ? (
        <p className="text-xs font-mono text-muted">No line detail for this order.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr>
              {['Item', 'Warehouse', 'Qty', 'Amount'].map(h => (
                <th key={h} className="px-3 py-1.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[9px]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l, i) => (
              <tr key={i} className="border-t border-white/[0.04]">
                <td className="px-3 py-1.5 max-w-[380px] truncate" title={nombre(l.sku)}>
                  {isValidSku(l.sku)
                    ? <Link to={`/item/${l.sku}`} onClick={e => e.stopPropagation()} className="font-mono text-accent hover:text-accent/80">{nombre(l.sku)}</Link>
                    : <span className="font-mono text-muted">{nombre(l.sku)}</span>}
                </td>
                <td className="px-3 py-1.5 font-mono text-slate-300 whitespace-nowrap">
                  {l.location ? warehouseCorto(l.location) : <span className="text-muted">—</span>}
                </td>
                <td className="px-3 py-1.5 font-mono text-white">{l.qty?.toLocaleString()}</td>
                <td className="px-3 py-1.5 font-mono text-slate-300">{formatCurrency(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(data?.serials ?? []).length > 0 && (
        <div className="pt-2 border-t border-white/[0.06]">
          <p className="text-[9px] text-muted font-sans font-medium uppercase tracking-wider mb-1">
            Serials shipped ({data.serials.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.serials.slice(0, 120).map((s, i) => (
              <span key={i} className="font-mono text-[10px] bg-white/[0.04] border border-white/[0.08] rounded px-1.5 py-0.5"
                title={`${s.sku} · ${s.fecha}`}>
                {s.serial}
              </span>
            ))}
            {data.serials.length > 120 && (
              <span className="text-[10px] font-mono text-muted">+{data.serials.length - 120} more (see Serial Numbers)</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SoHistory() {
  const { data, loading, error, refetch } = useQuery(fetchSoHistory, []);
  const [search, setSearch] = useState('');
  const [soloConEnvio, setSoloConEnvio] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [abiertas, setAbiertas] = useState(() => new Set());

  const toggle = so => setAbiertas(prev => {
    const next = new Set(prev);
    if (next.has(so)) next.delete(so); else next.add(so);
    return next;
  });

  const { filas, kpis } = useMemo(() => {
    if (!data) return { filas: [], kpis: null };
    const q = search.toLowerCase();
    const filas = data.historia
      .map(r => ({
        ...r,
        pagado: data.pagadoPorSo.get(r.so_number) ?? null,
        tracking: data.trackBySo.get(r.so_number) ?? [],
        warehouses: [...(data.whBySo.get(r.so_number) ?? [])].map(warehouseCorto),
      }))
      .filter(r => {
        if (soloConEnvio && !(r.shipping_charged > 0) && r.pagado == null) return false;
        return !q
          || r.so_number?.toLowerCase().includes(q)
          || r.customer?.toLowerCase().includes(q)
          || r.status?.toLowerCase().includes(q)
          || r.warehouses.some(w => w?.toLowerCase().includes(q))
          || r.tracking.some(t => t.tracking?.toLowerCase().includes(q));
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
        'Warehouse': r.warehouses.join(' + '),
        'Tracking': r.tracking.map(t => t.tracking).join(', '),
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
          placeholder="SO #, customer, status or tracking…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-full sm:w-64"
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
                  {['SO Number', 'Date', 'Customer', 'Warehouse', 'Status', 'Amount', 'Shipping Charged', 'Shipping Paid', 'Diff', 'Tracking'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-muted font-mono">
                    No data yet — runs with the pipeline (SQL_so_history.sql + one run)
                  </td></tr>
                ) : filas.slice(0, 500).map(r => {
                  const diff = r.pagado != null ? (r.shipping_charged ?? 0) - r.pagado : null;
                  const open = abiertas.has(r.so_number);
                  return (
                    <FragmentoFila key={r.so_number} open={open}
                      detalle={<DetalleSo so={r.so_number} descBySku={data.descBySku} />}>
                    <tr onClick={() => toggle(r.so_number)}
                      className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors cursor-pointer select-none">
                      <td className="px-4 py-2.5 font-mono text-white whitespace-nowrap">
                        <span className="text-muted mr-1.5"><Chevron open={open} /></span>
                        {r.so_number}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-muted whitespace-nowrap">{r.so_date}</td>
                      <td className="px-4 py-2.5 font-sans text-slate-300 max-w-[260px] truncate" title={r.customer}>{r.customer}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-300 whitespace-nowrap">
                        {r.warehouses.length ? r.warehouses.join(' + ') : <span className="text-muted">—</span>}
                      </td>
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
                      <td className="px-4 py-2.5 font-mono text-[11px]">
                        {r.tracking.length === 0
                          ? <span className="text-muted">—</span>
                          : r.tracking.map((t, i) => (
                            <div key={i} className="whitespace-nowrap text-slate-300" title={`Despachado ${t.ship_date}`}>
                              {t.tracking}
                            </div>
                          ))}
                      </td>
                    </tr>
                    </FragmentoFila>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
            Click an order to see what shipped in it (items and serials).
            Showing up to 500 rows — search to narrow, or Export Excel for everything.
            "Shipping paid" fills in as carrier invoices are loaded; costs are matched to the
            order by tracking number, or directly when the invoice itemizes the order (Javelin).
          </p>
        </div>
      )}
    </div>
  );
}
