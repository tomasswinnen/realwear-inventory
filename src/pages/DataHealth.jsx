import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, paginar } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { estadoGarantia, nombreCuenta } from '../utils/warranty';

// Device data health: de cada equipo que los distribuidores reportan haber
// vendido, ¿sabemos quién lo tiene y hasta cuándo está cubierto, y en qué
// sistema vive ese dato? Es la página para Dirección/Channel: pone nombre y
// número al agujero, por distribuidor, y dice dónde vive cada dato.
//
// Universo = sellout_devices (lo que reportan los distis). Se cruza con:
//   · warranty_serials  → cobertura y end customer cargados en NetSuite
//   · launchpad_subs    → registro del cliente en Launchpad (+ end customer)
//   · ns_match          → cruce serial vs NetSuite calculado por el pipeline
// Nada de esto se inventa: si un dato no está en ningún lado, se dice.

async function fetchHealth() {
  const traer = async armar => {
    try { return await paginar(armar); } catch { return null; }
  };
  const [sellout, ws, lp, inv] = await Promise.all([
    traer(() => supabase.from('sellout_devices').select('*')),
    traer(() => supabase.from('warranty_serials').select('serial, end_customer, end_date, so_number, customer')),
    traer(() => supabase.from('launchpad_subs').select('serial, customer, end_date, plan_code, reseller')),
    traer(() => supabase.from('warranties').select('so_number, customer').eq('start_source', 'invoice')),
  ]);
  return { sellout: sellout ?? [], ws: ws ?? [], lp: lp ?? [], inv: inv ?? [], falta: sellout === null };
}

const norm = s => (s ?? '').trim().toUpperCase();
const mismo = (a, b) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
const pct = (n, d) => (d ? `${Math.round(100 * n / d)}%` : '—');

// Dónde vive cada dato. Es texto fijo a propósito: es la explicación que
// Dirección necesita leer una sola vez, y cambia cuando cambia el proceso.
const FUENTES = [
  { dato: 'Serial & SKU shipped', vive: 'NetSuite (fulfillment / invoice with inventory detail)', estado: 'auto', nota: 'Pipeline every 2h. Fails only when a device leaves without inventory detail (see "invoice only").' },
  { dato: 'Distributor invoiced', vive: 'NetSuite (billed-to account)', estado: 'auto', nota: '' },
  { dato: 'Paid plan / subscription & end date', vive: 'NetSuite (SO line or invoice line with coverage dates)', estado: 'auto', nota: 'Standard 1-year warranty is NOT a line item: only visible when the customer registers in Launchpad.' },
  { dato: 'Customer registration (Launchpad)', vive: 'NetSuite custom record "Device Registration" (filled nightly from Launchpad/Retool)', estado: 'manual', nota: 'The integration role cannot read that record yet (HTTP 400) → loaded from a manual Retool export, 30-day window.' },
  { dato: 'Reseller & end customer behind the distributor', vive: 'Only the Channel Ops sell-out Excel ("Sale Out data"), compiled by hand from emails to channel@realwear.com', estado: 'excel', nota: 'Not in NetSuite, not in Launchpad for most devices. Shown as "per sell-out" across the site.' },
  { dato: 'Date the distributor sold the device', vive: 'Only the sell-out Excel', estado: 'excel', nota: 'NetSuite only has RealWear’s invoice date to the distributor.' },
];
const ESTADO = {
  auto: { label: 'automatic', cls: 'bg-success/15 text-success' },
  manual: { label: 'manual export', cls: 'bg-warning/15 text-warning' },
  excel: { label: 'Excel only', cls: 'bg-danger/15 text-danger' },
};

const NS = {
  typo: { label: 'serial typo?', cls: 'bg-warning/15 text-warning' },
  invoice_only: { label: 'invoice only', cls: 'bg-danger/15 text-danger' },
  not_found: { label: 'not in NetSuite', cls: 'bg-danger/15 text-danger' },
};

async function exportarExcel(filas, noReportados) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(filas.map(r => ({
    'Distributor': r.distributor ?? '', 'Serial': r.serial, 'SKU': r.sku ?? '',
    'Date sold (sell-out)': r.date_sold ?? '',
    'End customer': r.ec ?? '',
    'End customer source': r.ecSource === 'netsuite' ? 'NetSuite' : r.ecSource === 'launchpad' ? 'Launchpad' : r.ecSource === 'sellout' ? 'sell-out Excel only' : r.ecSource === 'reseller' ? 'unknown — trail stops at reseller' : 'unknown — no trace',
    'Reseller (sell-out)': r.reseller ?? '',
    'Coverage on record': r.cobertura ? 'yes' : 'no',
    'Coverage end': r.coberturaFin ?? '',
    'Coverage source': r.cobertura ?? '',
    'NetSuite check': r.ns_match ?? 'pending',
    'NetSuite serial (if typo)': r.ns_serial ?? '',
    'Launchpad says': r.lpCustomer ?? '',
    'Sell-out says': r.end_customer ?? '',
    'Customer mismatch': r.mismatch ? 'yes' : '',
  })));
  ws1['!cols'] = [{ wch: 22 }, { wch: 19 }, { wch: 9 }, { wch: 12 }, { wch: 30 }, { wch: 18 }, { wch: 24 },
                  { wch: 9 }, { wch: 11 }, { wch: 12 }, { wch: 13 }, { wch: 19 }, { wch: 28 }, { wch: 28 }, { wch: 9 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Devices (sell-out vs systems)');
  const ws2 = XLSX.utils.json_to_sheet(noReportados.map(r => ({
    'Billed to': r.billed, 'Serial': r.serial, 'Invoice': r.so_number, 'Coverage end': r.end_date ?? '',
  })));
  ws2['!cols'] = [{ wch: 32 }, { wch: 19 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Subscriptions not reported');
  XLSX.writeFile(wb, `device_data_health_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function DataHealth() {
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [exportando, setExportando] = useState(false);
  const { data, loading, error, refetch } = useQuery(fetchHealth, []);

  const v = useMemo(() => {
    if (!data) return null;
    const wsPor = new Map();
    for (const w of data.ws) {
      const k = norm(w.serial);
      const prev = wsPor.get(k);
      if (!prev || (w.end_date ?? '') > (prev.end_date ?? '')) wsPor.set(k, w);
      if (prev && !(prev.end_customer ?? '').trim() && (w.end_customer ?? '').trim()) wsPor.set(k, { ...wsPor.get(k), end_customer: w.end_customer });
    }
    const lpPor = new Map();
    for (const l of data.lp) {
      const k = norm(l.serial);
      const prev = lpPor.get(k);
      if (!prev || (l.end_date ?? '') > (prev.end_date ?? '')) lpPor.set(k, l);
    }
    const facturasInv = new Map(data.inv.map(w => [w.so_number, w.customer]));

    const filas = data.sellout.map(r => {
      const k = norm(r.serial);
      const w = wsPor.get(k) ?? null;
      const l = lpPor.get(k) ?? null;
      const ecNs = (w?.end_customer ?? '').trim();
      const ecLp = (l?.customer ?? '').trim();
      const ecSo = (r.end_customer ?? '').trim();
      // 'reseller' = el disti sí lo vendió (a un reseller, con fecha) pero
      // nadie reportó a quién se lo vendió el reseller: el rastro se corta ahí.
      const resSo = (r.reseller ?? '').trim();
      const ecSource = ecNs ? 'netsuite' : ecLp ? 'launchpad' : ecSo ? 'sellout' : resSo ? 'reseller' : null;
      const ec = ecNs || ecLp || ecSo || null;
      const cobertura = w ? 'NetSuite' : l ? 'Launchpad' : null;
      const coberturaFin = w?.end_date ?? l?.end_date ?? null;
      return {
        ...r, ec, ecSource, cobertura, coberturaFin,
        lpCustomer: ecLp || null,
        mismatch: Boolean(ecLp && ecSo && !mismo(ecLp, ecSo)),
      };
    });

    // Por distribuidor: la tabla que pone nombre al agujero.
    const porDisti = new Map();
    for (const r of filas) {
      const d = r.distributor ?? '(no distributor)';
      if (!porDisti.has(d)) porDisti.set(d, { disti: d, regs: [] });
      porDisti.get(d).regs.push(r);
    }
    const distis = [...porDisti.values()].map(g => {
      const n = g.regs.length;
      const cnt = f => g.regs.filter(f).length;
      return {
        ...g, n,
        ecSistema: cnt(r => r.ecSource === 'netsuite' || r.ecSource === 'launchpad'),
        ecSellout: cnt(r => r.ecSource === 'sellout'),
        ecReseller: cnt(r => r.ecSource === 'reseller'),
        ecNinguno: cnt(r => !r.ecSource),
        conCobertura: cnt(r => r.cobertura),
        sinCobertura: cnt(r => !r.cobertura),
        nsMal: cnt(r => NS[r.ns_match]),
        mismatch: cnt(r => r.mismatch),
      };
    }).sort((a, b) => b.n - a.n);

    // Al revés: suscripciones facturadas por NetSuite que ningún disti reportó
    // como vendidas (en stock del disti, o reporte que falta).
    const enSellout = new Set(filas.map(r => norm(r.serial)));
    const noReportados = data.ws
      .filter(w => facturasInv.has(w.so_number) && !enSellout.has(norm(w.serial)))
      .map(w => ({ serial: w.serial, so_number: w.so_number, end_date: w.end_date, billed: nombreCuenta(facturasInv.get(w.so_number)) }))
      .filter(w => estadoGarantia(w.end_date) !== 'expired');
    const noRepPor = new Map();
    for (const w of noReportados) {
      if (!noRepPor.has(w.billed)) noRepPor.set(w.billed, []);
      noRepPor.get(w.billed).push(w);
    }

    const total = filas.length;
    const cnt = f => filas.filter(f).length;
    const nsChecked = filas.some(r => r.ns_match);
    const kpi = {
      total,
      ecSistema: cnt(r => r.ecSource === 'netsuite' || r.ecSource === 'launchpad'),
      ecSellout: cnt(r => r.ecSource === 'sellout'),
      ecReseller: cnt(r => r.ecSource === 'reseller'),
      ecNinguno: cnt(r => !r.ecSource),
      conCobertura: cnt(r => r.cobertura),
      nsTypo: cnt(r => r.ns_match === 'typo'),
      nsInvoice: cnt(r => r.ns_match === 'invoice_only'),
      nsNone: cnt(r => r.ns_match === 'not_found'),
      nsChecked,
      mismatch: cnt(r => r.mismatch),
      noReportados: noReportados.length,
    };
    return { filas, distis, kpi, noReportados, noRepPor: [...noRepPor.entries()].sort((a, b) => b[1].length - a[1].length) };
  }, [data]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  const alternar = k => setAbiertos(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const exportar = async () => {
    if (exportando || !v) return;
    setExportando(true);
    try { await exportarExcel(v.filas, v.noReportados); } finally { setExportando(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-sans font-semibold text-white">Device data health</h1>
          <p className="text-xs text-muted font-mono mt-0.5">
            For every device the distributors report as sold: do we know who has it, and is its coverage on record — and in which system does that fact live?
          </p>
        </div>
        <button onClick={exportar} disabled={exportando || !v}
          className="sm:ml-auto px-3 py-1.5 rounded border border-white/[0.12] text-[11px] font-mono text-slate-300 hover:text-white hover:border-accent/50 disabled:opacity-60 transition-colors whitespace-nowrap">
          {exportando ? 'Exporting…' : 'Export Excel (serial by serial)'}
        </button>
      </div>

      {loading || !v ? <KPISkeleton /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="Devices sold by distributors" value={v.kpi.total.toLocaleString()}
            sub="per the sell-out reports (this year’s Excel)" accent />
          <KPICard label="End customer known" value={pct(v.kpi.ecSistema + v.kpi.ecSellout, v.kpi.total)}
            color={v.kpi.ecReseller + v.kpi.ecNinguno ? 'text-warning' : undefined}
            sub={`${v.kpi.ecSistema} in NetSuite/Launchpad · ${v.kpi.ecSellout} only in the Excel · ${v.kpi.ecReseller} trail stops at a reseller · ${v.kpi.ecNinguno} no trace`} />
          <KPICard label="Coverage on record" value={pct(v.kpi.conCobertura, v.kpi.total)}
            color={v.kpi.total === v.kpi.conCobertura ? undefined : v.kpi.total - v.kpi.conCobertura > v.kpi.conCobertura ? 'text-danger' : 'text-warning'}
            sub={`${(v.kpi.total - v.kpi.conCobertura).toLocaleString()} devices with no plan and no Launchpad registration`} />
          <KPICard label="Serials not matching NetSuite"
            value={v.kpi.nsChecked ? (v.kpi.nsTypo + v.kpi.nsInvoice + v.kpi.nsNone).toLocaleString() : '—'}
            color={v.kpi.nsTypo + v.kpi.nsInvoice + v.kpi.nsNone ? 'text-warning' : undefined}
            sub={v.kpi.nsChecked
              ? `${v.kpi.nsTypo} typo · ${v.kpi.nsInvoice} invoice only · ${v.kpi.nsNone} unknown · ${v.kpi.mismatch} customer mismatch vs Launchpad`
              : 'computed on the next pipeline run'} />
        </div>
      )}

      {data?.falta && (
        <p className="text-xs font-mono text-warning bg-warning/5 border border-warning/20 rounded px-3 py-2">
          Sell-out table not loaded yet — run the pipeline once.
        </p>
      )}

      {/* Dónde vive cada dato */}
      <section className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
          <span className="font-sans font-semibold text-sm text-white">Where each fact lives</span>
          <span className="ml-3 font-mono text-[11px] text-muted">green = flows automatically · amber = manual export · red = exists only in an Excel</span>
        </header>
        <div className="divide-y divide-white/[0.04]">
          {FUENTES.map(f => (
            <div key={f.dato} className="px-4 py-2 flex items-start gap-3 flex-wrap">
              <span className="font-sans text-xs text-white w-full sm:w-[260px] shrink-0">{f.dato}</span>
              <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap ${ESTADO[f.estado].cls}`}>{ESTADO[f.estado].label}</span>
              <span className="font-sans text-[11px] text-slate-300 min-w-0 flex-1">
                {f.vive}
                {f.nota && <span className="block text-[10px] font-mono text-muted mt-0.5">{f.nota}</span>}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Por distribuidor */}
      {loading || !v ? <TableSkeleton rows={8} cols={7} /> : (
        <section className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <header className="px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
            <span className="font-sans font-semibold text-sm text-white">By distributor</span>
            <span className="ml-3 font-mono text-[11px] text-muted">click a row to see the serials behind each number</span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['Distributor', 'Devices', 'End customer in a system', 'End customer only in Excel', 'Trail stops at reseller', 'No trace', 'Coverage on record', 'Not matching NetSuite', 'Launchpad ≠ Excel'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {v.distis.map(g => (
                  <RowGroup key={g.disti} g={g} abierto={abiertos.has(g.disti)} onToggle={() => alternar(g.disti)} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
            “End customer in a system” = NetSuite SO/invoice line or Launchpad registration. “Only in Excel” = we know it solely from the distributor’s sell-out report.
            “Trail stops at reseller” = the distributor did sell it (to a named reseller, on a date) but nobody reported who the reseller sold it to — reseller stock, or an unreported sale. “No trace” = not even a reseller.
            “Coverage on record” = a paid plan in NetSuite or a Launchpad registration (standard warranty included); without it, nobody can tell when the device stops being covered.
          </p>
        </section>
      )}

      {/* Suscripciones facturadas que nadie reportó */}
      {v && v.noReportados.length > 0 && (
        <section className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <header className="px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
            <span className="font-sans font-semibold text-sm text-white">Active subscriptions the distributor never reported as sold</span>
            <span className="ml-3 font-mono text-[11px] text-muted">{v.noReportados.length} devices invoiced by NetSuite with a running subscription, absent from the sell-out — still in the distributor’s stock, or a missing report</span>
          </header>
          <div className="divide-y divide-white/[0.04]">
            {v.noRepPor.map(([billed, regs]) => (
              <div key={billed} className="px-4 py-2 flex items-start gap-3 flex-wrap">
                <span className="font-sans text-xs text-white w-[260px] shrink-0 truncate" title={billed}>{billed}</span>
                <span className="font-mono text-[11px] text-slate-300">{regs.length}</span>
                <span className="flex flex-wrap gap-1 min-w-0">
                  {regs.map(r => (
                    <Link key={r.serial} to={`/subscriptions`} title={`invoice ${r.so_number} · ends ${r.end_date}`}
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-300 hover:text-accent">{r.serial}</Link>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-[10px] text-muted font-mono leading-relaxed">
        Universe: every serial in the Channel Ops sell-out Excel (loaded by the pipeline). Each is matched against NetSuite shipments (ns check), NetSuite coverage lines, and Launchpad registrations.
        Nothing here is estimated: when a fact is missing from every system, the page says so. Fixing the red rows means getting the distributor’s reseller/end customer into a system (NetSuite or HubSpot), not a better spreadsheet.
      </p>
    </div>
  );
}

function Celda({ n, total, tono }) {
  return (
    <td className="px-4 py-2.5 font-num whitespace-nowrap">
      <span className={n ? tono : 'text-muted'}>{n || '—'}</span>
      {n > 0 && <span className="text-[10px] font-mono text-muted ml-1">{pct(n, total)}</span>}
    </td>
  );
}

function RowGroup({ g, abierto, onToggle }) {
  const listas = [
    ['Trail stops at the reseller (end customer unknown)', g.regs.filter(r => r.ecSource === 'reseller')],
    ['No trace at all', g.regs.filter(r => !r.ecSource)],
    ['End customer only in the Excel', g.regs.filter(r => r.ecSource === 'sellout')],
    ['No coverage on record', g.regs.filter(r => !r.cobertura)],
    ['Not matching NetSuite', g.regs.filter(r => NS[r.ns_match])],
    ['Launchpad and Excel disagree on the customer', g.regs.filter(r => r.mismatch)],
  ].filter(([, l]) => l.length);
  return (
    <>
      <tr onClick={onToggle} className="border-b border-white/[0.04] hover:bg-white/[0.03] cursor-pointer transition-colors select-none">
        <td className="px-4 py-2.5 font-sans font-medium text-white whitespace-nowrap">
          <span className={`inline-block transition-transform text-[9px] text-muted mr-2 ${abierto ? 'rotate-90' : ''}`}>▶</span>
          {g.disti}
        </td>
        <td className="px-4 py-2.5 font-num text-white">{g.n}</td>
        <Celda n={g.ecSistema} total={g.n} tono="text-success" />
        <Celda n={g.ecSellout} total={g.n} tono="text-accent" />
        <Celda n={g.ecReseller} total={g.n} tono="text-warning" />
        <Celda n={g.ecNinguno} total={g.n} tono="text-danger" />
        <Celda n={g.conCobertura} total={g.n} tono={g.conCobertura * 2 >= g.n ? 'text-success' : 'text-warning'} />
        <Celda n={g.nsMal} total={g.n} tono="text-danger" />
        <Celda n={g.mismatch} total={g.n} tono="text-warning" />
      </tr>
      {abierto && (
        <tr className="border-b border-white/[0.04] bg-white/[0.015]">
          <td colSpan={9} className="px-6 py-3 space-y-3">
            {listas.length === 0 && <p className="text-[11px] font-mono text-success">Everything about this distributor’s devices is on record.</p>}
            {listas.map(([titulo, regs]) => (
              <div key={titulo}>
                <p className="text-[10px] font-mono text-muted uppercase tracking-wider mb-1">{titulo} · {regs.length}</p>
                <div className="flex flex-wrap gap-1.5">
                  {regs.map(r => (
                    <Link key={r.id} to={`/serials?q=${r.serial}`}
                      title={[
                        r.sku ? `SKU ${r.sku}` : null,
                        r.date_sold ? `sold ${r.date_sold}` : null,
                        r.reseller ? `via ${r.reseller}` : null,
                        r.ec ? `end customer ${r.ec} (${r.ecSource})` : r.reseller ? 'end customer unknown — last seen at the reseller' : 'no reseller, no end customer',
                        r.mismatch ? `Launchpad says ${r.lpCustomer} / Excel says ${r.end_customer}` : null,
                        r.ns_match === 'typo' ? `NetSuite has ${r.ns_serial}` : null,
                      ].filter(Boolean).join(' · ')}
                      className="font-mono text-[11px] px-2 py-0.5 rounded bg-white/[0.05] text-slate-300 hover:text-accent hover:bg-white/[0.08] transition-colors">
                      {r.serial}
                      {NS[r.ns_match] && <span className={`ml-1.5 text-[9px] px-1 rounded ${NS[r.ns_match].cls}`}>{NS[r.ns_match].label}</span>}
                      {r.mismatch && <span className="ml-1.5 text-[9px] text-warning">{r.lpCustomer} ≠ {r.end_customer}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}
