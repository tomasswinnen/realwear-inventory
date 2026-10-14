import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, paginar } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { KPISkeleton } from '../components/Skeleton';
import { ExpiryChart } from '../components/ExpiryChart';
import { HOY, DIAS_POR_VENCER, diasHasta, nombreCuenta } from '../utils/warranty';

// Overview = la pantalla para PRESENTAR el sitio (viernes 16/10/2026): en 30
// segundos, qué une, qué permite hacer y qué encontró. Todo en vivo desde
// Supabase, nada escrito a mano salvo los textos. Termina con un buscador de
// serial que responde quién lo tiene, hasta cuándo y a quién llamar.

async function fetchOverview() {
  const traer = async armar => {
    try { return await paginar(armar); } catch { return null; }
  };
  const contar = async tabla => {
    const r = await supabase.from(tabla).select('*', { count: 'exact', head: true });
    return r.error ? null : r.count;
  };
  const [ws, lp, inv, sell, subFu, warFu, nShip, runs] = await Promise.all([
    traer(() => supabase.from('warranty_serials').select('serial, end_date, end_customer, so_number, customer')),
    traer(() => supabase.from('launchpad_subs').select('serial, end_date, customer, plan_code, reseller')),
    traer(() => supabase.from('warranties').select('so_number, customer').eq('start_source', 'invoice')),
    traer(() => supabase.from('sellout_devices').select('serial, distributor, reseller, end_customer, ns_match')),
    traer(() => supabase.from('subscription_followup').select('serial, end_date, status')),
    traer(() => supabase.from('warranty_followup').select('serial, end_date, status')),
    contar('serial_shipments'),
    supabase.from('pipeline_runs').select('finished_at').eq('ok', true)
      .order('finished_at', { ascending: false }).limit(1),
  ]);
  return {
    ws: ws ?? [], lp: lp ?? [], inv: inv ?? [], sell: sell ?? [],
    fu: [...(subFu ?? []), ...(warFu ?? [])], nShip,
    ultimaCorrida: runs?.data?.[0]?.finished_at ?? null,
  };
}

const norm = s => (s ?? '').trim().toUpperCase();
const mismo = (a, b) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
const fmt = n => (n == null ? '—' : n.toLocaleString('en-US'));
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');

export function Overview() {
  const { data, loading, error, refetch } = useQuery(fetchOverview, []);

  const v = useMemo(() => {
    if (!data) return null;
    const hoy = HOY();
    const activo = e => e && e > hoy;
    const en90 = e => activo(e) && diasHasta(e) <= DIAS_POR_VENCER;

    const sellPor = new Map(data.sell.map(r => [norm(r.serial), r]));
    const ecWs = new Set(data.ws.filter(r => (r.end_customer ?? '').trim()).map(r => norm(r.serial)));
    const ecLp = new Map(data.lp.filter(r => (r.customer ?? '').trim()).map(r => [norm(r.serial), r.customer]));
    const conCobertura = new Set([...data.ws, ...data.lp].map(r => norm(r.serial)));
    const facturasInv = new Map(data.inv.map(w => [w.so_number, w.customer]));

    // Suscripciones pagas activas (Launchpad pagas + facturas con cobertura)
    const subs = new Map();
    for (const r of data.lp) {
      if (r.plan_code === 'SSP-STANDARD' || !activo(r.end_date)) continue;
      const k = norm(r.serial);
      if (!subs.has(k) || r.end_date > subs.get(k).end_date) subs.set(k, { end_date: r.end_date });
    }
    for (const r of data.ws) {
      if (!facturasInv.has(r.so_number) || !activo(r.end_date)) continue;
      const k = norm(r.serial);
      if (!subs.has(k) || r.end_date > subs.get(k).end_date) subs.set(k, { end_date: r.end_date });
    }
    const subsConNombre = [...subs.keys()].filter(k => ecLp.has(k) || ecWs.has(k) || sellPor.get(k)?.end_customer).length;

    // Todo lo que tiene cobertura viva (garantías + suscripciones)
    const vivos = new Map();
    for (const r of [...data.ws, ...data.lp]) {
      if (!activo(r.end_date)) continue;
      const k = norm(r.serial);
      if (!vivos.has(k) || r.end_date > vivos.get(k)) vivos.set(k, r.end_date);
    }
    // Renovaciones ≤90 días y cuántas ya tienen seguimiento
    const fuPor = new Map(data.fu.map(f => [`${norm(f.serial)}|${f.end_date}`, f.status]));
    const porRenovar = [...vivos.entries()].filter(([, e]) => en90(e));
    const conSeguimiento = porRenovar.filter(([k, e]) => {
      const s = fuPor.get(`${k}|${e}`);
      return s && s !== 'open';
    }).length;

    // Hallazgos
    const recuperados = data.sell.filter(r => r.end_customer
      && !ecWs.has(norm(r.serial)) && !ecLp.has(norm(r.serial))).length;
    const sinCobertura = data.sell.filter(r => !conCobertura.has(norm(r.serial))).length;
    const conflictos = data.sell.filter(r => {
      const lp = ecLp.get(norm(r.serial));
      return lp && r.end_customer && !mismo(lp, r.end_customer);
    }).length;
    const quemando = new Map();
    for (const r of data.ws) {
      if (!facturasInv.has(r.so_number) || !activo(r.end_date) || sellPor.has(norm(r.serial))) continue;
      const cuenta = nombreCuenta(facturasInv.get(r.so_number));
      quemando.set(cuenta, (quemando.get(cuenta) ?? 0) + 1);
    }
    const quemandoTop = [...quemando.entries()].sort((a, b) => b[1] - a[1]);
    const nsMal = data.sell.filter(r => r.ns_match && r.ns_match !== 'shipped').length;
    const nsCheck = data.sell.some(r => r.ns_match);
    const distis = new Set(data.sell.map(r => r.distributor).filter(Boolean)).size;

    return {
      subs: subs.size, subsConNombre,
      vivos: vivos.size, porRenovar: porRenovar.length, conSeguimiento,
      recuperados, sinCobertura, conflictos, vendidos: data.sell.length, distis,
      quemando: quemandoTop.reduce((s, [, n]) => s + n, 0), quemandoTop,
      nsMal, nsCheck,
      lpRegistros: data.lp.length,
      filasChart: [...vivos.values()].map(e => ({ end_date: e })),
    };
  }, [data]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  const corrida = data?.ultimaCorrida ? new Date(data.ultimaCorrida) : null;

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* 1 · Titular */}
      <div>
        <div className="flex items-center gap-2 text-[11px] font-mono text-muted">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          live data{corrida && <> · last refresh {corrida.toLocaleDateString([], { month: 'short', day: 'numeric' })} {corrida.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>}
          {' '}· refreshed every 2 hours · every run checked automatically
        </div>
        <h1 className="mt-2 text-2xl lg:text-4xl font-sans font-semibold text-white leading-tight">
          Every RealWear device — from NetSuite to the end customer.
        </h1>
        <p className="mt-2 text-sm lg:text-base text-slate-300 max-w-4xl">
          <span className="text-muted">Before:</span> four systems and an Excel sent by email — nobody could say who has a device or when its coverage ends.{' '}
          <span className="text-muted">Now:</span> one place, by serial number, with who to call and when.
        </p>
      </div>

      {/* 2 · Cuatro números */}
      {loading || !v ? <KPISkeleton /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Hero valor={fmt(data.nShip)} titulo="serial records searchable"
            sub="every shipment and invoice since 2015, by serial number" />
          <Hero valor={fmt(v.vivos)} titulo="devices with live coverage"
            sub={`${fmt(v.subs)} paid subscriptions · ${pct(v.subsConNombre, v.subs)} with a named end customer`} />
          <Hero valor={fmt(v.porRenovar)} titulo={`renewals in the next ${DIAS_POR_VENCER} days`} color="text-warning"
            sub={`${fmt(v.conSeguimiento)} already being followed up · ready to export to HubSpot`} />
          <Hero valor={fmt(v.recuperados)} titulo="end customers recovered" color="text-success"
            sub="known only from distributor reports — now attached to their serials" />
        </div>
      )}

      {/* 3 · Cómo funciona */}
      <Flujo v={v} nShip={data?.nShip} />

      {/* 4 · Lo que encontró */}
      {v && (
        <section>
          <h2 className="text-[11px] font-mono text-muted uppercase tracking-widest mb-2">What it found — that nobody could see before</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <Hallazgo n={fmt(v.quemando)} tono="text-warning" a="/data-health"
              titulo="subscriptions running with no customer"
              texto={`Invoiced as subscriptions, the clock is running — but the distributor never reported selling them${v.quemandoTop.length ? ` (${v.quemandoTop.slice(0, 3).map(([c, n]) => `${c} ${n}`).join(', ')})` : ''}.`} />
            <Hallazgo n={fmt(v.sinCobertura)} tono="text-danger" a="/data-health"
              titulo={`of ${fmt(v.vendidos)} devices sold this year have no coverage on record`}
              texto="No plan and no Launchpad registration: nobody can tell when they stop being covered." />
            <Hallazgo n={v.nsCheck ? fmt(v.nsMal) : '—'} tono="text-warning" a="/sell-out"
              titulo="distributor serials that don’t match NetSuite"
              texto="Typos caught automatically, and devices that left without their serial recorded in NetSuite." />
            <Hallazgo n={fmt(v.conflictos)} tono="text-warning" a="/data-health"
              titulo="devices where Launchpad and the distributor name different customers"
              texto="Resale or bad data — now visible device by device instead of hidden in two systems." />
          </div>
        </section>
      )}

      {/* 5 · Próximos vencimientos */}
      {v && <ExpiryChart filas={v.filasChart} titulo="Coverage ending by month (warranties + subscriptions)" />}

      {/* 6 · Probalo */}
      <Buscador />
    </div>
  );
}

function Hero({ valor, titulo, sub, color = 'text-accent' }) {
  return (
    <div className="bg-card border border-white/[0.08] rounded-lg p-4 lg:p-5 min-w-0">
      <p className={`text-3xl lg:text-5xl font-num font-medium leading-none ${color}`}>{valor}</p>
      <p className="mt-2 text-sm lg:text-base text-white font-sans">{titulo}</p>
      <p className="mt-1 text-[11px] lg:text-xs text-muted font-sans">{sub}</p>
    </div>
  );
}

function Hallazgo({ n, titulo, texto, tono, a }) {
  return (
    <Link to={a} className="block bg-card border border-white/[0.08] rounded-lg p-4 hover:border-accent/40 transition-colors">
      <p className={`text-3xl font-num font-medium leading-none ${tono}`}>{n}</p>
      <p className="mt-2 text-sm text-white font-sans leading-snug">{titulo}</p>
      <p className="mt-1.5 text-[11px] text-muted font-sans leading-snug">{texto}</p>
    </Link>
  );
}

// Fuentes → sitio → lo que el equipo hace. Cajas HTML (no SVG) para que se
// acomoden solas en pantalla chica.
function Flujo({ v, nShip }) {
  const fuentes = [
    { n: 'NetSuite', d: 'shipments, invoices, service plans', x: nShip != null ? `${fmt(nShip)} serial records` : null },
    { n: 'Launchpad', d: 'customer registrations', x: v ? `${fmt(v.lpRegistros)} registrations` : null },
    { n: 'Distributor sell-out', d: 'who they sold each device to', x: v ? `${fmt(v.vendidos)} devices · ${v.distis} distributors` : null },
  ];
  const salidas = [
    { n: 'Look up any serial', d: 'who has it, coverage until when, who to call', a: '/serials' },
    { n: 'Track renewals', d: 'subscriptions & warranties, with follow-up status', a: '/subscriptions' },
    { n: 'Export to HubSpot', d: 'one renewal deal per contract', a: '/subscriptions' },
    { n: 'See the data gaps', d: 'by distributor, serial by serial', a: '/data-health' },
  ];
  const Flecha = () => (
    <div className="flex items-center justify-center text-muted text-2xl px-1 lg:rotate-0 rotate-90 select-none" aria-hidden>→</div>
  );
  return (
    <section>
      <h2 className="text-[11px] font-mono text-muted uppercase tracking-widest mb-2">How it works</h2>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr_auto_1fr] gap-2 items-stretch">
        <div className="space-y-2">
          {fuentes.map(f => (
            <div key={f.n} className="bg-card border border-white/[0.08] rounded-lg px-4 py-2.5">
              <p className="text-sm text-white font-sans">{f.n}</p>
              <p className="text-[11px] text-muted font-sans">{f.d}{f.x && <span className="text-slate-300"> · {f.x}</span>}</p>
            </div>
          ))}
        </div>
        <Flecha />
        <div className="bg-accent/10 border border-accent/40 rounded-lg px-5 py-4 flex flex-col justify-center">
          <p className="text-lg text-white font-sans font-semibold">RealWear Inventory</p>
          <p className="mt-1 text-xs text-slate-300 font-sans leading-relaxed">
            Merged by serial number · refreshed every 2 hours · each run checked against its source,
            with an alarm if anything doesn’t add up.
          </p>
        </div>
        <Flecha />
        <div className="space-y-2">
          {salidas.map(s => (
            <Link key={s.n} to={s.a} className="block bg-card border border-white/[0.08] rounded-lg px-4 py-2 hover:border-accent/40 transition-colors">
              <p className="text-sm text-white font-sans">{s.n}</p>
              <p className="text-[11px] text-muted font-sans">{s.d}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// "Probalo": un serial → una tarjeta con todo lo que se sabe de él.
async function buscarSerial(serial) {
  const s = serial.trim();
  const [sh, ws, lp, so] = await Promise.all([
    supabase.from('serial_shipments').select('serial, sku, doc_type, doc_number, fecha, cliente, so_number').ilike('serial', s).order('fecha', { ascending: false }).limit(20),
    supabase.from('warranty_serials').select('serial, end_date, end_customer, so_number, customer, sku').ilike('serial', s),
    supabase.from('launchpad_subs').select('serial, end_date, customer, customer_email, reseller, plan_code, plan_years').ilike('serial', s),
    supabase.from('sellout_devices').select('serial, distributor, reseller, end_customer, date_sold').ilike('serial', s),
  ]);
  return { sh: sh.data ?? [], ws: ws.data ?? [], lp: lp.data ?? [], so: so.data ?? [] };
}

function Buscador() {
  const [txt, setTxt] = useState('');
  const [res, setRes] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const buscar = async e => {
    e.preventDefault();
    if (!txt.trim()) return;
    setBuscando(true);
    try { setRes({ q: txt.trim(), ...(await buscarSerial(txt)) }); } finally { setBuscando(false); }
  };

  let tarjeta = null;
  if (res) {
    const envio = res.sh.find(e => e.doc_type === 'ItemShip') ?? res.sh[0] ?? null;
    const cob = [...res.ws.map(w => ({ fin: w.end_date, de: `service plan · ${w.so_number}`, ec: w.end_customer })),
                 ...res.lp.map(l => ({ fin: l.end_date, de: l.plan_code === 'SSP-STANDARD' ? 'standard warranty · Launchpad' : `paid subscription ${l.plan_years ?? ''}y · Launchpad`, ec: l.customer }))]
      .sort((a, b) => (a.fin < b.fin ? 1 : -1))[0] ?? null;
    const so = res.so[0] ?? null;
    const ec = cob?.ec || so?.end_customer || null;
    const ecFuente = cob?.ec ? 'NetSuite / Launchpad' : so?.end_customer ? 'distributor sell-out report' : null;
    const email = res.lp.map(l => l.customer_email).find(Boolean);
    const dias = cob ? diasHasta(cob.fin) : null;
    const nada = !envio && !cob && !so;
    tarjeta = nada ? (
      <p className="text-sm text-muted font-mono">No trace of {res.q} in NetSuite, Launchpad or the sell-out reports.</p>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Dato t="Shipped" v={envio ? nombreCuenta(envio.cliente) : '—'}
          s={envio ? `${envio.fecha} · ${envio.sku ?? ''} · ${envio.so_number ?? envio.doc_number}` : 'not found in NetSuite'} />
        <Dato t="Sold to (distributor report)" v={so ? (so.reseller ?? '—') : '—'}
          s={so ? `${so.distributor ?? ''}${so.date_sold ? ` · ${so.date_sold}` : ''}` : 'not reported by a distributor'} />
        <Dato t="End customer" v={ec ?? 'unknown'} s={ecFuente ? `${ecFuente}${email ? ` · ${email}` : ''}` : 'nobody recorded it yet'} />
        <Dato t="Coverage" v={cob ? (dias > 0 ? `until ${cob.fin}` : `ended ${cob.fin}`) : 'none on record'}
          s={cob ? `${cob.de}${dias > 0 ? ` · ${dias} days left` : ''}` : 'no plan, no registration'}
          tono={!cob ? 'text-danger' : dias <= 0 ? 'text-muted' : dias <= DIAS_POR_VENCER ? 'text-warning' : 'text-success'} />
      </div>
    );
  }

  return (
    <section className="bg-card border border-accent/30 rounded-lg p-4 lg:p-5">
      <h2 className="text-[11px] font-mono text-muted uppercase tracking-widest mb-2">Try it — type any serial number</h2>
      <form onSubmit={buscar} className="flex gap-2 flex-wrap">
        <input value={txt} onChange={e => setTxt(e.target.value)} placeholder="e.g. MPA6P804D2721020"
          className="bg-[#0d1620] border border-white/[0.15] rounded px-4 py-3 text-lg font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/60 w-full sm:w-[420px]" />
        <button type="submit" disabled={buscando}
          className="px-5 py-3 rounded bg-accent text-white text-sm font-mono hover:bg-accent/80 disabled:opacity-50 transition-colors">
          {buscando ? 'Searching…' : 'Look up'}
        </button>
        {res && (
          <Link to={`/serials?q=${encodeURIComponent(res.q)}`} className="self-center text-xs font-mono text-accent hover:text-accent/80">
            full history →
          </Link>
        )}
      </form>
      {tarjeta && <div className="mt-4">{tarjeta}</div>}
    </section>
  );
}

function Dato({ t, v, s, tono = 'text-white' }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded px-4 py-3 min-w-0">
      <p className="text-[10px] font-mono text-muted uppercase tracking-wider">{t}</p>
      <p className={`mt-1 text-base font-sans truncate ${tono}`} title={v}>{v}</p>
      <p className="mt-0.5 text-[11px] font-mono text-muted truncate" title={s}>{s}</p>
    </div>
  );
}
