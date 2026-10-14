import { useEffect, useMemo, useState } from 'react';
import { ExpiryChart } from '../components/ExpiryChart';
import { Link } from 'react-router-dom';
import { supabase, paginar } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import {
  HOY, DIAS_POR_VENCER, diasHasta, estadoGarantia, ESTADO_LABEL, ESTADO_STYLE,
  nombreCuenta,
} from '../utils/warranty';

// Suscripciones — separadas a propósito de Warranties (garantías):
//
//   · DEVICE: suscripciones PAGAS por equipo, registradas por los resellers en
//     Launchpad cuando el cliente activa el device (export de Retool →
//     SSP_reg*.csv en la carpeta del pipeline → tabla launchpad_subs).
//     Códigos de Launchpad: 2224 = 3 años, 2227 = 2 años, 2228 = 1 año.
//     La fecha de venta la declara el reseller: el reloj corre desde el uso,
//     no desde la factura de RealWear.
//   · SOFTWARE: Device Pro (DEV-PRO-12), que vive en NetSuite como línea de
//     SO y no se registra en Launchpad. Sin seriales: no cubre hardware.
//
// Los registros de garantía estándar (SSP-STANDARD) de Launchpad también se
// cargan en launchpad_subs pero no se listan acá: son garantía, no suscripción.

async function fetchSubs() {
  const traer = async armar => {
    try { return await paginar(armar); } catch { return null; }
  };
  const [lp, sw] = await Promise.all([
    traer(() => supabase.from('launchpad_subs').select('*')
      .order('end_date', { ascending: false })),
    traer(() => supabase.from('warranties').select('*')
      .eq('sku', 'DEV-PRO-12').order('end_date', { ascending: false })),
  ]);
  return { lp: lp ?? [], sw: sw ?? [], falta: lp === null };
}

const FILTROS = {
  vigentes: { label: 'Active', test: e => e === 'active' || e === 'expiring' },
  porvencer: { label: `Expiring ≤${DIAS_POR_VENCER}d`, test: e => e === 'expiring' },
  vencidas: { label: 'Expired', test: e => e === 'expired' },
  todas: { label: 'All', test: () => true },
};

function coincide(r, q) {
  if (!q) return true;
  const t = q.toLowerCase();
  return [r.serial, r.customer, r.customer_email, r.reseller, r.so_number, r.end_customer]
    .some(v => (v ?? '').toLowerCase().includes(t));
}

async function exportarExcel(devices, software) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const ordenadas = [...devices].sort((a, b) =>
    (a.end_date < b.end_date ? -1 : a.end_date > b.end_date ? 1 : (a.customer ?? '').localeCompare(b.customer ?? '') || (a.serial < b.serial ? -1 : 1)));
  const ws1 = XLSX.utils.json_to_sheet(ordenadas.map(r => ({
    'Subscription end': r.end_date,
    'Days left': Math.max(0, diasHasta(r.end_date) ?? 0),
    'End customer': r.customer,
    'Serial': r.serial, 'Device': r.device ?? '',
    'Plan': `${r.plan_years}y (code ${r.plan_code})`,
    'Date of sale': r.date_of_sale,
    'Status': estadoGarantia(r.end_date),
    'Customer email': r.customer_email, 'Workspace': r.customer_workspace,
    'Reseller': r.reseller, 'Registered': r.submitted,
    'Renewed': r.renovado ? 'yes' : '',
  })));
  ws1['!cols'] = [{ wch: 14 }, { wch: 9 }, { wch: 32 }, { wch: 19 }, { wch: 12 },
                  { wch: 15 }, { wch: 12 }, { wch: 9 }, { wch: 30 }, { wch: 18 },
                  { wch: 18 }, { wch: 12 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Device subscriptions');
  const ws2 = XLSX.utils.json_to_sheet(software.map(r => ({
    'SO': r.so_number, 'Customer': nombreCuenta(r.customer),
    'Plan': 'Device Pro · 12 months', 'Start': r.start_date, 'End': r.end_date,
    'Days left': Math.max(0, diasHasta(r.end_date) ?? 0),
    'Status': estadoGarantia(r.end_date),
  })));
  ws2['!cols'] = [{ wch: 11 }, { wch: 38 }, { wch: 22 }, { wch: 12 }, { wch: 12 },
                  { wch: 9 }, { wch: 9 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Software subscriptions');
  XLSX.writeFile(wb, `subscriptions_${HOY()}.xlsx`);
}

function Badge({ end }) {
  const estado = estadoGarantia(end);
  if (estado === 'none') return null;
  const dias = diasHasta(end);
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-mono px-1.5 py-0.5 rounded ${ESTADO_STYLE[estado]}`}>
      {ESTADO_LABEL[estado]}
      <span className="opacity-70">{estado === 'expired' ? end : `${dias}d`}</span>
    </span>
  );
}


export function Subscriptions() {
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState('vigentes');
  const [vista, setVista] = useState('devices');
  const [exportando, setExportando] = useState(false);
  const { data, loading, error, refetch } = useQuery(fetchSubs, []);

  const v = useMemo(() => {
    if (!data) return null;
    // Suscripciones de device = solo los planes PAGOS de Launchpad
    const pagasTodo = data.lp.filter(r => r.plan_code !== 'SSP-STANDARD');
    const porSerial = new Map();
    for (const r of pagasTodo) porSerial.set(r.serial, (porSerial.get(r.serial) ?? 0) + 1);
    for (const r of pagasTodo) r.renovado = porSerial.get(r.serial) > 1;

    const test = FILTROS[filtro].test;
    // Searching keeps context: groups (end date + customer) with a match stay
    // WHOLE — every sibling serial visible — and the matches get highlighted,
    // instead of stripping the serial out of its surroundings.
    const base = pagasTodo.filter(r => test(estadoGarantia(r.end_date)));
    // Searching NEVER removes rows: the whole ledger stays in place, the
    // matches get flagged (yellow) and the table scrolls to the first one.
    const devices = q ? base.map(r => ({ ...r, hit: coincide(r, q) })) : base;
    const baseSw = data.sw.filter(r => test(estadoGarantia(r.end_date)));
    const software = q ? baseSw.map(r => ({ ...r, hit: coincide(r, q) })) : baseSw;

    const vig = pagasTodo.filter(r => estadoGarantia(r.end_date) !== 'expired');
    const kpi = {
      devicesVig: new Set(vig.map(r => r.serial)).size,
      subsVig: vig.length,
      porVencer: vig.filter(r => estadoGarantia(r.end_date) === 'expiring').length,
      clientes: new Set(vig.map(r => (r.customer ?? '').trim()).filter(Boolean)).size,
      swVig: data.sw.filter(r => estadoGarantia(r.end_date) !== 'expired').length,
      estandar: data.lp.length - pagasTodo.length,
    };
    return { devices, software, kpi, pagasTodo };
  }, [data, q, filtro]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  const exportar = async () => {
    if (exportando || !v) return;
    setExportando(true);
    try { await exportarExcel(v.devices, v.software); } finally { setExportando(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Subscriptions</h1>
        <p className="text-xs text-muted font-mono mt-0.5">
          Paid device subscriptions registered in Launchpad, and Device Pro software plans from NetSuite
        </p>
      </div>

      {loading || !v ? <KPISkeleton /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="Devices subscribed" value={v.kpi.devicesVig.toLocaleString()}
            sub={`${v.kpi.subsVig} active subscriptions`} accent />
          <KPICard label="End customers" value={v.kpi.clientes.toLocaleString()}
            sub="with an active subscription" />
          <KPICard label={`Expiring ≤${DIAS_POR_VENCER}d`} value={v.kpi.porVencer.toLocaleString()}
            color={v.kpi.porVencer ? 'text-warning' : undefined}
            sub="renewal window" />
          <KPICard label="Software (Device Pro)" value={v.kpi.swVig.toLocaleString()}
            sub="active · from NetSuite" />
        </div>
      )}

      {v && (
        <ExpiryChart
          filas={vista === 'software' ? data.sw : v.pagasTodo}
          titulo={vista === 'software'
            ? 'Device Pro expirations by month'
            : 'Device subscription expirations by month'} />
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="search"
          placeholder="Serial, end customer, reseller or SO #…"
          value={q}
          onChange={e => setQ(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-full sm:w-80"
        />
        <div className="flex items-center gap-1 flex-wrap">
          {Object.entries(FILTROS).map(([k, f]) => (
            <button key={k} onClick={() => setFiltro(k)}
              className={`px-2.5 py-1.5 rounded text-[11px] font-mono transition-colors ${
                filtro === k ? 'bg-accent/15 text-accent' : 'text-muted hover:text-white'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 sm:ml-auto">
          {[['devices', 'Devices'], ['software', 'Software']].map(([k, label]) => (
            <button key={k} onClick={() => setVista(k)}
              className={`px-2.5 py-1.5 rounded text-[11px] font-mono border transition-colors ${
                vista === k
                  ? 'border-accent/50 text-white'
                  : 'border-white/[0.12] text-muted hover:text-white'}`}>
              {label}
            </button>
          ))}
          <button onClick={exportar} disabled={exportando}
            className="px-3 py-1.5 rounded border border-white/[0.12] text-[11px] font-mono text-slate-300 hover:text-white hover:border-accent/50 disabled:opacity-60 transition-colors whitespace-nowrap">
            {exportando ? 'Exporting…' : 'Export Excel'}
          </button>
        </div>
      </div>

      {data?.falta && (
        <p className="text-xs font-mono text-warning bg-warning/5 border border-warning/20 rounded px-3 py-2">
          Launchpad table not created yet — run SQL_launchpad.sql in Supabase, then one pipeline run.
        </p>
      )}

      {loading || !v ? <TableSkeleton rows={10} cols={7} /> : (
        <>
          {vista === 'devices' && <TablaDevices filas={v.devices} q={q} />}
          {vista === 'software' && <TablaSoftware filas={v.software} />}

          <p className="text-[10px] text-muted font-mono leading-relaxed">
            Device subscriptions come from Launchpad: the reseller registers each serial when
            the customer activates it, and declares the date of sale — so coverage runs from
            first use, not from RealWear’s invoice. Launchpad plan codes: 2224 = 3 years,
            2227 = 2 years, 2228 = 1 year. “Renewed” marks serials registered more than once.
            Standard 1-year warranty registrations ({v.kpi.estandar.toLocaleString()} of them)
            are not listed here — warranty coverage lives in the Warranties tab. Software
            (Device Pro) comes from NetSuite and has no serials because it does not cover hardware.
          </p>
        </>
      )}
    </div>
  );
}

function Panel({ children }) {
  return (
    <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function Encabezados({ cols }) {
  return (
    <thead>
      <tr className="border-b border-white/[0.06]">
        {cols.map(h => (
          <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
        ))}
      </tr>
    </thead>
  );
}

function Vacio({ cols, children }) {
  return (
    <tr><td colSpan={cols} className="px-4 py-8 text-center text-muted font-mono">
      {children}
    </td></tr>
  );
}

// Agrupado como lo lee Supply Chain: la FECHA DE FIN manda, adentro el
// cliente final, y adentro del cliente cada serial con su device. Los grupos
// de clientes arrancan abiertos; el botón los colapsa.
function TablaDevices({ filas, q }) {
  const [cerrados, setCerrados] = useState(() => new Set());
  // Una busqueda nueva reabre todo y desplaza la vista hasta el primer match
  useEffect(() => {
    setCerrados(new Set());
    if (!q) return;
    const timer = setTimeout(() => {
      document.querySelector('[data-hit="true"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => clearTimeout(timer);
  }, [q]);

  const grupos = useMemo(() => {
    const porFecha = new Map();
    for (const r of filas) {
      if (!porFecha.has(r.end_date)) porFecha.set(r.end_date, new Map());
      const porCliente = porFecha.get(r.end_date);
      const k = (r.customer ?? '').trim() || '(no customer recorded)';
      if (!porCliente.has(k)) porCliente.set(k, []);
      porCliente.get(k).push(r);
    }
    return [...porFecha.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([fecha, m]) => ({
        fecha,
        total: [...m.values()].reduce((s, v) => s + v.length, 0),
        clientes: [...m.entries()]
          .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
          .map(([cliente, regs]) => ({ cliente, regs })),
      }));
  }, [filas]);

  const alternar = k => setCerrados(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  if (grupos.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-white/[0.08] px-4 py-8 text-center text-muted font-mono text-xs">
        Nothing matches — or the Launchpad table is still empty
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(q ? grupos : grupos.slice(0, 80)).map(g => {
        const dias = diasHasta(g.fecha);
        const vencido = estadoGarantia(g.fecha) === 'expired';
        return (
          <div key={g.fecha} className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            {/* La fecha de fin es el título del grupo */}
            <div className="flex items-baseline gap-3 px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
              <span className={`font-mono font-semibold text-sm ${
                vencido ? 'text-muted' : dias <= DIAS_POR_VENCER ? 'text-warning' : 'text-white'}`}>
                {g.fecha}
              </span>
              <span className={`font-mono text-[11px] ${
                vencido ? 'text-muted' : dias <= DIAS_POR_VENCER ? 'text-warning' : 'text-slate-400'}`}>
                {vencido ? 'expired' : `in ${dias}d`}
              </span>
              <span className="ml-auto font-mono text-[11px] text-muted">
                {g.total} {g.total === 1 ? 'device' : 'devices'} · {g.clientes.length} {g.clientes.length === 1 ? 'customer' : 'customers'}
              </span>
            </div>
            {g.clientes.map(({ cliente, regs }) => {
              const k = `${g.fecha}|${cliente}`;
              const abierto = !cerrados.has(k);
              const ventas = [...new Set(regs.map(r => r.date_of_sale))].sort();
              const planes = [...new Set(regs.map(r => `${r.plan_years}y`))];
              const resellers = [...new Set(regs.map(r => r.reseller).filter(Boolean))];
              const registros = [...new Set(regs.map(r => r.submitted).filter(Boolean))].sort();
              const emails = [...new Set(regs.map(r => r.customer_email).filter(Boolean))];
              const workspaces = [...new Set(regs.map(r => r.customer_workspace).filter(Boolean))];
              const renovados = regs.filter(r => r.renovado).length;
              const modelos = [...regs.reduce((m, r) => {
                const d = r.device ?? '?';
                m.set(d, (m.get(d) ?? 0) + 1);
                return m;
              }, new Map()).entries()].sort((a, b) => b[1] - a[1])
                .map(([d, n]) => (n > 1 ? `${d} ×${n}` : d));
              return (
                <div key={k} className="border-b border-white/[0.04] last:border-b-0">
                  <button onClick={() => alternar(k)}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-white/[0.03] transition-colors">
                    <span className={`inline-block transition-transform text-[9px] text-muted ${abierto ? 'rotate-90' : ''}`}>▶</span>
                    <span className="font-sans text-white text-xs truncate max-w-[280px]" title={cliente}>{cliente}</span>
                    <span className="font-mono text-[10px] text-muted whitespace-nowrap">
                      {regs.length} {regs.length === 1 ? 'device' : 'devices'} · plan {planes.join('/')}
                      {' · '}
                      <span className="text-slate-300">start {ventas[0]}{ventas.length > 1 ? ` … ${ventas[ventas.length - 1]}` : ''}</span>
                    </span>
                    <span className="font-mono text-[10px] text-muted truncate max-w-[220px] hidden lg:inline"
                      title={modelos.join(', ')}>
                      {modelos.slice(0, 3).join(' · ')}{modelos.length > 3 ? ` +${modelos.length - 3}` : ''}
                    </span>
                    <span className="ml-auto font-sans text-[10px] text-muted truncate max-w-[180px]"
                      title={resellers.join(', ')}>via {resellers.join(', ') || '—'}</span>
                  </button>
                  {abierto && (
                    <p className="px-4 pl-10 pb-1.5 text-[10px] font-mono text-muted truncate"
                      title={`${emails.join(', ')}${workspaces.length ? ` · workspace ${workspaces.join(', ')}` : ''}`}>
                      {emails[0] ?? 'no contact email'}
                      {workspaces.length > 0 && ` · workspace ${workspaces[0]}`}
                      {` · registered ${registros[0] ?? '—'}${registros.length > 1 ? ` … ${registros[registros.length - 1]}` : ''}`}
                      {renovados > 0 && ` · ${renovados} renewed`}
                    </p>
                  )}
                  {abierto && (
                    <div className="flex flex-wrap gap-1.5 px-4 pb-2.5 pl-10">
                      {regs.map(r => (
                        <Link key={r.id} to={`/serials?q=${r.serial}`}
                          data-hit={r.hit ? 'true' : undefined}
                          title={`${r.device ?? 'device unknown'}${r.renovado ? ' · renewed' : ''} · sold ${r.date_of_sale}`}
                          className={`font-mono text-[11px] px-2 py-0.5 rounded transition-colors ${
                            r.hit
                              ? 'bg-warning/25 text-warning ring-1 ring-warning/60 hover:bg-warning/30'
                              : 'bg-white/[0.05] text-slate-300 hover:text-accent hover:bg-white/[0.08]'}`}>
                          {r.serial}
                          <span className="text-muted"> · {r.device ?? '?'}</span>
                          {ventas.length > 1 && <span className="text-muted opacity-70"> · {r.date_of_sale}</span>}
                          {r.renovado && <span className="text-accent/80"> ·R</span>}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {!q && grupos.length > 80 && (
        <p className="text-[10px] text-muted font-mono">
          Showing the first 80 of {grupos.length} end dates — narrow the search or use Export Excel.
        </p>
      )}
    </div>
  );
}

function TablaSoftware({ filas }) {
  return (
    <Panel>
      <table className="w-full text-xs">
        <Encabezados cols={['SO', 'Customer', 'Plan', 'Start', 'Ends', 'Status']} />
        <tbody>
          {filas.length === 0 ? <Vacio cols={6}>Nothing matches</Vacio> : filas.map((r, i) => {
            const dias = diasHasta(r.end_date);
            const vencido = estadoGarantia(r.end_date) === 'expired';
            return (
              <tr key={`${r.so_number}-${i}`} data-hit={r.hit ? 'true' : undefined}
                className={`border-b border-white/[0.04] transition-colors ${
                  r.hit ? 'bg-warning/10' : 'hover:bg-white/[0.03]'}`}>
                <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                  <Link to={`/backlog?so=${r.so_number}`} className="text-accent hover:text-accent/80">
                    {r.so_number}
                  </Link>
                </td>
                <td className="px-4 py-2.5 font-sans text-white max-w-[300px] truncate"
                  title={r.customer}>{nombreCuenta(r.customer)}</td>
                <td className="px-4 py-2.5 font-mono text-muted whitespace-nowrap">
                  DEV-PRO-12 <span className="opacity-60">· Device Pro, 12 months</span>
                </td>
                <td className="px-4 py-2.5 font-mono text-slate-300 whitespace-nowrap">{r.start_date}</td>
                <td className={`px-4 py-2.5 font-mono whitespace-nowrap ${
                  vencido ? 'text-muted' : dias <= DIAS_POR_VENCER ? 'text-warning' : 'text-slate-300'}`}>
                  {r.end_date}
                </td>
                <td className="px-4 py-2.5"><Badge end={r.end_date} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
