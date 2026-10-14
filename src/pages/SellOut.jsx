import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, paginar } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';

// Sell-out de distribuidores: lo que cada disti reporta haber vendido, serial
// por serial, con reseller y cliente final. Fuente: el Excel "Sale Out data"
// de Channel Ops (consolidado a mano desde los mails a channel@realwear.com),
// leído por el pipeline desde OneDrive → tabla sellout_devices. NetSuite no
// tiene este dato: solo sabe a qué distribuidor le facturó.

async function fetchSellOut() {
  try {
    const filas = await paginar(() => supabase.from('sellout_devices').select('*')
      .order('date_sold', { ascending: false }));
    return { filas, falta: false };
  } catch {
    return { filas: [], falta: true };
  }
}

function coincide(r, q) {
  if (!q) return true;
  const t = q.toLowerCase();
  return [r.serial, r.distributor, r.reseller, r.end_customer, r.sku, r.country, r.program_ref]
    .some(v => (v ?? '').toLowerCase().includes(t));
}

async function exportarExcel(filas) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(filas.map(r => ({
    'Distributor': r.distributor, 'Reseller': r.reseller ?? '', 'End customer': r.end_customer ?? '',
    'Serial': r.serial, 'SKU': r.sku ?? '', 'Product': r.product ?? '', 'Qty': r.qty,
    'Date sold': r.date_sold ?? '', 'Country': r.country ?? '', 'Region': r.region ?? '',
    'Program': r.program_ref ?? '', 'Subscription SKU': r.is_subscription_sku ? 'yes' : '',
    'Report received': r.mail_received ?? '',
  })));
  ws['!cols'] = [{ wch: 22 }, { wch: 26 }, { wch: 30 }, { wch: 19 }, { wch: 9 }, { wch: 30 },
                 { wch: 5 }, { wch: 11 }, { wch: 14 }, { wch: 7 }, { wch: 16 }, { wch: 8 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sell-out devices');
  XLSX.writeFile(wb, `sellout_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function SellOut() {
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('all');
  const [exportando, setExportando] = useState(false);
  const { data, loading, error, refetch } = useQuery(fetchSellOut, []);

  const v = useMemo(() => {
    if (!data) return null;
    const todas = data.filas;
    const regiones = [...new Set(todas.map(r => r.region).filter(Boolean))].sort();
    const base = todas.filter(r => region === 'all' || r.region === region);
    // Buscar nunca filtra: marca los matches y la tabla scrollea al primero
    const filas = q ? base.map(r => ({ ...r, hit: coincide(r, q) })) : base;
    const anio = new Date().getFullYear().toString();
    const esteAnio = todas.filter(r => (r.date_sold ?? '').startsWith(anio));
    const kpi = {
      total: todas.length,
      esteAnio: esteAnio.length,
      distis: new Set(todas.map(r => r.distributor).filter(Boolean)).size,
      conEC: todas.filter(r => r.end_customer).length,
      subs: todas.filter(r => r.is_subscription_sku).length,
      ultimo: todas.reduce((m, r) => (r.mail_received > (m ?? '') ? r.mail_received : m), null),
    };
    return { filas, regiones, kpi };
  }, [data, q, region]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  const exportar = async () => {
    if (exportando || !v) return;
    setExportando(true);
    try { await exportarExcel(v.filas); } finally { setExportando(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Sell-out</h1>
        <p className="text-xs text-muted font-mono mt-0.5">
          What distributors report having sold — serial by serial, with reseller and end customer
        </p>
      </div>

      {loading || !v ? <KPISkeleton /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="Devices sold out" value={v.kpi.total.toLocaleString()}
            sub={`${v.kpi.esteAnio.toLocaleString()} this year`} accent />
          <KPICard label="Distributors reporting" value={v.kpi.distis.toLocaleString()}
            sub={v.kpi.ultimo ? `last report ${v.kpi.ultimo}` : '—'} />
          <KPICard label="With end customer" value={v.kpi.total ? `${Math.round(100 * v.kpi.conEC / v.kpi.total)}%` : '—'}
            sub={`${v.kpi.conEC.toLocaleString()} of ${v.kpi.total.toLocaleString()} devices`} />
          <KPICard label="Subscription SKUs" value={v.kpi.subs.toLocaleString()}
            sub="devices sold as subscription (…S)" />
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="search"
          id="sellout-q"
          placeholder="Serial, distributor, reseller, end customer, SKU or country…"
          value={q}
          onChange={e => setQ(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-full sm:w-96"
        />
        <div className="flex items-center gap-1 flex-wrap">
          {['all', ...(v?.regiones ?? [])].map(r => (
            <button key={r} onClick={() => setRegion(r)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-mono border transition-colors ${
                region === r ? 'border-accent/60 bg-accent/10 text-accent' : 'border-white/[0.1] text-muted hover:text-white'}`}>
              {r === 'all' ? 'All regions' : r}
            </button>
          ))}
        </div>
        <button onClick={exportar} disabled={exportando}
          className="sm:ml-auto px-3 py-1.5 rounded border border-white/[0.12] text-[11px] font-mono text-slate-300 hover:text-white hover:border-accent/50 disabled:opacity-60 transition-colors whitespace-nowrap">
          {exportando ? 'Exporting…' : 'Export Excel'}
        </button>
      </div>

      {data?.falta && (
        <p className="text-xs font-mono text-warning bg-warning/5 border border-warning/20 rounded px-3 py-2">
          Sell-out table not created yet — run the SQL in Supabase, then one pipeline run.
        </p>
      )}

      {loading || !v ? <TableSkeleton rows={10} cols={6} /> : <Agrupado filas={v.filas} q={q} />}

      <p className="text-[10px] text-muted font-mono leading-relaxed">
        Source: the distributors’ monthly sell-out reports, emailed to channel@realwear.com and
        consolidated by Channel Ops in “Sale Out data”; the pipeline reads that file from OneDrive.
        NetSuite only knows which distributor it invoiced — the reseller and end customer behind a
        serial exist only here. A serial reported twice keeps its latest report. “…S” SKUs are
        devices sold as a subscription.
      </p>
    </div>
  );
}

// Distribuidor → reseller → end customer → seriales. Todo colapsado al
// arrancar; la búsqueda expande solo los grupos con match y scrollea.
function Agrupado({ filas, q }) {
  const [abiertos, setAbiertos] = useState(() => new Set());

  const grupos = useMemo(() => {
    const porDisti = new Map();
    for (const r of filas) {
      const d = r.distributor ?? '(no distributor)';
      if (!porDisti.has(d)) porDisti.set(d, new Map());
      const porRes = porDisti.get(d);
      const k = `${r.reseller ?? '—'}|${r.end_customer ?? ''}`;
      if (!porRes.has(k)) porRes.set(k, { reseller: r.reseller, end_customer: r.end_customer, regs: [] });
      porRes.get(k).regs.push(r);
    }
    return [...porDisti.entries()]
      .map(([disti, m]) => {
        const clientes = [...m.values()].sort((a, b) => b.regs.length - a.regs.length);
        return { disti, total: clientes.reduce((s, c) => s + c.regs.length, 0), clientes };
      })
      .sort((a, b) => b.total - a.total);
  }, [filas]);

  useEffect(() => {
    if (!q) { setAbiertos(new Set()); return; }
    const conHit = new Set();
    for (const g of grupos) {
      for (const c of g.clientes) {
        if (c.regs.some(r => r.hit)) conHit.add(`${g.disti}|${c.reseller ?? '—'}|${c.end_customer ?? ''}`);
      }
    }
    setAbiertos(conHit);
    const timer = setTimeout(() => {
      document.querySelector('[data-hit="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => clearTimeout(timer);
  }, [q, grupos]);

  const alternar = k => setAbiertos(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const abrirTodo = () => setAbiertos(new Set(
    grupos.flatMap(g => g.clientes.map(c => `${g.disti}|${c.reseller ?? '—'}|${c.end_customer ?? ''}`))));

  if (grupos.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-white/[0.08] px-4 py-8 text-center text-muted font-mono text-xs">
        Nothing here yet — or the sell-out table is still empty
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-1">
        <button onClick={abrirTodo}
          className="px-2.5 py-1 rounded border border-white/[0.12] text-[10px] font-mono text-muted hover:text-white hover:border-accent/50 transition-colors">
          Expand all
        </button>
        <button onClick={() => setAbiertos(new Set())}
          className="px-2.5 py-1 rounded border border-white/[0.12] text-[10px] font-mono text-muted hover:text-white hover:border-accent/50 transition-colors">
          Collapse all
        </button>
      </div>
      {grupos.map(g => {
        const regiones = [...new Set(g.clientes.flatMap(c => c.regs.map(r => r.region)).filter(Boolean))];
        const conEC = g.clientes.filter(c => c.end_customer).reduce((s, c) => s + c.regs.length, 0);
        return (
          <section key={g.disti} className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <header className="flex items-baseline gap-3 px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
              <span className="font-sans font-semibold text-sm text-white">{g.disti}</span>
              <span className="font-mono text-[11px] text-muted">{regiones.join('/')}</span>
              <span className="ml-auto font-mono text-[11px] text-muted whitespace-nowrap">
                {g.total} {g.total === 1 ? 'device' : 'devices'} · {g.clientes.length} {g.clientes.length === 1 ? 'buyer' : 'buyers'} · {Math.round(100 * conEC / g.total)}% with end customer
              </span>
            </header>
            {g.clientes.map(c => {
              const k = `${g.disti}|${c.reseller ?? '—'}|${c.end_customer ?? ''}`;
              const abierto = abiertos.has(k);
              const fechas = [...new Set(c.regs.map(r => r.date_sold).filter(Boolean))].sort();
              const skus = [...c.regs.reduce((m, r) => m.set(r.sku ?? '?', (m.get(r.sku ?? '?') ?? 0) + 1), new Map()).entries()]
                .sort((a, b) => b[1] - a[1]).map(([s, n]) => (n > 1 ? `${s} ×${n}` : s));
              const paises = [...new Set(c.regs.map(r => r.country).filter(Boolean))];
              return (
                <div key={k} className="border-t border-white/[0.04]">
                  <button onClick={() => alternar(k)}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-white/[0.03] transition-colors">
                    <span className={`inline-block transition-transform text-[9px] text-muted ${abierto ? 'rotate-90' : ''}`}>▶</span>
                    <span className="font-sans text-white text-xs truncate max-w-[260px]"
                      title={c.end_customer ?? 'end customer not reported'}>
                      {c.end_customer ?? <span className="text-muted italic">end customer not reported</span>}
                    </span>
                    <span className="font-sans text-[10px] text-accent/80 truncate max-w-[200px] whitespace-nowrap"
                      title={c.reseller ?? ''}>via {c.reseller ?? '—'}</span>
                    <span className="font-mono text-[10px] text-muted whitespace-nowrap truncate">
                      {c.regs.length} {c.regs.length === 1 ? 'device' : 'devices'} · {skus.slice(0, 3).join(' · ')}{skus.length > 3 ? ` +${skus.length - 3}` : ''}
                      {' · '}<span className="text-slate-300">sold {fechas[0]}{fechas.length > 1 ? ` … ${fechas[fechas.length - 1]}` : ''}</span>
                      {paises.length > 0 && ` · ${paises.join('/')}`}
                    </span>
                  </button>
                  {abierto && (
                    <div className="flex flex-wrap gap-1.5 px-4 pb-2.5 pl-10">
                      {c.regs.map(r => (
                        <Link key={r.id} to={`/serials?q=${r.serial}`}
                          data-hit={r.hit ? 'true' : undefined}
                          title={`${r.product ?? r.sku ?? ''} · sold ${r.date_sold ?? '?'}${r.program_ref ? ` · ${r.program_ref}` : ''}${r.is_subscription_sku ? ' · subscription SKU' : ''}`}
                          className={`font-mono text-[11px] px-2 py-0.5 rounded transition-colors ${
                            r.hit
                              ? 'bg-warning/25 text-warning ring-1 ring-warning/60 hover:bg-warning/30'
                              : 'bg-white/[0.05] text-slate-300 hover:text-accent hover:bg-white/[0.08]'}`}>
                          {r.serial}
                          <span className="text-muted"> · {r.sku ?? '?'}</span>
                          {fechas.length > 1 && <span className="text-muted opacity-70"> · {r.date_sold}</span>}
                          {r.is_subscription_sku && <span className="text-accent/80"> ·S</span>}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
