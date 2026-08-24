import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { StatusBadge } from '../components/StatusBadge';
import { formatCurrency, isValidSku } from '../utils/coverage';

// Vista POR CLIENTE: todo lo que la empresa sabe de un cliente en una sola
// pantalla — órdenes abiertas, envíos con sus seriales y tracking, equipos en
// campo con su antigüedad, y devoluciones (RMAs). Los datos ya viven en
// Supabase; esta página solo los junta.
const PAGINA = 1000;

async function buscarCliente(q) {
  if (!q) {
    // Sin búsqueda: los clientes con órdenes abiertas, para tener por dónde empezar
    const res = await supabase.from('sales_backlog')
      .select('customer, qty_open, amount_open');
    if (res.error) throw new Error(res.error.message);
    return { modo: 'inicio', backlog: res.data ?? [] };
  }

  const like = `%${q}%`;
  const [backlogRes, skusRes] = await Promise.all([
    supabase.from('sales_backlog').select('*').ilike('customer', like),
    excludeSkus(supabase.from('skus').select('sku, description')),
  ]);
  if (backlogRes.error) throw new Error(backlogRes.error.message);

  // Eventos de seriales del cliente, paginados (un cliente grande puede tener
  // miles de despachos en el historial completo)
  const eventos = [];
  for (let desde = 0; desde < 6000; desde += PAGINA) {
    const res = await supabase.from('serial_shipments').select('*')
      .ilike('cliente', like)
      .order('fecha', { ascending: false })
      .range(desde, desde + PAGINA - 1);
    if (res.error) throw new Error(res.error.message);
    eventos.push(...(res.data ?? []));
    if ((res.data ?? []).length < PAGINA) break;
  }

  // RMAs: la tabla puede no existir todavía (SQL pendiente) — se tolera
  const rmasRes = await supabase.from('rmas').select('*')
    .ilike('customer', like).order('rma_date', { ascending: false }).limit(500);
  const rmas = rmasRes.error ? [] : rmasRes.data ?? [];
  const rmaSerRes = await supabase.from('rma_serials').select('*')
    .ilike('customer', like).limit(1000);
  const rmaSeriales = rmaSerRes.error ? [] : rmaSerRes.data ?? [];

  // Tracking de las SO que aparecieron (abiertas o de los envíos)
  const soNumbers = [...new Set([
    ...(backlogRes.data ?? []).map(r => r.so_number),
    ...eventos.map(e => e.so_number),
  ].filter(Boolean))];
  const tracking = [];
  for (let i = 0; i < soNumbers.length && i < 600; i += 100) {
    const res = await supabase.from('so_tracking')
      .select('so_number, fulfillment, ship_date, tracking')
      .in('so_number', soNumbers.slice(i, i + 100));
    if (res.error) break;
    tracking.push(...(res.data ?? []));
  }

  return {
    modo: 'detalle',
    backlog: backlogRes.data ?? [],
    eventos, rmas, rmaSeriales, tracking,
    skus: skusRes.data ?? [],
  };
}

function mesesDesde(fecha) {
  if (!fecha) return null;
  const d = new Date(fecha + 'T00:00:00');
  const hoy = new Date();
  return Math.max(0, Math.floor((hoy - d) / (30.44 * 24 * 3600 * 1000)));
}

export function Customers() {
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [elegido, setElegido] = useState('');
  const { data, loading, error, refetch } = useQuery(() => buscarCliente(q), [q]);

  const buscar = e => {
    e.preventDefault();
    setElegido('');
    setQ(input.trim());
  };

  const vista = useMemo(() => {
    if (!data) return null;
    if (data.modo === 'inicio') {
      const porCliente = new Map();
      for (const r of data.backlog) {
        if (!r.customer || (r.qty_open ?? 0) <= 0) continue;
        if (!porCliente.has(r.customer)) porCliente.set(r.customer, { nombre: r.customer, valor: 0 });
        porCliente.get(r.customer).valor += r.amount_open ?? 0;
      }
      return { modo: 'inicio', clientes: [...porCliente.values()].sort((a, b) => b.valor - a.valor) };
    }

    // Nombres distintos que matchearon la búsqueda
    const nombres = [...new Set([
      ...data.backlog.map(r => r.customer),
      ...data.eventos.map(e => e.cliente),
      ...data.rmas.map(r => r.customer),
    ].filter(Boolean))].sort();

    const nombre = elegido || (nombres.length === 1 ? nombres[0] : null);
    if (!nombre) return { modo: 'elegir', nombres };

    const descBySku = Object.fromEntries(data.skus.map(s => [s.sku, s.description]));
    const trackBySo = new Map();
    for (const t of data.tracking) {
      if (!trackBySo.has(t.so_number)) trackBySo.set(t.so_number, []);
      trackBySo.get(t.so_number).push(t);
    }

    // Órdenes abiertas del cliente
    const abiertas = new Map();
    for (const r of data.backlog.filter(r => r.customer === nombre && (r.qty_open ?? 0) > 0)) {
      const so = r.so_number ?? '—';
      if (!abiertas.has(so)) abiertas.set(so, { so, fecha: r.so_date, status: r.status, qty: 0, valor: 0, tracking: trackBySo.get(so) ?? [] });
      const g = abiertas.get(so);
      g.qty += r.qty_open ?? 0;
      g.valor += r.amount_open ?? 0;
    }

    // Equipos en campo: cada serial con su primer despacho (edad)
    const eventosCliente = data.eventos.filter(e => e.cliente === nombre);
    const porSerial = new Map();
    for (const e of eventosCliente) {
      if (!porSerial.has(e.serial)) porSerial.set(e.serial, { serial: e.serial, sku: e.sku, eventos: [] });
      porSerial.get(e.serial).eventos.push(e);
    }
    const devueltos = new Set(data.rmaSeriales.filter(r => r.customer === nombre).map(r => r.serial));
    const equipos = [...porSerial.values()].map(s => {
      const ship = s.eventos.filter(e => e.doc_type === 'ItemShip').map(e => e.fecha).sort()[0]
        ?? s.eventos.map(e => e.fecha).sort()[0];
      return { ...s, despacho: ship, meses: mesesDesde(ship), devuelto: devueltos.has(s.serial) };
    }).sort((a, b) => (a.despacho < b.despacho ? 1 : -1));

    // Envíos (documentos) recientes
    const porDoc = new Map();
    for (const e of eventosCliente) {
      const k = `${e.doc_type}:${e.doc_number}`;
      if (!porDoc.has(k)) porDoc.set(k, { tipo: e.doc_type, doc: e.doc_number, fecha: e.fecha, so: e.so_number, seriales: 0 });
      porDoc.get(k).seriales += 1;
    }
    const envios = [...porDoc.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).slice(0, 60);

    // RMAs agrupadas
    const rmasG = new Map();
    for (const r of data.rmas.filter(r => r.customer === nombre)) {
      if (!rmasG.has(r.rma_number)) rmasG.set(r.rma_number, { rma: r.rma_number, fecha: r.rma_date, status: r.status, items: [] });
      rmasG.get(r.rma_number).items.push(r);
    }

    const ultimoEnvio = envios.find(e => e.tipo === 'ItemShip');
    return {
      modo: 'detalle', nombre, nombres, descBySku,
      abiertas: [...abiertas.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)),
      equipos, envios,
      rmas: [...rmasG.values()],
      kpis: {
        abiertas: abiertas.size,
        valorAbierto: [...abiertas.values()].reduce((s, g) => s + g.valor, 0),
        equipos: equipos.length,
        ultimoEnvio: ultimoEnvio?.fecha ?? '—',
        rmas: rmasG.size,
      },
    };
  }, [data, elegido]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Customers</h1>
        <p className="text-xs text-muted font-mono mt-0.5">Everything about one customer: open orders, shipments, devices in the field, returns</p>
      </div>

      <form onSubmit={buscar} className="flex items-center gap-2">
        <input
          type="search"
          placeholder="Customer name…"
          value={input}
          onChange={e => setInput(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-80"
        />
        <button type="submit"
          className="px-4 py-2 rounded bg-accent text-white text-xs font-mono hover:bg-accent/80 transition-colors">
          Search
        </button>
        {q && (
          <button type="button" onClick={() => { setInput(''); setQ(''); setElegido(''); }}
            className="px-3 py-2 rounded text-xs font-mono text-muted hover:text-white transition-colors">
            Clear
          </button>
        )}
      </form>

      {loading ? <TableSkeleton rows={8} cols={4} /> : !vista ? null : vista.modo === 'inicio' ? (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <p className="px-4 pt-3 pb-1 text-[10px] text-muted font-sans font-medium uppercase tracking-wider">
            Customers with open orders — or search anyone above
          </p>
          <table className="w-full text-xs">
            <tbody>
              {vista.clientes.map(c => (
                <tr key={c.nombre}
                  onClick={() => { setInput(c.nombre); setQ(c.nombre); }}
                  className="border-t border-white/[0.04] hover:bg-white/[0.03] cursor-pointer transition-colors">
                  <td className="px-4 py-2.5 font-sans text-slate-300">{c.nombre}</td>
                  <td className="px-4 py-2.5 font-mono text-white text-right">{formatCurrency(c.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : vista.modo === 'elegir' ? (
        <div className="bg-card rounded-lg border border-white/[0.08] p-4">
          <p className="text-xs text-muted font-mono mb-3">
            {vista.nombres.length === 0 ? `Nothing matches "${q}"` : `${vista.nombres.length} customers match "${q}" — pick one:`}
          </p>
          <div className="flex flex-wrap gap-2">
            {vista.nombres.map(n => (
              <button key={n} onClick={() => setElegido(n)}
                className="px-3 py-1.5 rounded border border-white/[0.12] text-xs font-sans text-slate-300 hover:text-white hover:border-accent/50 transition-colors">
                {n}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <DetalleCliente v={vista} />
      )}
    </div>
  );
}

function DetalleCliente({ v }) {
  const [verTodos, setVerTodos] = useState(false);
  const equiposVisibles = verTodos ? v.equipos : v.equipos.slice(0, 50);
  const nombreSku = sku => (v.descBySku[sku] ? `${sku} — ${v.descBySku[sku]}` : sku);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-sans font-semibold text-white">{v.nombre}</h2>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KPICard label="Open Orders" value={v.kpis.abiertas} />
        <KPICard label="Open Value" value={formatCurrency(v.kpis.valorAbierto)} />
        <KPICard label="Devices Shipped" value={v.kpis.equipos.toLocaleString()} />
        <KPICard label="Last Shipment" value={v.kpis.ultimoEnvio} />
        <KPICard label="RMAs" value={v.kpis.rmas} />
      </div>

      {v.abiertas.length > 0 && (
        <Seccion titulo="Open Orders">
          <table className="w-full text-xs">
            <thead><Encabezados hs={['SO', 'Date', 'Status', 'Qty Open', 'Value Open', 'Tracking']} /></thead>
            <tbody>
              {v.abiertas.map(o => (
                <tr key={o.so} className="border-t border-white/[0.04]">
                  <td className="px-4 py-2 font-mono text-white">{o.so}</td>
                  <td className="px-4 py-2 font-mono text-muted">{o.fecha}</td>
                  <td className="px-4 py-2"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-2 font-mono text-white">{o.qty.toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-white">{formatCurrency(o.valor)}</td>
                  <td className="px-4 py-2 font-mono text-[11px]">
                    {o.tracking.length
                      ? o.tracking.map((t, i) => <div key={i} className="text-slate-300">{t.tracking} <span className="text-muted">· {t.ship_date}</span></div>)
                      : <span className="text-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Seccion>
      )}

      {v.rmas.length > 0 && (
        <Seccion titulo="Returns (RMAs)">
          <table className="w-full text-xs">
            <thead><Encabezados hs={['RMA', 'Date', 'Status', 'Items']} /></thead>
            <tbody>
              {v.rmas.map(r => (
                <tr key={r.rma} className="border-t border-white/[0.04] align-top">
                  <td className="px-4 py-2 font-mono text-white">{r.rma}</td>
                  <td className="px-4 py-2 font-mono text-muted">{r.fecha}</td>
                  <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-2 font-mono text-slate-300">
                    {r.items.map((it, i) => (
                      <div key={i}>{nombreSku(it.sku)} × {it.qty}{it.memo ? <span className="text-muted"> · {it.memo}</span> : null}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Seccion>
      )}

      <Seccion titulo={`Recent Shipments & Invoices (${v.envios.length})`}>
        <table className="w-full text-xs">
          <thead><Encabezados hs={['Document', 'Type', 'Date', 'Sales Order', 'Serials']} /></thead>
          <tbody>
            {v.envios.map(e => (
              <tr key={`${e.tipo}:${e.doc}`} className="border-t border-white/[0.04]">
                <td className="px-4 py-2 font-mono text-white">{e.doc}</td>
                <td className="px-4 py-2 font-mono text-muted">{e.tipo === 'ItemShip' ? 'Fulfillment' : e.tipo === 'CustInvc' ? 'Invoice' : e.tipo}</td>
                <td className="px-4 py-2 font-mono text-muted">{e.fecha}</td>
                <td className="px-4 py-2 font-mono text-slate-300">{e.so ?? '—'}</td>
                <td className="px-4 py-2 font-mono text-white">{e.seriales}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Seccion>

      <Seccion titulo={`Devices in the Field (${v.equipos.length})`}>
        <table className="w-full text-xs">
          <thead><Encabezados hs={['Serial', 'Item', 'Shipped', 'Age', 'Returned?']} /></thead>
          <tbody>
            {equiposVisibles.map(eq => (
              <tr key={eq.serial} className="border-t border-white/[0.04]">
                <td className="px-4 py-2 font-mono text-white">{eq.serial}</td>
                <td className="px-4 py-2 max-w-[300px] truncate" title={nombreSku(eq.sku)}>
                  {isValidSku(eq.sku)
                    ? <Link to={`/item/${eq.sku}`} className="font-mono text-accent hover:text-accent/80">{nombreSku(eq.sku)}</Link>
                    : <span className="font-mono text-muted">{nombreSku(eq.sku)}</span>}
                </td>
                <td className="px-4 py-2 font-mono text-muted">{eq.despacho ?? '—'}</td>
                <td className="px-4 py-2 font-mono text-slate-300">{eq.meses != null ? `${eq.meses} mo` : '—'}</td>
                <td className="px-4 py-2 font-mono">{eq.devuelto ? <span className="text-warning">RMA</span> : <span className="text-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {v.equipos.length > 50 && !verTodos && (
          <button onClick={() => setVerTodos(true)}
            className="w-full px-4 py-2 text-xs font-mono text-accent hover:bg-white/[0.02] border-t border-white/[0.06] transition-colors">
            Show all {v.equipos.length} devices
          </button>
        )}
        <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
          Age counts from the fulfillment date — use it to check warranty at a glance.
        </p>
      </Seccion>
    </div>
  );
}

function Seccion({ titulo, children }) {
  return (
    <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
      <p className="px-4 pt-3 pb-1 text-[10px] text-muted font-sans font-medium uppercase tracking-wider">{titulo}</p>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function Encabezados({ hs }) {
  return (
    <tr>
      {hs.map(h => (
        <th key={h} className="px-4 py-1.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[9px]">{h}</th>
      ))}
    </tr>
  );
}
