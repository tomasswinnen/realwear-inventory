import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { KPICard } from '../components/KPICard';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { formatCurrency } from '../utils/coverage';

// Pagos de flete y logística. Las facturas salen de los avisos de aprobación
// de Tipalti en el mail de Tomas (FedEx, Javelin, DHL, AIT, forwarders):
// una tarea diaria las extrae a Facturas.csv y el pipeline las sube a
// freight_invoices. Vista: total mensual por vendor + detalle por mes.

async function fetchInvoices() {
  const res = await supabase.from('freight_invoices').select('*')
    .order('invoice_date', { ascending: false });
  return { invoices: res.data ?? [], error: res.error };
}

const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function labelMes(ym) {
  if (!ym) return '—';
  const [y, m] = ym.split('-');
  return `${MESES[Number(m) - 1]} ${y}`;
}

function fmt(n) {
  return n?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—';
}

export function Payments() {
  const { data, loading } = useQuery(fetchInvoices, []);
  const [mesAbierto, setMesAbierto] = useState(null);

  const modelo = useMemo(() => {
    const invoices = data?.invoices ?? [];
    // agrupar por mes (YYYY-MM del invoice_date)
    const meses = new Map();
    const vendoresTotal = new Map();
    for (const inv of invoices) {
      const ym = (inv.invoice_date ?? '').slice(0, 7) || 'unknown';
      if (!meses.has(ym)) meses.set(ym, { ym, total: 0, vendors: new Map(), invoices: [] });
      const m = meses.get(ym);
      const monto = Number(inv.amount) || 0;
      m.total += monto;
      m.vendors.set(inv.vendor, (m.vendors.get(inv.vendor) ?? 0) + monto);
      m.invoices.push(inv);
      vendoresTotal.set(inv.vendor, (vendoresTotal.get(inv.vendor) ?? 0) + monto);
    }
    const lista = [...meses.values()].sort((a, b) => b.ym.localeCompare(a.ym));
    for (const m of lista) m.invoices.sort((a, b) => (b.invoice_date ?? '').localeCompare(a.invoice_date ?? ''));
    // columnas: los 3 vendors mas grandes + Others
    const topVendors = [...vendoresTotal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v]) => v);
    const total = [...vendoresTotal.values()].reduce((s, v) => s + v, 0);
    const esteMes = new Date().toISOString().slice(0, 7);
    const mesPasado = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
    return {
      lista, topVendors, total, count: invoices.length,
      actual: meses.get(esteMes)?.total ?? 0,
      anterior: meses.get(mesPasado)?.total ?? 0,
      esteMes, mesPasado,
    };
  }, [data]);

  const abierto = mesAbierto ?? modelo.lista[0]?.ym ?? null;
  const mesDetalle = modelo.lista.find(m => m.ym === abierto);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-sans font-semibold text-white">Payments</h1>
          <p className="text-xs text-muted font-mono mt-0.5">
            Freight & logistics invoices · from your approval emails, updated daily
          </p>
        </div>
        {!loading && (
          <span className="text-[10px] font-mono px-2 py-1 rounded bg-accent/10 text-accent whitespace-nowrap">
            {modelo.count} invoices · {formatCurrency(modelo.total)}
          </span>
        )}
      </div>

      {/* KPIs */}
      {loading ? <KPISkeleton count={3} /> : (
        <div className="grid grid-cols-3 gap-3">
          <KPICard label={labelMes(modelo.esteMes)} value={formatCurrency(modelo.actual)} sub="invoiced this month" accent />
          <KPICard label={labelMes(modelo.mesPasado)} value={formatCurrency(modelo.anterior)} sub="last month" />
          <KPICard label="All Tracked" value={formatCurrency(modelo.total)} sub={`${modelo.count} invoices`} />
        </div>
      )}

      {/* Resumen mensual por vendor */}
      <section className="space-y-2">
        <h2 className="text-sm font-sans font-semibold text-white">Monthly totals</h2>
        {loading ? <TableSkeleton rows={5} cols={6} /> : (
          <>
          {/* Mobile: tarjetas por mes */}
          <div className="sm:hidden space-y-2.5">
            {modelo.lista.map(m => (
              <button
                key={m.ym}
                onClick={() => setMesAbierto(m.ym)}
                className={`w-full text-left bg-card rounded-xl border px-4 py-3 transition-colors ${
                  abierto === m.ym ? 'border-accent/40' : 'border-white/[0.08]'}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-sans font-semibold text-white text-sm">{labelMes(m.ym)}</span>
                  <span className="font-mono text-white text-sm">${fmt(m.total)}</span>
                </div>
                <p className="font-mono text-muted text-[10px] mt-1">
                  {[...m.vendors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
                    .map(([v, t]) => `${v.split(' ')[0]} $${Math.round(t).toLocaleString()}`).join(' · ')}
                  {` · ${m.invoices.length} inv`}
                </p>
              </button>
            ))}
          </div>

          {/* Desktop: tabla mes × vendor */}
          <div className="hidden sm:block bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['Month', ...modelo.topVendors, 'Others', 'Total', 'Invoices'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {modelo.lista.map(m => {
                    const otros = m.total - modelo.topVendors.reduce((s, v) => s + (m.vendors.get(v) ?? 0), 0);
                    return (
                      <tr
                        key={m.ym}
                        onClick={() => setMesAbierto(m.ym)}
                        className={`border-b border-white/[0.04] cursor-pointer transition-colors ${
                          abierto === m.ym ? 'bg-accent/[0.06]' : 'hover:bg-white/[0.02]'}`}
                      >
                        <td className="px-4 py-2.5 font-sans text-white font-medium whitespace-nowrap">{labelMes(m.ym)}</td>
                        {modelo.topVendors.map(v => (
                          <td key={v} className="px-4 py-2.5 font-mono text-slate-300">
                            {m.vendors.has(v) ? `$${fmt(m.vendors.get(v))}` : <span className="text-muted">—</span>}
                          </td>
                        ))}
                        <td className="px-4 py-2.5 font-mono text-slate-300">{otros > 0.005 ? `$${fmt(otros)}` : <span className="text-muted">—</span>}</td>
                        <td className="px-4 py-2.5 font-mono text-white font-medium">${fmt(m.total)}</td>
                        <td className="px-4 py-2.5 font-mono text-muted">{m.invoices.length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
              Grouped by invoice date. Click a month to see its invoices below.
            </p>
          </div>
          </>
        )}
      </section>

      {/* Detalle del mes seleccionado */}
      {!loading && mesDetalle && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-sans font-semibold text-white">Invoices · {labelMes(mesDetalle.ym)}</h2>
            <span className="text-[11px] font-mono text-muted">{mesDetalle.invoices.length} invoices · ${fmt(mesDetalle.total)}</span>
          </div>

          {/* Mobile: tarjetas */}
          <div className="sm:hidden space-y-2.5">
            {mesDetalle.invoices.map(inv => (
              <div key={inv.invoice_number} className="bg-card rounded-xl border border-white/[0.08] px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-accent text-[13px] truncate">{inv.invoice_number}</span>
                  <span className="font-mono text-white text-sm whitespace-nowrap">${fmt(Number(inv.amount))}</span>
                </div>
                <p className="font-sans text-slate-300 text-xs mt-0.5">{inv.vendor}</p>
                <p className="font-mono text-muted text-[10px] mt-1">
                  {inv.invoice_date}{inv.due_date ? ` · due ${inv.due_date}` : ''}
                </p>
                {inv.detail && <p className="font-mono text-muted text-[10px] mt-1 break-words">{inv.detail}</p>}
              </div>
            ))}
          </div>

          {/* Desktop: tabla */}
          <div className="hidden sm:block bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['Date', 'Vendor', 'Invoice #', 'Amount', 'Due', 'Breakdown'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mesDetalle.invoices.map(inv => (
                    <tr key={inv.invoice_number} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors align-top">
                      <td className="px-4 py-2.5 font-mono text-slate-300 whitespace-nowrap">{inv.invoice_date}</td>
                      <td className="px-4 py-2.5 font-sans text-slate-300 whitespace-nowrap">{inv.vendor}</td>
                      <td className="px-4 py-2.5 font-mono text-accent whitespace-nowrap">{inv.invoice_number}</td>
                      <td className="px-4 py-2.5 font-mono text-white font-medium whitespace-nowrap">${fmt(Number(inv.amount))}</td>
                      <td className="px-4 py-2.5 font-mono text-muted whitespace-nowrap">{inv.due_date ?? '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-muted max-w-[340px]">
                        <p className="truncate" title={inv.detail}>{inv.detail || '—'}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
              Breakdown = expense-account split from the approval email (accounts 5030–5034 freight, 6410 shipping, VAT/duties).
            </p>
          </div>
        </section>
      )}

      {!loading && modelo.count === 0 && (
        <p className="text-xs font-mono text-muted">
          No invoices yet — run the pipeline after creating the freight_invoices table (SQL_freight_invoices.sql).
        </p>
      )}
    </div>
  );
}
