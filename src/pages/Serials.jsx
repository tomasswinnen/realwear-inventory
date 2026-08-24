import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton } from '../components/Skeleton';
import { isValidSku } from '../utils/coverage';

// Números de serie AGRUPADOS POR ORDEN: una fila por sales order (o por
// documento, si el evento no vino de una SO), desplegable para ver qué
// seriales salieron adentro. Fuente: serial_shipments.
//
// La búsqueda es SERVER-SIDE a propósito: hay miles de filas y PostgREST corta
// en 1000 por respuesta, así que filtrar en el browser perdería resultados.
async function fetchSerials(q) {
  const build = withSo => {
    let query = supabase.from('serial_shipments').select('*');
    if (q) {
      const like = `%${q}%`;
      const terms = [
        `serial.ilike.${like}`, `cliente.ilike.${like}`,
        `doc_number.ilike.${like}`, `sku.ilike.${like}`,
      ];
      if (withSo) terms.push(`so_number.ilike.${like}`);
      query = query.or(terms.join(','));
    }
    return query.order('fecha', { ascending: false });
  };

  // Paginado: PostgREST corta en 1000 filas por respuesta y UN solo
  // fulfillment masivo (600 seriales de una) puede comerse casi toda esa
  // ventana, dejando la vista en un puñado de órdenes. Se traen hasta 5
  // páginas (5000 eventos) para que la vista por defecto cubra semanas
  // incluso con envíos gigantes en el medio.
  const PAGINA = 1000, TOPE = 5000;
  let conSo = true;
  const filas = [];
  for (let desde = 0; desde < TOPE; desde += PAGINA) {
    let res = await build(conSo).range(desde, desde + PAGINA - 1);
    // so_number es columna nueva: si todavía no existe (SQL pendiente), se
    // reintenta la búsqueda sin ella en vez de romper la página.
    if (res.error && conSo && /so_number/i.test(res.error.message)) {
      conSo = false;
      res = await build(false).range(desde, desde + PAGINA - 1);
    }
    if (res.error) throw new Error(res.error.message);
    const lote = res.data ?? [];
    filas.push(...lote);
    if (lote.length < PAGINA) break;
  }
  const skusRes = await excludeSkus(supabase.from('skus').select('sku, description'));
  return { rows: filas, skus: skusRes.data ?? [] };
}

// Edad desde el despacho físico: el dato que soporte necesita para saber al
// toque si un equipo está en garantía (que se cuenta desde el ship date).
function mesesDesde(fecha) {
  if (!fecha) return null;
  const d = new Date(fecha + 'T00:00:00');
  const hoy = new Date();
  return Math.max(0, (hoy.getFullYear() - d.getFullYear()) * 12 + (hoy.getMonth() - d.getMonth()));
}

const DOC_LABEL = {
  ItemShip: 'Fulfillment',
  CustInvc: 'Invoice',
  CashSale: 'Cash Sale',
};

function Chevron({ open }) {
  return (
    <svg className={`w-3.5 h-3.5 inline-block transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function Serials() {
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [abiertas, setAbiertas] = useState(() => new Set());
  const { data, loading, error, refetch } = useQuery(() => fetchSerials(q), [q]);

  const toggle = k => setAbiertas(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  // Dos niveles: eventos → serial → orden. Primero se junta cada serial con
  // sus eventos (fulfillment + factura del mismo equipo), después se agrupan
  // los seriales bajo su sales order. Si un evento no tiene SO (cash sale, o
  // datos anteriores a la columna so_number), la orden es el documento mismo.
  const { ordenes, descBySku } = useMemo(() => {
    if (!data) return { ordenes: [], descBySku: {} };
    const descBySku = Object.fromEntries(data.skus.map(s => [s.sku, s.description]));
    const porSerial = new Map();
    for (const r of data.rows) {
      if (!porSerial.has(r.serial)) {
        porSerial.set(r.serial, { serial: r.serial, sku: r.sku, eventos: [] });
      }
      porSerial.get(r.serial).eventos.push(r);
    }
    const porOrden = new Map();
    for (const s of porSerial.values()) {
      s.eventos.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
      const ultimo = s.eventos[s.eventos.length - 1];
      const so = s.eventos.map(e => e.so_number).find(Boolean);
      const clave = so || `doc:${ultimo.doc_number}`;
      if (!porOrden.has(clave)) {
        porOrden.set(clave, {
          clave,
          orden: so || ultimo.doc_number,
          esSo: Boolean(so),
          cliente: ultimo.cliente,
          fecha: ultimo.fecha,
          seriales: [],
          skus: new Set(),
        });
      }
      const g = porOrden.get(clave);
      g.seriales.push({ ...s, ultimo });
      if (s.sku) g.skus.add(s.sku);
      if (ultimo.fecha > g.fecha) g.fecha = ultimo.fecha;
    }
    const ordenes = [...porOrden.values()]
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
      .slice(0, 300);
    return { ordenes, descBySku };
  }, [data]);

  const buscar = e => {
    e.preventDefault();
    setQ(input.trim());
  };

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Serial Numbers</h1>
        <p className="text-xs text-muted font-mono mt-0.5">Grouped by order — click one to see which serials shipped in it</p>
      </div>

      <form onSubmit={buscar} className="flex items-center gap-2">
        <input
          type="search"
          placeholder="Serial, SO #, customer, document # or SKU…"
          value={input}
          onChange={e => setInput(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-80"
        />
        <button type="submit"
          className="px-4 py-2 rounded bg-accent text-white text-xs font-mono hover:bg-accent/80 transition-colors">
          Search
        </button>
        {q && (
          <button type="button" onClick={() => { setInput(''); setQ(''); }}
            className="px-3 py-2 rounded text-xs font-mono text-muted hover:text-white transition-colors">
            Clear
          </button>
        )}
        {!loading && (
          <span className="ml-auto text-xs font-mono text-muted">
            {q ? `${ordenes.length} orders matching "${q}"` : `latest ${ordenes.length} orders`}
          </span>
        )}
      </form>

      {loading ? <TableSkeleton rows={10} cols={5} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['Order', 'Customer', 'Serials', 'SKUs', 'Last Event'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordenes.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted font-mono">
                    {q ? `Nothing matches "${q}"` : 'No serial data yet — runs with the pipeline'}
                  </td></tr>
                ) : ordenes.map(g => (
                  <OrdenRow key={g.clave} g={g} descBySku={descBySku}
                    open={abiertas.has(g.clave)} onToggle={() => toggle(g.clave)} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
            Each serial inside an order shows both documents: the fulfillment (physical shipment) and the invoice.
            Search hits serial, sales order, customer, document number and SKU.
          </p>
        </div>
      )}
    </div>
  );
}

function OrdenRow({ g, descBySku, open, onToggle }) {
  // "SKU — nombre" en todos lados: el código solo no le dice nada a nadie
  // fuera de supply chain.
  const etiqueta = sku => (descBySku[sku] ? `${sku} — ${descBySku[sku]}` : sku);
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors cursor-pointer select-none"
      >
        <td className="px-4 py-2.5 font-mono text-white whitespace-nowrap">
          <span className="text-muted mr-1.5"><Chevron open={open} /></span>
          {g.orden}
          {!g.esSo && <span className="ml-1.5 text-[9px] text-muted uppercase">doc</span>}
        </td>
        <td className="px-4 py-2.5 font-sans text-slate-300 max-w-[240px] truncate" title={g.cliente}>
          {g.cliente ?? '—'}
        </td>
        <td className="px-4 py-2.5 font-mono text-white">{g.seriales.length}</td>
        <td className="px-4 py-2.5 font-mono text-muted max-w-[320px] truncate"
          title={[...g.skus].map(etiqueta).join('\n')}>
          {[...g.skus].map(etiqueta).join(' · ') || '—'}
        </td>
        <td className="px-4 py-2.5 font-mono text-muted whitespace-nowrap">{g.fecha}</td>
      </tr>
      {open && (
        <tr className="border-b border-white/[0.04] bg-white/[0.015]">
          <td colSpan={5} className="px-6 py-3">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {['Serial', 'SKU', 'Documents', 'Shipped · Age'].map(h => (
                    <th key={h} className="px-3 py-1.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[9px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.seriales.map(s => {
                  const ship = s.eventos.filter(e => e.doc_type === 'ItemShip').map(e => e.fecha).sort()[0]
                    ?? s.eventos[0]?.fecha;
                  const meses = mesesDesde(ship);
                  return (
                  <tr key={s.serial} className="border-t border-white/[0.04] align-top">
                    <td className="px-3 py-1.5 font-mono text-white whitespace-nowrap">{s.serial}</td>
                    <td className="px-3 py-1.5 max-w-[280px]">
                      {isValidSku(s.sku)
                        ? <Link to={`/item/${s.sku}`} onClick={e => e.stopPropagation()} className="font-mono text-accent hover:text-accent/80">{s.sku}</Link>
                        : <span className="font-mono text-muted">{s.sku}</span>}
                      {descBySku[s.sku] && (
                        <p className="text-[10px] text-muted font-sans truncate" title={descBySku[s.sku]}>
                          {descBySku[s.sku]}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="space-y-0.5">
                        {s.eventos.map((ev, i) => (
                          <div key={i} className="font-mono text-[11px] whitespace-nowrap">
                            <span className="text-muted">{DOC_LABEL[ev.doc_type] ?? ev.doc_type}</span>{' '}
                            <span className="text-slate-300">{ev.doc_number}</span>{' '}
                            <span className="text-muted">· {ev.fecha}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 font-mono whitespace-nowrap">
                      {ship
                        ? <span className="text-slate-300">{ship} <span className="text-muted">· {meses} mo</span></span>
                        : <span className="text-muted">—</span>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
