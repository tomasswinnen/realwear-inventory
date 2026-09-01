import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { KPICard } from '../components/KPICard';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { formatCurrency } from '../utils/coverage';
import { PEPSI } from '../data/pepsi';

// Programa PepsiCo, vista OPERATIVA: por cada item del kit, cuanto pidio
// Pepsi (y para cuando), cuanto ya se despacho, y contra eso el stock real
// de hoy en Portland / Hong Kong + lo que esta entrando en POs abiertas.
// El pedido vive en src/data/pepsi.js (a mano); stock y POs salen de
// Supabase, asi que se actualizan solos con el pipeline.

const SKUS_PEPSI = PEPSI.items.map(i => i.sku);

async function fetchStockPepsi() {
  const [snapRes, posRes] = await Promise.all([
    supabase.from('inventory_snapshot')
      .select('sku, on_hand_portland, on_hand_hk, updated_at')
      .in('sku', SKUS_PEPSI).order('updated_at', { ascending: false }),
    supabase.from('open_pos')
      .select('*')
      .in('sku', SKUS_PEPSI),
  ]);
  const stock = {};
  for (const s of snapRes.data ?? []) {
    if (!stock[s.sku]) stock[s.sku] = s; // primera = mas reciente
  }
  const entrando = {};
  for (const p of posRes.data ?? []) {
    if (!entrando[p.sku]) entrando[p.sku] = { qty: 0, pos: [] };
    entrando[p.sku].qty += p.qty_open ?? 0;
    entrando[p.sku].pos.push(p);
  }
  return { stock, entrando, hayDatos: !snapRes.error };
}

// Etiqueta corta de entrega por PO: "Q4 2026" / "Q1 2027 (no antes de 11-01)"
function entregaPo(po) {
  return po.ship_not_before ? `${po.tranche} · not before ${po.ship_not_before}` : po.tranche;
}

function num(v) { return v != null ? v.toLocaleString() : '—'; }

export function Pepsi() {
  const { data, loading } = useQuery(fetchStockPepsi, []);
  const pos = PEPSI.purchase_orders;
  const device = PEPSI.items.find(i => i.category === 'device');
  const totalPrograma = pos.reduce((s, p) => s + (p.total ?? 0), 0);

  // Por item: lo pedido vs lo que hay. "to ship" = pedido - despachado.
  // "available" = PDX + HK + entrando. Si no alcanza, faltan unidades.
  const filas = PEPSI.items.map(item => {
    const s = data?.stock?.[item.sku];
    const inc = data?.entrando?.[item.sku];
    const pdx = s?.on_hand_portland ?? null;
    const hk = s?.on_hand_hk ?? null;
    const incoming = inc?.qty ?? 0;
    const porEnviar = item.qty_ordered_total - item.qty_shipped;
    // una PO marcada en riesgo (ej: chip EOL) no cuenta como entrante
    const incomingUtil = item.incoming_at_risk ? 0 : incoming;
    const disponible = (pdx ?? 0) + (hk ?? 0) + incomingUtil;
    const falta = s ? Math.max(0, porEnviar - disponible) : null;
    return { ...item, pdx, hk, incoming, porEnviar, falta, posDetalle: inc?.pos ?? [] };
  });
  const itemsCortos = filas.filter(f => f.falta != null && f.falta > 0).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-sans font-semibold text-white">PepsiCo</h1>
          <p className="text-xs text-muted font-mono mt-0.5">
            {PEPSI.program} · via {PEPSI.reseller}
          </p>
        </div>
        <span className="text-[10px] font-mono px-2 py-1 rounded bg-accent/10 text-accent whitespace-nowrap">
          {PEPSI.total_kits.toLocaleString()} kits · {formatCurrency(totalPrograma)}
        </span>
      </div>

      {/* KPIs */}
      {loading ? <KPISkeleton count={3} /> : (
        <div className="grid grid-cols-3 gap-3">
          <KPICard
            label="Devices Shipped"
            value={`${num(device?.qty_shipped)}/${num(device?.qty_required)}`}
            sub={`${Math.round(((device?.qty_shipped ?? 0) / (device?.qty_required || 1)) * 100)}% of rollout`}
            accent
          />
          <KPICard
            label="Q4 2026"
            value={`${num(pos[0].kits)} kits`}
            sub={`${pos[0].po_number.slice(-6)} · ${pos[0].date}`}
          />
          <KPICard
            label="Q1 2027"
            value={`${num(pos[1].kits)} kits`}
            sub={`ship not before ${pos[1].ship_not_before}`}
          />
        </div>
      )}

      {pos[0].amendment_pending && (
        <p className="text-[11px] font-mono text-warning">
          {pos[0].po_number}: amendment pending — {pos[0].amendment_pending}
        </p>
      )}

      {/* La tabla que importa: pedido vs stock vs entrando */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-sans font-semibold text-white">Ordered vs. your stock</h2>
          {!loading && itemsCortos > 0 && (
            <span className="text-[11px] font-mono text-danger">{itemsCortos} item{itemsCortos > 1 ? 's' : ''} short even counting incoming POs</span>
          )}
        </div>

        {loading ? <TableSkeleton rows={6} cols={7} /> : (
          <>
          {/* Mobile: tarjetas */}
          <div className="sm:hidden space-y-2.5">
            {filas.map(f => (
              <div key={f.sku} className="bg-card rounded-xl border border-white/[0.08] px-4 pt-3 pb-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/item/${f.sku}`} className="font-mono text-accent text-[13px]">{f.sku}</Link>
                  {f.falta != null && f.falta > 0
                    ? <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-danger/10 text-danger">short {f.falta.toLocaleString()}</span>
                    : f.qty_ordered_total === 0
                      ? <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-danger/10 text-danger">not ordered</span>
                      : <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success">covered</span>}
                </div>
                <p className="font-sans text-slate-300 text-xs mt-0.5">{f.name}</p>
                <p className="font-mono text-muted text-[10px] mt-1">
                  Pepsi: {f.qty_ordered_total.toLocaleString()} ({pos.map(p => `${f.qty_by_po[p.po_number] ?? 0} ${p.tranche}`).join(' + ')})
                  {f.qty_shipped > 0 && ` · shipped ${f.qty_shipped.toLocaleString()}`}
                </p>
                {f.incoming_at_risk && f.incoming > 0 && (
                  <p className="font-mono text-warning text-[10px] mt-1">{f.incoming_risk_note}</p>
                )}
                {f.incoming > 0 && (
                  <p className="font-mono text-muted text-[10px] mt-1">
                    {(f.posDetalle ?? []).slice(0, 3).map(p =>
                      `${p.po_number}: ${(p.qty_received ?? 0).toLocaleString()}/${(p.qty_ordered ?? 0).toLocaleString()} recd, ${(p.qty_open ?? 0).toLocaleString()} open`
                    ).join(' · ')}
                  </p>
                )}
                <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                  {[
                    ['To Ship', f.porEnviar.toLocaleString(), 'text-white'],
                    ['PDX', num(f.pdx), 'text-slate-300'],
                    ['HK', num(f.hk), 'text-slate-300'],
                    [f.incoming_at_risk ? 'At Risk' : 'Incoming',
                      f.incoming ? f.incoming.toLocaleString() : '—',
                      f.incoming ? (f.incoming_at_risk ? 'text-warning line-through decoration-warning/50' : 'text-success') : 'text-muted'],
                  ].map(([lbl, val, cls]) => (
                    <div key={lbl} className="rounded-lg bg-white/[0.03] px-1 py-1.5 text-center">
                      <p className="text-[9px] text-muted font-sans font-medium uppercase tracking-wider">{lbl}</p>
                      <p className={`text-[11px] font-mono mt-0.5 ${cls}`}>{val}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: tabla */}
          <div className="hidden sm:block bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['Item', 'Pepsi Ordered', 'Shipped', 'To Ship', 'Stock PDX', 'Stock HK', 'Incoming (POs)', 'Enough?'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filas.map(f => (
                    <tr key={f.sku} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors align-top">
                      <td className="px-4 py-2.5 max-w-[240px]">
                        <Link to={`/item/${f.sku}`} className="font-mono text-accent hover:text-accent/80">{f.sku}</Link>
                        <p className="font-sans text-slate-300 truncate" title={f.description}>{f.name}</p>
                      </td>
                      <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                        <span className="text-white font-medium">{f.qty_ordered_total.toLocaleString()}</span>
                        <div className="text-[10px] text-muted mt-0.5">
                          {pos.map(p => (
                            <div key={p.po_number}>{(f.qty_by_po[p.po_number] ?? 0).toLocaleString()} · {p.tranche}</div>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono">
                        {f.qty_shipped > 0 ? <span className="text-success">{f.qty_shipped.toLocaleString()}</span> : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-white font-medium">{f.porEnviar.toLocaleString()}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-300">{num(f.pdx)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-300">{num(f.hk)}</td>
                      <td className="px-4 py-2.5 font-mono">
                        {f.incoming > 0 ? (
                          <div>
                            {f.incoming_at_risk
                              ? <span className="text-warning line-through decoration-warning/50">{f.incoming.toLocaleString()}</span>
                              : <span className="text-success">{f.incoming.toLocaleString()}</span>}
                            <span className="text-muted text-[10px]"> to receive</span>
                            {f.incoming_at_risk && (
                              <p className="text-[10px] text-warning mt-0.5 whitespace-nowrap">EOL chip — at risk, not counted</p>
                            )}
                            <div className="text-[10px] text-muted mt-0.5">
                              {(f.posDetalle ?? []).slice(0, 4).map(p => (
                                <div key={p.po_number} className="whitespace-nowrap">
                                  {p.po_number} · {(p.qty_received ?? 0).toLocaleString()}/{(p.qty_ordered ?? 0).toLocaleString()} recd · {(p.qty_open ?? 0).toLocaleString()} open
                                  {(p.qty_billed ?? 0) > (p.qty_received ?? 0) && (
                                    <span className="text-warning"> · {(p.qty_billed ?? 0).toLocaleString()} billed, receipts pending</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                        {f.falta == null
                          ? <span className="text-muted">no stock data</span>
                          : f.qty_ordered_total === 0
                            ? <span className="text-danger">not on any PO</span>
                            : f.falta > 0
                              ? <span className="text-danger">need {f.falta.toLocaleString()} more</span>
                              : <span className="text-success">covered</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
              "Enough?" compares what's left to ship against PDX + HK stock plus open incoming POs
              (stock is shared with other customers — it's a ceiling, not a reservation).
              Pepsi order data is manual; stock and incoming POs refresh with the pipeline.
            </p>
          </div>
          </>
        )}
      </section>

      {/* Notas de la orden (lo fino: workband, clips, cargador 65W) */}
      <section className="space-y-1.5">
        <h2 className="text-sm font-sans font-semibold text-white">Order notes</h2>
        {PEPSI.items.filter(i => i.note || i.incoming_risk_note).map(i => (
          <p key={i.sku} className="text-[11px] font-mono text-muted">
            <span className="text-slate-300">{i.sku}</span> — {i.note}
            {i.incoming_risk_note && <span className="text-warning"> · {i.incoming_risk_note}</span>}
          </p>
        ))}
      </section>
    </div>
  );
}
