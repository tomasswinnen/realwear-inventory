import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { StatusBadge } from '../components/StatusBadge';
import { formatCurrency, isValidSku } from '../utils/coverage';

// Backlog = líneas de sales orders abiertas, AGRUPADAS por SO: una fila por
// orden, desplegable para ver las líneas de adentro. Fuente: sales_backlog
// (refrescada por el pipeline) + so_tracking (tracking numbers de los
// fulfillments ya despachados de cada SO, cuando existen).
async function fetchBacklog() {
  const [backlogRes, skusRes] = await Promise.all([
    supabase.from('sales_backlog').select('*').order('so_date', { ascending: false }),
    excludeSkus(supabase.from('skus').select('sku, description')),
  ]);
  if (backlogRes.error) throw new Error(backlogRes.error.message);
  const rows = backlogRes.data ?? [];

  // Tracking: solo el de las SO que están en el backlog, pedido por tandas
  // para no armar una URL kilométrica ni chocar con el tope de 1000 filas de
  // PostgREST. Si la tabla todavía no existe (SQL pendiente), el backlog
  // funciona igual, sin tracking.
  const soNumbers = [...new Set(rows.map(r => r.so_number).filter(Boolean))];
  const tracking = [];
  for (let i = 0; i < soNumbers.length; i += 100) {
    const res = await supabase.from('so_tracking')
      .select('so_number, fulfillment, ship_date, tracking')
      .in('so_number', soNumbers.slice(i, i + 100));
    if (res.error) break; // tabla ausente u otro error: seguimos sin tracking
    tracking.push(...(res.data ?? []));
  }
  return { rows, skus: skusRes.data ?? [], tracking };
}

// Lookup universal de tracking: so_tracking guarda ventas (SO), transfers
// (TO) y compras (PO) juntas — pegás un tracking number de una factura del
// carrier y te dice de qué orden es, aunque esté cerrada hace meses.
// Se consulta recién con 4+ caracteres para no disparar en cada tecla.
async function buscarTracking(q) {
  const s = q.trim();
  if (s.length < 4) return [];
  const like = `%${s}%`;
  const res = await supabase.from('so_tracking')
    .select('*')
    .or(`so_number.ilike.${like},tracking.ilike.${like}`)
    .order('ship_date', { ascending: false })
    .limit(20);
  return res.error ? [] : res.data ?? [];
}

const TIPO_ORDEN = { SalesOrd: 'SO', TrnfrOrd: 'TO', PurchOrd: 'PO' };

function Chevron({ open }) {
  return (
    <svg className={`w-3.5 h-3.5 inline-block transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function Backlog() {
  const { data, loading, error, refetch } = useQuery(fetchBacklog, []);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [abiertos, setAbiertos] = useState(() => new Set());
  const { data: trackMatches } = useQuery(() => buscarTracking(search), [search]);

  const toggle = so => setAbiertos(prev => {
    const next = new Set(prev);
    if (next.has(so)) next.delete(so); else next.add(so);
    return next;
  });

  const { ordenes, statuses, kpis } = useMemo(() => {
    if (!data) return { ordenes: [], statuses: [], kpis: null };
    const descBySku = Object.fromEntries(data.skus.map(s => [s.sku, s.description]));
    const lineas = data.rows
      // qty_open 0 = línea ya despachada dentro de una SO aún abierta: no es backlog
      .filter(r => (r.qty_open ?? 0) > 0)
      .map(r => ({ ...r, description: descBySku[r.sku] ?? '' }));

    const trackBySo = new Map();
    for (const t of data.tracking) {
      if (!trackBySo.has(t.so_number)) trackBySo.set(t.so_number, []);
      trackBySo.get(t.so_number).push(t);
    }

    const statuses = [...new Set(lineas.map(r => r.status).filter(Boolean))].sort();

    // Agrupar por SO
    const porSo = new Map();
    for (const r of lineas) {
      const so = r.so_number ?? '(sin SO)';
      if (!porSo.has(so)) {
        porSo.set(so, {
          so, so_date: r.so_date, customer: r.customer, status: r.status,
          lineas: [], qtyOpen: 0, valueOpen: 0,
          tracking: trackBySo.get(so) ?? [],
        });
      }
      const g = porSo.get(so);
      g.lineas.push(r);
      g.qtyOpen += r.qty_open ?? 0;
      g.valueOpen += r.amount_open ?? 0;
    }

    // Orden por número de SO, las más nuevas arriba
    const todas = [...porSo.values()]
      .sort((a, b) => b.so.localeCompare(a.so, undefined, { numeric: true }));

    const q = search.toLowerCase();
    const ordenes = todas.filter(g => {
      const matchStatus = statusFilter === 'all' || g.status === statusFilter;
      const matchSearch = !q
        || g.customer?.toLowerCase().includes(q)
        || g.so?.toLowerCase().includes(q)
        || g.lineas.some(l => l.sku?.toLowerCase().includes(q))
        || g.tracking.some(t => t.tracking?.toLowerCase().includes(q));
      return matchStatus && matchSearch;
    });

    const kpis = {
      units: ordenes.reduce((s, g) => s + g.qtyOpen, 0),
      value: ordenes.reduce((s, g) => s + g.valueOpen, 0),
      orders: ordenes.length,
      customers: new Set(ordenes.map(g => g.customer)).size,
    };
    return { ordenes, statuses, kpis };
  }, [data, search, statusFilter]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Open Sales Orders</h1>
        <p className="text-xs text-muted font-mono mt-0.5">Open sales orders — click one to see its lines and tracking</p>
      </div>

      {loading ? <KPISkeleton count={4} /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="Open Orders" value={kpis.orders} />
          <KPICard label="Open Units" value={kpis.units.toLocaleString()} />
          <KPICard label="Open Value" value={formatCurrency(kpis.value)} />
          <KPICard label="Customers" value={kpis.customers} />
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          placeholder="Customer, SO #, SKU or tracking…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-full sm:w-64"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-xs font-mono text-white focus:outline-none"
        >
          <option value="all">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {!loading && (
          <span className="ml-auto text-xs font-mono text-muted">{ordenes.length} orders</span>
        )}
      </div>

      {loading ? <TableSkeleton rows={10} cols={7} /> : (
        <>
        {/* Mobile: tarjetas por orden */}
        <div className="sm:hidden space-y-2.5">
          {ordenes.length === 0 ? (
            <p className="py-8 text-center text-muted font-mono text-xs">No open backlog</p>
          ) : ordenes.map(g => (
            <SoCard key={g.so} g={g} open={abiertos.has(g.so)} onToggle={() => toggle(g.so)} />
          ))}
          {ordenes.length > 0 && (
            <p className="px-1 pt-1 text-[10px] text-muted font-mono">
              Tap an order to see its lines and tracking. Tracking appears once NetSuite has a shipped fulfillment.
            </p>
          )}
        </div>

        {/* Desktop: tabla completa */}
        <div className="hidden sm:block bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['SO Number', 'Date', 'Customer', 'Status', 'Lines', 'Qty Open', 'Value Open', 'Tracking'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordenes.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted font-mono">No open backlog</td></tr>
                ) : ordenes.map(g => (
                  <SoRow key={g.so} g={g} open={abiertos.has(g.so)} onToggle={() => toggle(g.so)} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
            Tracking numbers appear once NetSuite has a shipped fulfillment for the order.
            Search also matches tracking numbers.
          </p>
        </div>
        </>
      )}

      {/* Resultados del lookup universal: órdenes YA despachadas/cerradas
          (ventas, transfers y compras) que matchean lo buscado */}
      {search.trim().length >= 4 && (trackMatches ?? []).filter(t => !ordenes.some(g => g.so === t.so_number)).length > 0 && (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <p className="px-4 pt-3 pb-1 text-[10px] text-muted font-sans font-medium uppercase tracking-wider">
            Shipped / closed orders matching "{search.trim()}" — sales, transfers and purchases
          </p>
          <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <tbody>
              {(trackMatches ?? []).filter(t => !ordenes.some(g => g.so === t.so_number)).map((t, i) => (
                <tr key={i} className="border-t border-white/[0.04]">
                  <td className="px-4 py-2 font-mono text-white whitespace-nowrap">
                    {t.so_number}
                    {t.order_type && TIPO_ORDEN[t.order_type] && (
                      <span className="ml-1.5 text-[9px] text-muted uppercase">{TIPO_ORDEN[t.order_type]}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-muted">{t.fulfillment}</td>
                  <td className="px-4 py-2 font-mono text-muted whitespace-nowrap">{t.ship_date}</td>
                  <td className="px-4 py-2 font-mono text-slate-300">{t.tracking}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SoRow({ g, open, onToggle }) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors cursor-pointer select-none"
      >
        <td className="px-4 py-2.5 font-mono text-white whitespace-nowrap">
          <span className="text-muted mr-1.5"><Chevron open={open} /></span>
          {g.so}
        </td>
        <td className="px-4 py-2.5 font-mono text-muted whitespace-nowrap">{g.so_date}</td>
        <td className="px-4 py-2.5 font-sans text-slate-300 max-w-[240px] truncate" title={g.customer}>{g.customer}</td>
        <td className="px-4 py-2.5"><StatusBadge status={g.status} /></td>
        <td className="px-4 py-2.5 font-mono text-muted">{g.lineas.length}</td>
        <td className="px-4 py-2.5 font-mono text-white">{g.qtyOpen.toLocaleString()}</td>
        <td className="px-4 py-2.5 font-mono text-white">{formatCurrency(g.valueOpen)}</td>
        <td className="px-4 py-2.5 font-mono">
          {g.tracking.length > 0
            ? <span className="text-success">{g.tracking.length} pkg{g.tracking.length > 1 ? 's' : ''}</span>
            : <span className="text-muted">—</span>}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-white/[0.04] bg-white/[0.015]">
          <td colSpan={8} className="px-6 py-3">
            <table className="w-full text-xs mb-1">
              <thead>
                <tr>
                  {['SKU', 'Description', 'Qty Ordered', 'Qty Open', 'Unit Price', 'Amount Open'].map(h => (
                    <th key={h} className="px-3 py-1.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[9px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.lineas.map(l => (
                  <tr key={l.id} className="border-t border-white/[0.04]">
                    <td className="px-3 py-1.5">
                      {isValidSku(l.sku)
                        ? <Link to={`/item/${l.sku}`} onClick={e => e.stopPropagation()} className="font-mono text-accent hover:text-accent/80">{l.sku}</Link>
                        : <span className="font-mono text-muted">{l.sku}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-muted font-sans max-w-[220px] truncate" title={l.description}>{l.description}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-300">{l.qty_ordered?.toLocaleString()}</td>
                    <td className="px-3 py-1.5 font-mono text-white">{l.qty_open?.toLocaleString()}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-300">{formatCurrency(l.unit_price)}</td>
                    <td className="px-3 py-1.5 font-mono text-white">{formatCurrency(l.amount_open)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {g.tracking.length > 0 && (
              <div className="mt-2 pt-2 border-t border-white/[0.06]">
                <p className="text-[9px] text-muted font-sans font-medium uppercase tracking-wider mb-1">Tracking</p>
                <div className="flex flex-wrap gap-2">
                  {g.tracking.map((t, i) => (
                    <span key={i} className="font-mono text-[11px] bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1">
                      <span className="text-white">{t.tracking}</span>
                      <span className="text-muted"> · {t.fulfillment} · {t.ship_date}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// Tarjeta por orden para mobile: resumen tocable + detalle desplegable.
function SoCard({ g, open, onToggle }) {
  return (
    <div className="bg-card rounded-xl border border-white/[0.08] overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 pt-3 pb-2.5 active:bg-white/[0.04] transition-colors select-none"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-white text-[13px] font-medium">{g.so}</span>
          <StatusBadge status={g.status} />
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="font-sans text-slate-300 text-xs truncate">{g.customer}</span>
          <span className="font-mono text-muted text-[11px] whitespace-nowrap shrink-0">{g.so_date}</span>
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          {[
            ['Qty Open', g.qtyOpen.toLocaleString(), 'text-white'],
            ['Value Open', formatCurrency(g.valueOpen), 'text-white'],
            ['Tracking', g.tracking.length > 0 ? `${g.tracking.length} pkg${g.tracking.length > 1 ? 's' : ''}` : '—',
              g.tracking.length > 0 ? 'text-success' : 'text-muted'],
          ].map(([lbl, val, cls]) => (
            <div key={lbl} className="rounded-lg bg-white/[0.03] px-1.5 py-1.5 text-center">
              <p className="text-[9px] text-muted font-sans font-medium uppercase tracking-wider">{lbl}</p>
              <p className={`text-[11px] font-mono mt-0.5 ${cls}`}>{val}</p>
            </div>
          ))}
        </div>
      </button>
      {open && (
        <div className="border-t border-white/[0.06] bg-white/[0.015] px-4 py-3 space-y-2.5">
          {g.lineas.map(l => (
            <div key={l.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {isValidSku(l.sku)
                  ? <Link to={`/item/${l.sku}`} onClick={e => e.stopPropagation()} className="font-mono text-accent text-xs">{l.sku}</Link>
                  : <span className="font-mono text-muted text-xs">{l.sku}</span>}
                <p className="font-sans text-muted text-[11px] truncate">{l.description}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-mono text-white text-xs">{l.qty_open?.toLocaleString()} open</p>
                <p className="font-mono text-muted text-[11px]">{formatCurrency(l.amount_open)}</p>
              </div>
            </div>
          ))}
          {g.tracking.length > 0 && (
            <div className="pt-2 border-t border-white/[0.06]">
              <p className="text-[9px] text-muted font-sans font-medium uppercase tracking-wider mb-1">Tracking</p>
              <div className="flex flex-wrap gap-1.5">
                {g.tracking.map((t, i) => (
                  <span key={i} className="font-mono text-[10px] bg-white/[0.04] border border-white/[0.08] rounded px-1.5 py-0.5">
                    <span className="text-white">{t.tracking}</span>
                    <span className="text-muted"> · {t.ship_date}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
