import { useMemo, useState } from 'react';
import { supabase, paginar } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { descargarCSV } from '../components/FollowUp';
import { HOY } from '../utils/warranty';
import {
  calcularPuntajes, sumarDias, normSerial, PARAMS_CUENTA, PARAMS_RESELLER, GRADOS, gradoDe,
} from '../utils/partnerScore';

// Partner Score: un puntaje 0–100 por distribuidor / cuenta directa y por
// reseller, con datos que el sitio ya tiene (NetSuite, sell-out, Launchpad,
// stock de distribuidores, HubSpot). La lógica vive en utils/partnerScore.js;
// los nombres de cada distribuidor en cada fuente, en data/partners.json.
// Solo lectura.

async function fetchPartnerData() {
  const hoy = HOY();
  const traer = async armar => {
    try { return await paginar(armar); } catch { return null; }
  };
  const [so, ship, ws, lp, sell, stock, pipe, fuS, fuW] = await Promise.all([
    traer(() => supabase.from('so_history').select('so_number, so_date, customer, status, amount')
      .gte('so_date', sumarDias(hoy, -730))),
    traer(() => supabase.from('serial_shipments').select('serial, cliente, fecha, doc_type')
      .gte('fecha', sumarDias(hoy, -365))),
    traer(() => supabase.from('warranty_serials').select('serial, customer, end_date')),
    traer(() => supabase.from('launchpad_subs').select('serial, plan_code, end_date, customer, distributor')),
    traer(() => supabase.from('sellout_devices').select('serial, distributor, reseller, end_customer, date_sold, ns_match, ns_serial')),
    traer(() => supabase.from('distributor_stock').select('distributor, updated_at')),
    traer(() => supabase.from('sales_pipeline').select('distributor, amount, deal_stage, updated_at')),
    traer(() => supabase.from('subscription_followup').select('serial, end_date, status')),
    traer(() => supabase.from('warranty_followup').select('serial, end_date, status')),
  ]);
  if (so === null) throw new Error('Could not read so_history');

  // Subs de Launchpad vencidas en 12 meses: a quién le vendió RealWear ese
  // equipo (serial_shipments.cliente), para saber de quién es la renovación.
  const desde = sumarDias(hoy, -365);
  const seriales = [...new Set((lp ?? [])
    .filter(r => r.plan_code !== 'SSP-STANDARD' && r.end_date >= desde && r.end_date < hoy && !r.distributor)
    .map(r => r.serial).filter(Boolean))];
  const lotes = [];
  for (let i = 0; i < seriales.length; i += 100) lotes.push(seriales.slice(i, i + 100));
  const eventos = await Promise.all(lotes.map(lote =>
    traer(() => supabase.from('serial_shipments').select('serial, cliente, fecha, doc_type').in('serial', lote))));
  const duenos = {}, fechaDueno = {};
  for (const ev of eventos.flat()) {
    if (!ev?.cliente) continue;
    const s = normSerial(ev.serial);
    if (!fechaDueno[s] || ev.fecha > fechaDueno[s]) { duenos[s] = ev.cliente; fechaDueno[s] = ev.fecha; }
  }

  return {
    so, ship: ship ?? [], ws: ws ?? [], lp: lp ?? [], sell: sell ?? [], stock: stock ?? [],
    pipe: pipe ?? [], fu: [...(fuS ?? []), ...(fuW ?? [])], duenos,
    faltan: [ship === null && 'serial_shipments', sell === null && 'sellout_devices', lp === null && 'launchpad_subs',
      ws === null && 'warranty_serials', stock === null && 'distributor_stock'].filter(Boolean),
  };
}

const money = n => {
  const a = Math.abs(n ?? 0);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3).toLocaleString('en-US')}k`;
  return `$${Math.round(n ?? 0)}`;
};
const TIPO = {
  dist: { label: 'Distributor', cls: 'bg-accent/15 text-accent' },
  direct: { label: 'Direct account', cls: 'bg-white/[0.07] text-slate-300' },
};

// Cuándo da puntos completos un parámetro de tasa
function meta(p, x) {
  if (p.tipo === 'rate') return `Full points at ${Math.round(p.target * 100)}%.`;
  if (p.tipo === 'peer') {
    return x?.meta != null
      ? `Full points at ${Math.round(x.meta * 100)}% — the level of the top quarter of the group.`
      : `Full points at the level of the top quarter of the group (at least ${Math.round(p.piso * 100)}%).`;
  }
  return '';
}

function Grado({ c, grande }) {
  const size = grande ? 'w-11 h-11 text-xl' : 'w-8 h-8 text-base';
  if (c.score == null) {
    return (
      <span title="Less than half of the score can be measured for this account — not graded."
        className={`${size} inline-flex items-center justify-center rounded-md font-num bg-white/[0.05] text-muted`}>–</span>
    );
  }
  return (
    <span className={`${size} inline-flex items-center justify-center rounded-md font-num font-semibold ${gradoDe(c.score).cls}`}>
      {c.grado}
    </span>
  );
}

function Barra({ v, color, ancho = 'w-24' }) {
  return (
    <span className={`inline-block ${ancho} h-1.5 rounded bg-white/[0.07] align-middle overflow-hidden`}>
      <span className="block h-full rounded" style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%`, background: color }} />
    </span>
  );
}

function Sub({ v }) {
  if (v == null) return <span className="text-muted">n/a</span>;
  const col = v >= 80 ? 'text-success' : v >= 60 ? 'text-accent' : v >= 40 ? 'text-warning' : 'text-danger';
  return <span className={`font-num ${col}`}>{v}</span>;
}

function Detalle({ c, params }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 px-4 pb-4 pt-1">
      {params.map(p => {
        const x = c.p[p.k];
        if (!x) return null;
        const r = x.na ? 0 : x.pts / p.max;
        const color = r >= 0.8 ? '#22c55e' : r >= 0.6 ? '#38bdf8' : r >= 0.4 ? '#f59e0b' : '#ef4444';
        return (
          <div key={p.k} className={`rounded-md border border-white/[0.08] p-3 ${x.na ? 'opacity-60' : ''}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-white">{p.label}</span>
              <span className="font-num text-sm">
                {x.na ? <span className="text-muted">n/a</span> : <><span className="text-white">{Math.round(x.pts * 10) / 10}</span><span className="text-muted"> / {p.max}</span></>}
              </span>
            </div>
            {!x.na && <div className="mt-1.5"><Barra v={r * 100} color={color} ancho="w-full" /></div>}
            <p className="mt-1.5 text-xs text-slate-300">{x.valor}</p>
            <p className="mt-1 text-[11px] text-muted leading-snug">
              {p.como} {meta(p, x)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function Metodo({ params, resellers }) {
  const total = params.reduce((s, p) => s + p.max, 0);
  return (
    <div className="bg-card rounded-lg border border-white/[0.08] p-4 space-y-3">
      <p className="text-sm text-slate-300">
        Each partner gets up to <b className="text-white">{total} points</b> over the last 12 months. Parameters with no data
        for a partner are marked <span className="text-muted">n/a</span> and left out, so the score is
        <i> points earned ÷ points that could be measured</i>. With less than half measurable, no grade is given.
        {resellers
          ? ' Resellers come only from what the distributors report in the sell-out; resellers with fewer than 5 devices reported are not scored.'
          : ' Distributors are compared with distributors, direct accounts with direct accounts. Direct accounts (NetSuite customers billing $50k+ that are not on the distributor list) are not expected to send sell-out or stock reports, so those parameters do not apply to them.'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted font-mono uppercase tracking-wider text-[10px] text-left">
              <th className="py-1.5 pr-3">Parameter</th><th className="py-1.5 pr-3">Points</th>
              <th className="py-1.5 pr-3">Group</th><th className="py-1.5">How it is measured</th>
            </tr>
          </thead>
          <tbody>
            {params.map(p => (
              <tr key={p.k} className="border-t border-white/[0.05] align-top">
                <td className="py-1.5 pr-3 text-white whitespace-nowrap">{p.label}{p.soloDist ? <span className="text-muted"> · distributors</span> : ''}</td>
                <td className="py-1.5 pr-3 font-num">{p.max}</td>
                <td className="py-1.5 pr-3 text-muted whitespace-nowrap">{p.grupo === 'perf' ? 'Performance' : 'Data quality'}</td>
                <td className="py-1.5 text-slate-300">{p.como} {meta(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Grades: {GRADOS.map((g, i) => <span key={g.g} className="mr-2"><span className={`px-1.5 py-0.5 rounded font-num ${g.cls}`}>{g.g}</span> {i === 0 ? `${g.min}+` : `${g.min}–${GRADOS[i - 1].min - 1}`}</span>)}
        · Payment behaviour is not scored: the site has no receivables data yet.
      </p>
    </div>
  );
}

export function PartnerScore() {
  const { data, loading, error, refetch } = useQuery(fetchPartnerData, []);
  const R = useMemo(() => (data ? calcularPuntajes(data, HOY()) : null), [data]);
  const [tab, setTab] = useState('cuentas');
  const [tipo, setTipo] = useState('all');
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(null);
  const [metodo, setMetodo] = useState(false);

  const params = tab === 'cuentas' ? PARAMS_CUENTA : PARAMS_RESELLER;
  const filas = useMemo(() => {
    if (!R) return [];
    const base = tab === 'cuentas' ? R.cuentas.filter(c => tipo === 'all' || c.tipo === tipo) : R.resellers;
    const t = q.trim().toLowerCase();
    return t ? base.filter(c => c.nombre.toLowerCase().includes(t) || (c.dists ?? []).some(d => d.toLowerCase().includes(t))) : base;
  }, [R, tab, tipo, q]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  const conNota = filas.filter(c => c.score != null);
  const cuenta = g => conNota.filter(c => c.grado === g).length;
  const paramsVisibles = tab === 'cuentas' && tipo === 'direct' ? params.filter(p => !p.soloDist) : params;

  const exportar = () => {
    descargarCSV(filas.map((c, i) => ({
      Rank: c.score != null ? i + 1 : '',
      Partner: c.nombre,
      ...(tab === 'cuentas' ? { Type: TIPO[c.tipo].label, 'NetSuite accounts': (c.nsNombres ?? []).join(' | '), 'Billed 12 mo': Math.round(c.billed) }
        : { Distributors: c.dists.join(' | '), 'Devices 12 mo': c.units12 }),
      Grade: c.grado ?? 'not graded', Score: c.score ?? '', Performance: c.perf ?? '', 'Data quality': c.data ?? '',
      ...Object.fromEntries(params.flatMap(p => {
        const x = c.p[p.k];
        if (!x) return [];
        return [[`${p.label} (pts of ${p.max})`, x.na ? 'n/a' : Math.round(x.pts * 10) / 10], [`${p.label} — detail`, x.valor]];
      })),
    })), `partner_score_${tab === 'cuentas' ? 'distributors' : 'resellers'}_${HOY()}.csv`);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-white">Partner Score</h1>
          <p className="text-sm text-muted mt-1 max-w-3xl">
            How each distributor and reseller performs, 0–100 over the last 12 months — sales, paid plans attached,
            renewals and how well they report. Built only from data already on this site.
          </p>
        </div>
        <div className="flex gap-1 bg-white/[0.04] rounded-lg p-1">
          {[['cuentas', 'Distributors & direct accounts'], ['resellers', 'Resellers']].map(([k, l]) => (
            <button key={k} onClick={() => { setTab(k); setAbierto(null); }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${tab === k ? 'bg-accent text-white' : 'text-muted hover:text-white'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {loading || !R ? (
        <><KPISkeleton count={5} /><TableSkeleton rows={10} /></>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPICard label="Graded" value={conNota.length} sub={`${filas.length - conNota.length} with limited data`} />
            {GRADOS.map(g => (
              <KPICard key={g.g} label={`Grade ${g.g}`} value={cuenta(g.g)}
                color={g.cls.split(' ').find(x => x.startsWith('text-'))}
                sub={g.g === 'A' ? '80+' : g.g === 'D' ? 'under 40' : `${g.min}–${g.min + 19}`} />
            ))}
          </div>

          {data.faltan.length > 0 && (
            <p className="text-xs font-mono text-warning">Could not read: {data.faltan.join(', ')} — those parameters show as n/a.</p>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {tab === 'cuentas' && [['all', 'All'], ['dist', 'Distributors'], ['direct', 'Direct accounts']].map(([k, l]) => (
              <button key={k} onClick={() => setTipo(k)}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${tipo === k ? 'bg-accent/15 text-accent' : 'text-muted hover:text-white'}`}>
                {l}<span className="opacity-60"> · {k === 'all' ? R.cuentas.length : R.cuentas.filter(c => c.tipo === k).length}</span>
              </button>
            ))}
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={tab === 'cuentas' ? 'Search partner…' : 'Search reseller or distributor…'}
              className="ml-auto w-56 bg-white/[0.03] border border-white/[0.1] rounded px-2.5 py-1.5 text-sm text-white placeholder:text-muted focus:outline-none focus:border-accent/50" />
            <button onClick={() => setMetodo(m => !m)}
              className="px-3 py-1.5 rounded border border-white/[0.1] text-xs text-slate-300 hover:text-white">
              {metodo ? 'Hide method' : 'How the score works'}
            </button>
            <button onClick={exportar} className="px-3 py-1.5 rounded bg-accent text-white text-xs hover:bg-accent/80">Export CSV</button>
          </div>

          {metodo && <Metodo params={paramsVisibles} resellers={tab === 'resellers'} />}

          <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] font-mono uppercase tracking-wider text-muted text-left border-b border-white/[0.08]">
                    <th className="px-4 py-2.5 w-10">#</th>
                    <th className="px-2 py-2.5">{tab === 'cuentas' ? 'Partner' : 'Reseller'}</th>
                    <th className="px-2 py-2.5 text-center">Grade</th>
                    <th className="px-2 py-2.5">Score</th>
                    <th className="px-2 py-2.5 hidden md:table-cell" title="Sales, paid plans attached, renewals, pipeline">Performance</th>
                    <th className="px-2 py-2.5 hidden md:table-cell" title="Sell-out, end customer, serial accuracy, stock report">Data quality</th>
                    <th className="px-2 py-2.5 hidden lg:table-cell text-right">{tab === 'cuentas' ? 'Billed 12 mo' : 'Devices 12 mo'}</th>
                    <th className="px-4 py-2.5 hidden lg:table-cell">Weakest</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((c, i) => {
                    const g = c.score != null ? gradoDe(c.score) : null;
                    const open = abierto === c.id;
                    return [
                      <tr key={c.id} onClick={() => setAbierto(open ? null : c.id)}
                        className={`border-t border-white/[0.05] cursor-pointer hover:bg-white/[0.03] ${open ? 'bg-white/[0.03]' : ''} ${c.score == null ? 'opacity-70' : ''}`}>
                        <td className="px-4 py-2.5 font-num text-muted">{c.score != null ? i + 1 : ''}</td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white font-medium">{c.nombre}</span>
                            {tab === 'cuentas' && (
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${TIPO[c.tipo].cls}`}>{TIPO[c.tipo].label}{c.region ? ` · ${c.region}` : ''}</span>
                            )}
                          </div>
                          {tab === 'resellers' && <div className="text-[11px] text-muted mt-0.5">via {c.dists.join(', ')}</div>}
                          {c.score == null && <div className="text-[11px] text-muted mt-0.5">limited data — {c.aplicable} of 100 points measurable</div>}
                        </td>
                        <td className="px-2 py-2.5 text-center"><Grado c={c} /></td>
                        <td className="px-2 py-2.5 whitespace-nowrap">
                          {c.score != null
                            ? <><span className="font-num text-white text-base mr-2">{c.score}</span><Barra v={c.score} color={g.bar} /></>
                            : <span className="text-muted">—</span>}
                        </td>
                        <td className="px-2 py-2.5 hidden md:table-cell"><Sub v={c.perf} /></td>
                        <td className="px-2 py-2.5 hidden md:table-cell"><Sub v={c.data} /></td>
                        <td className="px-2 py-2.5 hidden lg:table-cell text-right font-num text-slate-300">
                          {tab === 'cuentas' ? money(c.billed) : c.units12.toLocaleString('en-US')}
                        </td>
                        <td className="px-4 py-2.5 hidden lg:table-cell">
                          <div className="flex gap-1 flex-wrap">
                            {c.flojos.map(k => {
                              const p = params.find(x => x.k === k);
                              return <span key={k} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-danger/10 text-danger whitespace-nowrap">{p.label}</span>;
                            })}
                          </div>
                        </td>
                      </tr>,
                      open && (
                        <tr key={`${c.id}-d`} className="bg-white/[0.02]">
                          <td colSpan={8}>
                            {tab === 'cuentas' && c.nsNombres?.length > 0 && (
                              <p className="px-4 pt-3 text-[11px] text-muted">NetSuite account{c.nsNombres.length > 1 ? 's' : ''}: {c.nsNombres.join(' · ')}</p>
                            )}
                            <Detalle c={c} params={c.tipo === 'direct' ? params.filter(p => !p.soloDist) : params} />
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                  {!filas.length && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-muted">Nothing matches.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 text-xs">
            {tab === 'cuentas' && R.sinDatos.length > 0 && (
              <div className="bg-card rounded-lg border border-white/[0.08] p-4">
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1.5">Distributors not scored — too little activity</p>
                <p className="text-slate-300">{R.sinDatos.map(d => `${d.nombre} (${money(d.billed)} billed, ${d.enviados12} devices)`).join(' · ')}</p>
              </div>
            )}
            {tab === 'resellers' && R.resSinDatos > 0 && (
              <div className="bg-card rounded-lg border border-white/[0.08] p-4">
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1.5">Not scored</p>
                <p className="text-slate-300">{R.resSinDatos} more resellers have fewer than 5 devices in the sell-out reports.</p>
              </div>
            )}
            {!R.pipeline.fresco && (
              <div className="bg-card rounded-lg border border-white/[0.08] p-4">
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1.5">HubSpot pipeline not scored</p>
                <p className="text-slate-300">
                  {R.pipeline.at ? `The HubSpot export on the site is from ${R.pipeline.at} (older than 90 days).` : 'There is no HubSpot pipeline data on the site.'} The
                  other parameters cover the score.
                </p>
              </div>
            )}
            {(R.sinMatch.sellout.length > 0 || R.sinMatch.stock.length > 0) && (
              <div className="bg-card rounded-lg border border-warning/30 p-4">
                <p className="text-[10px] font-mono uppercase tracking-wider text-warning mb-1.5">Names not linked to a distributor</p>
                <p className="text-slate-300">
                  {R.sinMatch.sellout.length > 0 && <>Sell-out: {R.sinMatch.sellout.map(([n, k]) => `${n} (${k})`).join(' · ')}. </>}
                  {R.sinMatch.stock.length > 0 && <>Stock report: {R.sinMatch.stock.map(([n, k]) => `${n} (${k})`).join(' · ')}. </>}
                  Their data is not counted until they are added to the distributor list.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
