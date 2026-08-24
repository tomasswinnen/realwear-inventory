import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { StatusBadge } from '../components/StatusBadge';
import { isValidSku } from '../utils/coverage';

// RMAs (devoluciones): qué volvió, de quién, en qué estado está el trámite y
// qué seriales entraron de vuelta. Fuente: tablas rmas y rma_serials, que el
// pipeline refresca de NetSuite (últimos 2 años).
async function fetchRmas() {
  const [rmasRes, serRes, skusRes] = await Promise.all([
    supabase.from('rmas').select('*').order('rma_date', { ascending: false }).limit(2000),
    supabase.from('rma_serials').select('*').limit(5000),
    excludeSkus(supabase.from('skus').select('sku, description')),
  ]);
  if (rmasRes.error) {
    // Tabla ausente = todavía no se corrió SQL_rmas.sql: mensaje claro
    if (/rmas/.test(rmasRes.error.message)) {
      throw new Error('La tabla de RMAs todavía no existe — hay que correr SQL_rmas.sql en Supabase y una corrida del pipeline.');
    }
    throw new Error(rmasRes.error.message);
  }
  return {
    rmas: rmasRes.data ?? [],
    seriales: serRes.error ? [] : serRes.data ?? [],
    skus: skusRes.data ?? [],
  };
}

function Chevron({ open }) {
  return (
    <svg className={`w-3.5 h-3.5 inline-block transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function Rmas() {
  const { data, loading, error, refetch } = useQuery(fetchRmas, []);
  const [search, setSearch] = useState('');
  const [abiertas, setAbiertas] = useState(() => new Set());

  const toggle = k => setAbiertas(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const { grupos, kpis, descBySku } = useMemo(() => {
    if (!data) return { grupos: [], kpis: null, descBySku: {} };
    const descBySku = Object.fromEntries(data.skus.map(s => [s.sku, s.description]));

    const serPorRma = new Map();
    for (const s of data.seriales) {
      if (!serPorRma.has(s.rma_number)) serPorRma.set(s.rma_number, []);
      serPorRma.get(s.rma_number).push(s);
    }

    const porRma = new Map();
    for (const r of data.rmas) {
      if (!porRma.has(r.rma_number)) {
        porRma.set(r.rma_number, {
          rma: r.rma_number, fecha: r.rma_date, cliente: r.customer,
          status: r.status, items: [], seriales: serPorRma.get(r.rma_number) ?? [],
        });
      }
      porRma.get(r.rma_number).items.push(r);
    }

    const q = search.toLowerCase();
    const grupos = [...porRma.values()]
      .filter(g => !q
        || g.cliente?.toLowerCase().includes(q)
        || g.rma?.toLowerCase().includes(q)
        || g.status?.toLowerCase().includes(q)
        || g.items.some(i => i.sku?.toLowerCase().includes(q) || descBySku[i.sku]?.toLowerCase().includes(q))
        || g.seriales.some(s => s.serial?.toLowerCase().includes(q)))
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));

    const hace90 = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const kpis = {
      total: grupos.length,
      unidades: grupos.reduce((s, g) => s + g.items.reduce((x, i) => x + (i.qty ?? 0), 0), 0),
      recientes: grupos.filter(g => g.fecha >= hace90).length,
      devueltos: grupos.reduce((s, g) => s + g.seriales.length, 0),
    };
    return { grupos, kpis, descBySku };
  }, [data, search]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">RMAs / Returns</h1>
        <p className="text-xs text-muted font-mono mt-0.5">Return authorizations from the last 2 years — click one to see items and returned serials</p>
      </div>

      {loading ? <KPISkeleton count={4} /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="RMAs (2 yr)" value={kpis.total.toLocaleString()} />
          <KPICard label="Units Authorized" value={kpis.unidades.toLocaleString()} />
          <KPICard label="Last 90 Days" value={kpis.recientes} />
          <KPICard label="Serials Received Back" value={kpis.devueltos.toLocaleString()} />
        </div>
      )}

      <div className="flex items-center gap-3">
        <input
          type="search"
          placeholder="Customer, RMA #, SKU, serial or status…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-72"
        />
        {!loading && <span className="ml-auto text-xs font-mono text-muted">{grupos.length} RMAs</span>}
      </div>

      {loading ? <TableSkeleton rows={10} cols={6} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['RMA', 'Date', 'Customer', 'Status', 'Items', 'Serials Back'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grupos.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted font-mono">
                    {search ? `Nothing matches "${search}"` : 'No RMA data yet — runs with the pipeline'}
                  </td></tr>
                ) : grupos.map(g => (
                  <RmaRow key={g.rma} g={g} descBySku={descBySku}
                    open={abiertas.has(g.rma)} onToggle={() => toggle(g.rma)} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
            "Serials back" counts units physically received against the RMA — an authorized return with 0 serials hasn't arrived yet.
          </p>
        </div>
      )}
    </div>
  );
}

function RmaRow({ g, descBySku, open, onToggle }) {
  const etiqueta = sku => (descBySku[sku] ? `${sku} — ${descBySku[sku]}` : sku);
  return (
    <>
      <tr onClick={onToggle}
        className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors cursor-pointer select-none">
        <td className="px-4 py-2.5 font-mono text-white whitespace-nowrap">
          <span className="text-muted mr-1.5"><Chevron open={open} /></span>{g.rma}
        </td>
        <td className="px-4 py-2.5 font-mono text-muted whitespace-nowrap">{g.fecha}</td>
        <td className="px-4 py-2.5 font-sans text-slate-300 max-w-[240px] truncate" title={g.cliente}>{g.cliente}</td>
        <td className="px-4 py-2.5"><StatusBadge status={g.status} /></td>
        <td className="px-4 py-2.5 font-mono text-white">{g.items.reduce((s, i) => s + (i.qty ?? 0), 0)}</td>
        <td className="px-4 py-2.5 font-mono">
          {g.seriales.length > 0
            ? <span className="text-success">{g.seriales.length}</span>
            : <span className="text-muted">0</span>}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-white/[0.04] bg-white/[0.015]">
          <td colSpan={6} className="px-6 py-3 space-y-3">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {['Item', 'Qty', 'Memo'].map(h => (
                    <th key={h} className="px-3 py-1.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[9px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.items.map((it, i) => (
                  <tr key={i} className="border-t border-white/[0.04]">
                    <td className="px-3 py-1.5 max-w-[320px] truncate" title={etiqueta(it.sku)}>
                      {isValidSku(it.sku)
                        ? <Link to={`/item/${it.sku}`} onClick={e => e.stopPropagation()} className="font-mono text-accent hover:text-accent/80">{etiqueta(it.sku)}</Link>
                        : <span className="font-mono text-muted">{etiqueta(it.sku)}</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-white">{it.qty}</td>
                    <td className="px-3 py-1.5 font-sans text-muted max-w-[300px] truncate" title={it.memo}>{it.memo ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {g.seriales.length > 0 && (
              <div className="pt-2 border-t border-white/[0.06]">
                <p className="text-[9px] text-muted font-sans font-medium uppercase tracking-wider mb-1">Serials received back</p>
                <div className="flex flex-wrap gap-2">
                  {g.seriales.map((s, i) => (
                    <span key={i} className="font-mono text-[11px] bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1">
                      <span className="text-white">{s.serial}</span>
                      <span className="text-muted"> · {s.sku} · {s.received_date}</span>
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
