import { Link } from 'react-router-dom';
import { KPICard } from '../components/KPICard';
import { formatCurrency } from '../utils/coverage';
import { PEPSI } from '../data/pepsi';

// Programa PepsiCo: tablero del deployment WES Navigator 520 via Peak
// Technologies. Los datos viven en src/data/pepsi.js (cargados a mano —
// no dependen del pipeline), asi la pagina siempre carga instantanea.

const ESTADO = {
  confirmed:            { label: 'Confirmed',            cls: 'bg-success/10 text-success' },
  on_po_unconfirmed:    { label: 'On PO — unconfirmed',  cls: 'bg-warning/10 text-warning' },
  required_not_ordered: { label: 'Required — not ordered', cls: 'bg-danger/10 text-danger' },
};

function EstadoBadge({ status }) {
  const e = ESTADO[status] ?? { label: status, cls: 'bg-white/10 text-white/60' };
  return (
    <span className={`inline-block max-w-full truncate align-middle whitespace-nowrap text-[10px] sm:text-xs font-mono px-1.5 sm:px-2 py-0.5 rounded ${e.cls}`}>
      {e.label}
    </span>
  );
}

function Progreso({ hecho, total, className = '' }) {
  const pct = total > 0 ? Math.min(100, (hecho / total) * 100) : 0;
  return (
    <div className={`h-1.5 rounded-full bg-white/[0.06] overflow-hidden ${className}`}>
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

// gap = ordenado vs requerido por el kit list (null cuando no hay requisito)
function calcGap(item) {
  if (item.qty_required == null) return null;
  return item.qty_ordered_total - item.qty_required;
}

function GapCell({ item }) {
  const gap = calcGap(item);
  if (gap == null) return <span className="text-muted font-mono">n/a</span>;
  if (gap === 0) return <span className="text-success font-mono">complete</span>;
  if (gap < 0) return <span className="text-danger font-mono">{gap.toLocaleString()} short</span>;
  return <span className="text-success font-mono">+{gap.toLocaleString()}</span>;
}

export function Pepsi() {
  const pos = PEPSI.purchase_orders;
  const items = PEPSI.items;
  const device = items.find(i => i.category === 'device');
  const totalPrograma = pos.reduce((s, p) => s + (p.total ?? 0), 0);
  const faltantes = items.filter(i => {
    const gap = calcGap(i);
    return gap != null && gap < 0;
  }).length + items.filter(i => i.status === 'required_not_ordered' && calcGap(i) == null).length;

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
          {PEPSI.total_kits.toLocaleString()} kits
        </span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Program Value" value={formatCurrency(totalPrograma)} sub="both POs, before amendments" accent />
        <KPICard label="Total Kits" value={PEPSI.total_kits.toLocaleString()} sub={`${pos.length} purchase orders`} />
        <KPICard
          label="Devices Shipped"
          value={`${(device?.qty_shipped ?? 0).toLocaleString()} / ${(device?.qty_required ?? 0).toLocaleString()}`}
          sub={`${Math.round(((device?.qty_shipped ?? 0) / (device?.qty_required || 1)) * 100)}% of Navigator 520s`}
          color="text-white"
        />
        <KPICard
          label="Line Items Short"
          value={faltantes}
          sub="ordered below kit requirement"
          color={faltantes > 0 ? 'text-warning' : 'text-success'}
        />
      </div>

      {/* Avance de equipos */}
      <div className="bg-card rounded-lg border border-white/[0.08] p-4 lg:p-5">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-xs text-muted uppercase tracking-wider font-sans">Navigator 520 rollout</p>
          <p className="text-xs font-mono text-slate-300">
            {(device?.qty_shipped ?? 0).toLocaleString()} shipped · {((device?.qty_required ?? 0) - (device?.qty_shipped ?? 0)).toLocaleString()} to go
          </p>
        </div>
        <Progreso hecho={device?.qty_shipped ?? 0} total={device?.qty_required ?? 0} />
        {device?.note && <p className="mt-2 text-[10px] font-mono text-muted">{device.note}</p>}
      </div>

      {/* POs */}
      <section className="space-y-2">
        <h2 className="text-sm font-sans font-semibold text-white">Purchase Orders</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {pos.map(po => (
            <div key={po.po_number} className="bg-card rounded-lg border border-white/[0.08] p-4 lg:p-5 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-mono text-white text-sm font-medium">{po.po_number}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-slate-300 whitespace-nowrap">
                  {po.tranche}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs font-mono">
                <span className="text-muted">{po.date} · {po.kits.toLocaleString()} kits</span>
                <span className="text-white">{formatCurrency(po.total)}</span>
              </div>
              {po.amendment_pending && (
                <p className="text-[10px] font-mono text-warning">
                  Amendment pending: {po.amendment_pending}
                </p>
              )}
              {po.ship_not_before && (
                <p className="text-[10px] font-mono text-slate-400">
                  Ship not before {po.ship_not_before}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Items del kit */}
      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-sans font-semibold text-white">Kit Items</h2>
          <p className="text-[11px] text-muted font-mono mt-0.5">
            Ordered vs. what the {PEPSI.total_kits.toLocaleString()}-kit list requires
          </p>
        </div>

        {/* Mobile: tarjetas */}
        <div className="sm:hidden space-y-2.5">
          {items.map(item => {
            return (
              <div key={item.sku} className="bg-card rounded-xl border border-white/[0.08] px-4 pt-3 pb-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/item/${item.sku}`} className="font-mono text-accent text-[13px]">{item.sku}</Link>
                  <EstadoBadge status={item.status} />
                </div>
                <p className="font-sans text-slate-300 text-xs mt-0.5">{item.name}</p>
                <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                  {[
                    ['Required', item.qty_required != null ? item.qty_required.toLocaleString() : '—', 'text-slate-300'],
                    ['Ordered', item.qty_ordered_total.toLocaleString(), 'text-white'],
                    ['Gap', null, ''],
                  ].map(([lbl, val, cls]) => (
                    <div key={lbl} className="rounded-lg bg-white/[0.03] px-1.5 py-1.5 text-center">
                      <p className="text-[9px] text-muted font-sans font-medium uppercase tracking-wider">{lbl}</p>
                      <p className={`text-[11px] font-mono mt-0.5 ${cls}`}>
                        {lbl === 'Gap' ? <GapCell item={item} /> : val}
                      </p>
                    </div>
                  ))}
                </div>
                {item.note && <p className="mt-2 text-[10px] font-mono text-muted">{item.note}</p>}
              </div>
            );
          })}
        </div>

        {/* Desktop: tabla */}
        <div className="hidden sm:block bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['SKU', 'Item', 'Unit Price', 'Per Kit', 'Required', ...pos.map(p => p.po_number), 'Ordered', 'Shipped', 'Gap', 'Status'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.sku} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors align-top">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Link to={`/item/${item.sku}`} className="font-mono text-accent hover:text-accent/80">{item.sku}</Link>
                    </td>
                    <td className="px-4 py-2.5 max-w-[260px]">
                      <p className="font-sans text-slate-200">{item.name}</p>
                      <p className="font-sans text-muted text-[10px] truncate" title={item.description}>{item.description}</p>
                      {item.note && <p className="font-mono text-muted text-[10px] mt-1">{item.note}</p>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-300 whitespace-nowrap">
                      {item.unit_price != null ? formatCurrency(item.unit_price) : <span className="text-warning">TBD</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-muted whitespace-nowrap">
                      {item.qty_per_kit != null ? `${item.qty_per_kit} ${item.uom}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-300">
                      {item.qty_required != null ? item.qty_required.toLocaleString() : '—'}
                    </td>
                    {pos.map(p => (
                      <td key={p.po_number} className="px-4 py-2.5 font-mono text-slate-300">
                        {item.qty_by_po[p.po_number] != null
                          ? item.qty_by_po[p.po_number].toLocaleString()
                          : <span className="text-muted">—</span>}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 font-mono text-white">{item.qty_ordered_total.toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono">
                      {item.qty_shipped > 0
                        ? <span className="text-success">{item.qty_shipped.toLocaleString()}</span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-2.5"><GapCell item={item} /></td>
                    <td className="px-4 py-2.5"><EstadoBadge status={item.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
            Data entered manually from the PepsiCo kit list and Peak Technologies POs —
            it does not refresh with the pipeline. Ping Claude to update quantities.
          </p>
        </div>
      </section>
    </div>
  );
}
