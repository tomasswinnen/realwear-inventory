import { Fragment, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { KPICard } from '../components/KPICard';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { formatCurrency } from '../utils/coverage';

// Pagos de flete y logística, desglosados por vendor y por mes, con TODAS
// las líneas de cada factura (la cuenta contable del aviso de Tipalti).
// Fuente: freight_invoices (el mail de Tomas → Facturas.csv → pipeline).

async function fetchInvoices() {
  const res = await supabase.from('freight_invoices').select('*')
    .order('invoice_date', { ascending: false });
  return { invoices: res.data ?? [], error: res.error };
}

const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CATS = ['Outbound', 'Transfers', 'Inbound', 'Customs & duties', 'Other freight',
  'VAT / taxes', 'Shipping (non-cust.)', 'Warehouse / storage', 'Inventory', 'Unclassified'];

function labelMes(ym) {
  if (!ym) return '—';
  const [y, m] = ym.split('-');
  return `${MESES[Number(m) - 1]} ${y}`;
}

function fmt(n) {
  return n?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—';
}

// "5034 Freight - Transfers" → categoría legible
function categoria(label) {
  const code = label.match(/^(\d{4})\s/)?.[1];
  if (code === '5030') return 'Outbound';
  if (code === '5031') return 'Inbound';
  if (code === '5032') return 'Customs & duties';
  if (code === '5033') return 'Other freight';
  if (code === '5034') return 'Transfers';
  if (code === '6410') return 'Shipping (non-cust.)';
  if (code?.startsWith('2')) return 'VAT / taxes';
  if (/vat|tax|excise/i.test(label)) return 'VAT / taxes';
  if (/whshd|storag|warehouse|handling/i.test(label)) return 'Warehouse / storage';
  if (/dfrt|conectiv/i.test(label)) return 'Outbound';
  if (/dangerous goods|dsup/i.test(label)) return 'Other freight';
  if (/outbound/i.test(label)) return 'Outbound';
  if (/inbound/i.test(label)) return 'Inbound';
  if (/transfer/i.test(label)) return 'Transfers';
  if (/inventory/i.test(label)) return 'Inventory';
  return 'Unclassified';
}

// detail "5030 Freight - Outbound: 589.67 | ..." → [{label, monto, cat}]
// Si las líneas no suman el total (o no hay detail), el resto va como
// "Not itemized" para que el desglose siempre cierre contra la factura.
function lineasDe(inv) {
  const out = [];
  for (const seg of (inv.detail ?? '').split(' | ')) {
    const i = seg.lastIndexOf(': ');
    if (i < 0) continue;
    const monto = parseFloat(seg.slice(i + 2).replace(/,/g, ''));
    if (!Number.isFinite(monto)) continue;
    const label = seg.slice(0, i).trim();
    out.push({ label, monto, cat: categoria(label) });
  }
  const resto = (Number(inv.amount) || 0) - out.reduce((s, l) => s + l.monto, 0);
  if (Math.abs(resto) > 0.01) out.push({ label: 'Not itemized', monto: resto, cat: 'Unclassified' });
  return out;
}

export function Payments() {
  const { data, loading } = useQuery(fetchInvoices, []);
  const [vendorSel, setVendorSel] = useState('All');

  const todos = data?.invoices ?? [];
  const vendors = useMemo(() => {
    const tot = new Map();
    for (const inv of todos) tot.set(inv.vendor, (tot.get(inv.vendor) ?? 0) + (Number(inv.amount) || 0));
    return [...tot.entries()].sort((a, b) => b[1] - a[1]);
  }, [todos]);

  const modelo = useMemo(() => {
    const invoices = vendorSel === 'All' ? todos : todos.filter(i => i.vendor === vendorSel);
    const meses = new Map();
    for (const inv of invoices) {
      const ym = (inv.invoice_date ?? '').slice(0, 7) || 'unknown';
      if (!meses.has(ym)) meses.set(ym, { ym, total: 0, cats: new Map(), porVendor: new Map() });
      const m = meses.get(ym);
      const monto = Number(inv.amount) || 0;
      m.total += monto;
      for (const l of lineasDe(inv)) m.cats.set(l.cat, (m.cats.get(l.cat) ?? 0) + l.monto);
      if (!m.porVendor.has(inv.vendor)) m.porVendor.set(inv.vendor, { vendor: inv.vendor, total: 0, invoices: [] });
      const v = m.porVendor.get(inv.vendor);
      v.total += monto;
      v.invoices.push(inv);
    }
    const lista = [...meses.values()].sort((a, b) => b.ym.localeCompare(a.ym));
    for (const m of lista) {
      m.vendors = [...m.porVendor.values()].sort((a, b) => b.total - a.total);
      m.count = m.vendors.reduce((s, v) => s + v.invoices.length, 0);
      for (const v of m.vendors) v.invoices.sort((a, b) => (b.invoice_date ?? '').localeCompare(a.invoice_date ?? ''));
    }
    const total = invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const catCols = CATS.filter(c => lista.some(m => (m.cats.get(c) ?? 0) > 0.005));
    const esteMes = new Date().toISOString().slice(0, 7);
    const mesPasado = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
    return {
      lista, total, catCols, count: invoices.length,
      actual: meses.get(esteMes)?.total ?? 0,
      anterior: meses.get(mesPasado)?.total ?? 0,
      esteMes, mesPasado,
    };
  }, [todos, vendorSel]);

  // resumen por vendor (siempre sobre TODAS las facturas, para comparar)
  const porVendor = useMemo(() => vendors.map(([v, total]) => {
    const invs = todos.filter(i => i.vendor === v);
    const suma = ym => invs.filter(i => (i.invoice_date ?? '').startsWith(ym))
      .reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const granTotal = vendors.reduce((s, [, t]) => s + t, 0);
    return {
      vendor: v, total, count: invs.length,
      actual: suma(modelo.esteMes), anterior: suma(modelo.mesPasado),
      pct: granTotal ? (total / granTotal) * 100 : 0,
    };
  }), [vendors, todos, modelo.esteMes, modelo.mesPasado]);

  const chips = ['All', ...vendors.map(([v]) => v)];
  const irAlMes = ym => document.getElementById(`mes-${ym}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

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

      {/* Filtro por vendor */}
      {!loading && (
        <div className="flex gap-1.5 max-w-full overflow-x-auto pb-0.5">
          {chips.map(v => (
            <button
              key={v}
              onClick={() => setVendorSel(v)}
              className={`flex-none whitespace-nowrap px-3 py-1.5 rounded-full text-[11px] font-sans font-medium transition-colors ${
                vendorSel === v ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-slate-400 active:bg-white/[0.08] hover:text-slate-200'}`}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      {/* KPIs (del vendor filtrado) */}
      {loading ? <KPISkeleton count={3} /> : (
        <div className="grid grid-cols-3 gap-3">
          <KPICard label={labelMes(modelo.esteMes)} value={formatCurrency(modelo.actual)} sub={`invoiced this month${vendorSel !== 'All' ? ` · ${vendorSel}` : ''}`} accent />
          <KPICard label={labelMes(modelo.mesPasado)} value={formatCurrency(modelo.anterior)} sub="last month" />
          <KPICard label="All Tracked" value={formatCurrency(modelo.total)} sub={`${modelo.count} invoices`} />
        </div>
      )}

      {/* Por vendor */}
      {!loading && vendorSel === 'All' && (
        <section className="space-y-2">
          <h2 className="text-sm font-sans font-semibold text-white">By vendor</h2>

          {/* Mobile */}
          <div className="sm:hidden space-y-2.5">
            {porVendor.map(v => (
              <button key={v.vendor} onClick={() => setVendorSel(v.vendor)}
                className="w-full text-left bg-card rounded-xl border border-white/[0.08] px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-sans font-semibold text-white text-sm truncate">{v.vendor}</span>
                  <span className="font-mono text-white text-sm whitespace-nowrap">${fmt(v.total)}</span>
                </div>
                <p className="font-mono text-muted text-[10px] mt-1">
                  {v.count} inv · {v.pct.toFixed(1)}% of spend · this month ${fmt(v.actual)}
                </p>
              </button>
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden sm:block bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['Vendor', 'Invoices', labelMes(modelo.esteMes), labelMes(modelo.mesPasado), 'Total', '% of spend'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {porVendor.map(v => (
                    <tr key={v.vendor} onClick={() => setVendorSel(v.vendor)}
                      className="border-b border-white/[0.04] cursor-pointer hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5 font-sans text-white font-medium whitespace-nowrap">{v.vendor}</td>
                      <td className="px-4 py-2.5 font-mono text-muted">{v.count}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-300">{v.actual > 0.005 ? `$${fmt(v.actual)}` : <span className="text-muted">—</span>}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-300">{v.anterior > 0.005 ? `$${fmt(v.anterior)}` : <span className="text-muted">—</span>}</td>
                      <td className="px-4 py-2.5 font-mono text-white font-medium">${fmt(v.total)}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-300">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                            <div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.max(2, v.pct)}%` }} />
                          </div>
                          {v.pct.toFixed(1)}%
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
              Click a vendor (or use the chips above) to drill into just that vendor.
            </p>
          </div>
        </section>
      )}

      {/* Mensual por categoría de gasto */}
      <section className="space-y-2">
        <h2 className="text-sm font-sans font-semibold text-white">
          Monthly by category{vendorSel !== 'All' ? ` · ${vendorSel}` : ''}
        </h2>
        {loading ? <TableSkeleton rows={5} cols={6} /> : (
          <>
          {/* Mobile: tarjetas por mes con categorías */}
          <div className="sm:hidden space-y-2.5">
            {modelo.lista.map(m => (
              <button
                key={m.ym}
                onClick={() => irAlMes(m.ym)}
                className="w-full text-left bg-card rounded-xl border border-white/[0.08] px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-sans font-semibold text-white text-sm">{labelMes(m.ym)}</span>
                  <span className="font-mono text-white text-sm">${fmt(m.total)}</span>
                </div>
                <p className="font-mono text-muted text-[10px] mt-1">
                  {modelo.catCols.filter(c => (m.cats.get(c) ?? 0) > 0.005).slice(0, 4)
                    .map(c => `${c} $${Math.round(m.cats.get(c)).toLocaleString()}`).join(' · ')}
                  {` · ${m.count} inv`}
                </p>
              </button>
            ))}
          </div>

          {/* Desktop: tabla mes × categoría */}
          <div className="hidden sm:block bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['Month', ...modelo.catCols, 'Total', 'Inv'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {modelo.lista.map(m => (
                    <tr
                      key={m.ym}
                      onClick={() => irAlMes(m.ym)}
                      className="border-b border-white/[0.04] cursor-pointer hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-3 py-2.5 font-sans text-white font-medium whitespace-nowrap">{labelMes(m.ym)}</td>
                      {modelo.catCols.map(c => (
                        <td key={c} className="px-3 py-2.5 font-mono text-slate-300 whitespace-nowrap">
                          {(m.cats.get(c) ?? 0) > 0.005 ? `$${fmt(m.cats.get(c))}` : <span className="text-muted">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 font-mono text-white font-medium whitespace-nowrap">${fmt(m.total)}</td>
                      <td className="px-3 py-2.5 font-mono text-muted">{m.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
              Categories come from the expense-account split on each approval email
              (5030 outbound · 5034 transfers · 5031 inbound · 5032 customs & duties · 5033 other ·
              6410 non-customer shipping · 2xxx VAT/taxes). Click a month to jump to its invoices.
            </p>
          </div>
          </>
        )}
      </section>

      {/* Estado de cuenta: cada mes → cada vendor → cada factura con TODAS sus líneas */}
      {!loading && modelo.lista.map(m => (
        <section key={m.ym} id={`mes-${m.ym}`} className="space-y-2 scroll-mt-16">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-sans font-semibold text-white">{labelMes(m.ym)}</h2>
            <span className="text-[11px] font-mono text-muted">{m.count} invoices · ${fmt(m.total)}</span>
          </div>

          {/* Mobile: bloque por vendor con tarjetas */}
          <div className="sm:hidden space-y-3">
            {m.vendors.map(v => (
              <div key={v.vendor} className="space-y-2">
                <div className="flex items-baseline justify-between gap-2 px-1">
                  <span className="text-[11px] font-sans font-semibold text-slate-300">{v.vendor}</span>
                  <span className="text-[11px] font-mono text-slate-300">${fmt(v.total)} · {v.invoices.length} inv</span>
                </div>
                {v.invoices.map(inv => (
                  <div key={inv.invoice_number} className="bg-card rounded-xl border border-white/[0.08] px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-accent text-[13px] truncate">{inv.invoice_number}</span>
                      <span className="font-mono text-white text-sm whitespace-nowrap">${fmt(Number(inv.amount))}</span>
                    </div>
                    <p className="font-mono text-muted text-[10px] mt-1">
                      {inv.invoice_date}{inv.due_date ? ` · due ${inv.due_date}` : ''}
                    </p>
                    <div className="mt-2 space-y-0.5 border-t border-white/[0.06] pt-2">
                      {lineasDe(inv).map((l, i) => (
                        <div key={i} className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
                          <span className="text-muted truncate">{l.label}</span>
                          <span className="text-slate-300 whitespace-nowrap">${fmt(l.monto)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Desktop: tabla con subtotales por vendor y líneas completas */}
          <div className="hidden sm:block bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['Date', 'Invoice #', 'Amount', 'Due', 'Invoice lines (expense account · amount)'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {m.vendors.map(v => (
                    <Fragment key={`${m.ym}-${v.vendor}`}>
                      <tr className="border-b border-white/[0.04] bg-white/[0.03]">
                        <td colSpan={2} className="px-4 py-2 font-sans font-semibold text-slate-200">{v.vendor}</td>
                        <td className="px-4 py-2 font-mono font-semibold text-slate-200 whitespace-nowrap">${fmt(v.total)}</td>
                        <td colSpan={2} className="px-4 py-2 font-mono text-muted text-[10px]">{v.invoices.length} invoice{v.invoices.length > 1 ? 's' : ''}</td>
                      </tr>
                      {v.invoices.map(inv => (
                        <tr key={inv.invoice_number} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors align-top">
                          <td className="px-4 py-2.5 font-mono text-slate-300 whitespace-nowrap">{inv.invoice_date}</td>
                          <td className="px-4 py-2.5 font-mono text-accent whitespace-nowrap">{inv.invoice_number}</td>
                          <td className="px-4 py-2.5 font-mono text-white font-medium whitespace-nowrap">${fmt(Number(inv.amount))}</td>
                          <td className="px-4 py-2.5 font-mono text-muted whitespace-nowrap">{inv.due_date ?? '—'}</td>
                          <td className="px-4 py-2.5 font-mono text-[11px]">
                            {lineasDe(inv).map((l, i) => (
                              <div key={i} className="whitespace-nowrap">
                                <span className="text-muted">{l.label}</span>
                                <span className="text-slate-300"> — ${fmt(l.monto)}</span>
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ))}

      {!loading && todos.length === 0 && (
        <p className="text-xs font-mono text-muted">
          No invoices yet — run the pipeline after creating the freight_invoices table (SQL_freight_invoices.sql).
        </p>
      )}
    </div>
  );
}
