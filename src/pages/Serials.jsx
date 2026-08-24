import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton } from '../components/Skeleton';
import { isValidSku } from '../utils/coverage';

// Búsqueda de números de serie: qué serial salió en qué documento a qué
// cliente. Fuente: serial_shipments (asignaciones de inventario en
// fulfillments, facturas y cash sales, desde NetSuite).
//
// La búsqueda es SERVER-SIDE a propósito: hay miles de filas y PostgREST corta
// en 1000 por respuesta, así que traer todo al browser y filtrar acá
// silenciosamente perdería resultados. Sin búsqueda se muestran los últimos
// 300 movimientos.
async function fetchSerials(q) {
  let query = supabase.from('serial_shipments')
    .select('serial, sku, doc_number, doc_type, fecha, cliente');
  if (q) {
    const like = `%${q}%`;
    query = query.or(
      `serial.ilike.${like},cliente.ilike.${like},doc_number.ilike.${like},sku.ilike.${like}`
    );
  }
  const res = await query.order('fecha', { ascending: false }).limit(1000);
  if (res.error) throw new Error(res.error.message);
  return res.data ?? [];
}

const DOC_LABEL = {
  ItemShip: 'Fulfillment',
  CustInvc: 'Invoice',
  CashSale: 'Cash Sale',
};

export function Serials() {
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const { data, loading, error, refetch } = useQuery(() => fetchSerials(q), [q]);

  // Agrupar por serial: un mismo equipo aparece en el fulfillment Y en la
  // factura; verlos juntos es justamente el valor de esta pantalla.
  const grupos = useMemo(() => {
    if (!data) return [];
    const g = new Map();
    for (const r of data) {
      if (!g.has(r.serial)) g.set(r.serial, { serial: r.serial, sku: r.sku, eventos: [] });
      g.get(r.serial).eventos.push(r);
    }
    for (const e of g.values()) {
      e.eventos.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
      e.ultima = e.eventos[e.eventos.length - 1];
    }
    return [...g.values()].slice(0, 300);
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
        <p className="text-xs text-muted font-mono mt-0.5">Which serial shipped on which order, to which customer</p>
      </div>

      <form onSubmit={buscar} className="flex items-center gap-2">
        <input
          type="search"
          placeholder="Serial, customer, document # or SKU…"
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
            {q ? `${grupos.length} serials matching "${q}"` : `latest ${grupos.length} serials`}
          </span>
        )}
      </form>

      {loading ? <TableSkeleton rows={10} cols={6} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['Serial', 'SKU', 'Customer', 'Documents', 'Last Event'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grupos.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted font-mono">
                    {q ? `Nothing matches "${q}"` : 'No serial data yet — runs with the pipeline'}
                  </td></tr>
                ) : grupos.map(g => (
                  <tr key={g.serial} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors align-top">
                    <td className="px-4 py-2.5 font-mono text-white whitespace-nowrap">{g.serial}</td>
                    <td className="px-4 py-2.5">
                      {isValidSku(g.sku)
                        ? <Link to={`/item/${g.sku}`} className="font-mono text-accent hover:text-accent/80">{g.sku}</Link>
                        : <span className="font-mono text-muted">{g.sku}</span>}
                    </td>
                    <td className="px-4 py-2.5 font-sans text-slate-300 max-w-[220px] truncate" title={g.ultima?.cliente}>
                      {g.ultima?.cliente ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="space-y-0.5">
                        {g.eventos.map((ev, i) => (
                          <div key={i} className="font-mono text-[11px] whitespace-nowrap">
                            <span className="text-muted">{DOC_LABEL[ev.doc_type] ?? ev.doc_type}</span>{' '}
                            <span className="text-slate-300">{ev.doc_number}</span>{' '}
                            <span className="text-muted">· {ev.fecha}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-muted whitespace-nowrap">{g.ultima?.fecha ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
            A serial normally shows two documents: the fulfillment (physical shipment) and the invoice.
            Search hits serial, customer, document number and SKU.
          </p>
        </div>
      )}
    </div>
  );
}
