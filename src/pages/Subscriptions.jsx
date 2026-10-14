import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExpiryChart } from '../components/ExpiryChart';
import { supabase, paginar } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import {
  HOY, DIAS_POR_VENCER, diasHasta, estadoGarantia, ESTADO_LABEL, ESTADO_STYLE,
  nombreCuenta,
} from '../utils/warranty';
import { fetchSelloutMap, selloutDe, SELLOUT_LABEL, SELLOUT_TITLE } from '../utils/sellout';
import {
  segLabel, normSerial, seguimientoDe, resumenSeguimiento, guardarSeguimiento,
  descargarCSV, SeguimientoPill, SeguimientoFiltro, SeguimientoEditor,
} from '../components/FollowUp';

// Subscriptions = herramienta de SEGUIMIENTO de renovaciones de suscripciones
// pagas de device (y Device Pro, software). La unidad de trabajo es el
// CONTRATO: los equipos de un mismo contacto que vencen el mismo día. Es lo que
// se llama, se cotiza, se renueva, y lo que se exporta a HubSpot como un deal.
//
// Fuentes de cada serial (se fusionan por serial; gana la fecha de fin más
// tardía):
//   1. Launchpad (launchpad_subs, planes pagos 2224/2227/2228): el reseller
//      registra el equipo; trae end customer, emails y workspace.
//   2. Facturas sueltas de NetSuite con fechas de cobertura en la línea
//      (warranties.start_source = 'invoice' + warranty_serials).
//   3. Relleno: sell-out del distribuidor (sellout_devices) cuando 1 y 2 no
//      dicen quién usa el equipo — marcado "per sell-out".
// Seguimiento: tabla subscription_followup (una fila por serial con estado,
// nota, quién y cuándo). Vale solo para la fecha de fin con la que se marcó:
// cuando entra la renovación (nueva fecha), el contrato nuevo arranca "Not
// contacted" solo.

async function fetchSubs() {
  const traer = async armar => {
    try { return await paginar(armar); } catch { return null; }
  };
  const [lp, sw, inv, sellout, fu] = await Promise.all([
    traer(() => supabase.from('launchpad_subs').select('*')
      .order('end_date', { ascending: false })),
    traer(() => supabase.from('warranties').select('*')
      .eq('sku', 'DEV-PRO-12').order('end_date', { ascending: false })),
    traer(() => supabase.from('warranties').select('*')
      .eq('start_source', 'invoice').order('end_date', { ascending: false })),
    fetchSelloutMap(),
    traer(() => supabase.from('subscription_followup').select('*')),
  ]);
  let invSer = [];
  const facturas = [...new Set((inv ?? []).map(w => w.so_number).filter(Boolean))];
  if (facturas.length) {
    invSer = (await traer(() => supabase.from('warranty_serials').select('*')
      .in('so_number', facturas))) ?? [];
  }

  // Distribuidor de cada device de Launchpad: a quién le facturó RealWear ese
  // serial (serial_shipments.cliente). Lotes de 100 (el IN va en la URL).
  const seriales = [...new Set((lp ?? [])
    .filter(r => r.plan_code !== 'SSP-STANDARD')
    .map(r => r.serial).filter(Boolean))];
  const envios = {};
  const lotes = [];
  for (let i = 0; i < seriales.length; i += 100) lotes.push(seriales.slice(i, i + 100));
  const eventos = await Promise.all(lotes.map(lote =>
    traer(() => supabase.from('serial_shipments')
      .select('serial, cliente, so_number, fecha, doc_type')
      .in('serial', lote))));
  for (const ev of eventos.flat()) {
    if (!ev?.cliente) continue;
    const prev = envios[ev.serial];
    const mejor = !prev
      || ev.fecha > prev.fecha
      || (ev.fecha === prev.fecha && ev.doc_type === 'ItemShip' && prev.doc_type !== 'ItemShip');
    if (mejor) envios[ev.serial] = ev;
  }

  return {
    lp: lp ?? [], sw: sw ?? [], inv: inv ?? [], invSer, envios, sellout,
    fu: fu ?? [], fuFalta: fu === null, falta: lp === null,
  };
}

// Fila de factura -> misma forma que una fila de Launchpad.
function filaDesdeFactura(s, planPorFactura) {
  const w = planPorFactura.get(s.so_number) ?? {};
  const m = /^(\d{6}\S*)/.exec(s.sku ?? '');
  return {
    id: `inv-${s.serial}-${s.so_number}`,
    serial: s.serial, plan_code: s.sku, plan: 'Paid device subscription',
    plan_years: w.plan_years ?? null,
    date_of_sale: s.start_date, end_date: s.end_date,
    customer: (s.end_customer ?? '').trim(),
    customer_email: '', customer_workspace: '',
    reseller: '', reseller_email: '',
    distributor: nombreCuenta(s.customer), original_customer: null,
    submitted: w.so_date ?? s.start_date, roi_kit: null,
    device: m ? m[1] : null, so_number: s.so_number,
    sources: ['invoice'],
  };
}

const norm = normSerial;
const mismo = (a, b) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
const uniq = xs => [...new Set(xs.filter(Boolean))];

// Momento del contrato según su fecha de fin.
function estadoContrato(end) {
  const d = diasHasta(end);
  if (d == null) return 'old';
  if (d > DIAS_POR_VENCER) return 'active';
  if (d > 0) return 'renew';
  if (d > -DIAS_POR_VENCER) return 'lapsed';
  return 'old';
}
const ESTADO_C = {
  renew: { label: 'Renewal window', cls: 'text-warning' },
  active: { label: 'Active', cls: 'text-white' },
  lapsed: { label: 'Lapsed', cls: 'text-danger' },
  old: { label: 'Expired', cls: 'text-muted' },
};

const VISTAS = {
  renew: { label: `To renew ≤${DIAS_POR_VENCER}d`, test: e => e === 'renew' },
  active: { label: 'All active', test: e => e === 'renew' || e === 'active' },
  lapsed: { label: `Lapsed ≤${DIAS_POR_VENCER}d`, test: e => e === 'lapsed' },
  all: { label: 'All', test: () => true },
};

// Nombre del contrato = a quién llamar: end customer; si no hay, reseller;
// si no, distributor.
export function nombreGrupo(r) {
  const c = (r.customer ?? '').trim();
  if (c) return c;
  const res = (r.reseller ?? '').trim();
  if (res && res.toLowerCase() !== 'admin') return res;
  const d = (r.distributor ?? '').trim();
  if (d && d !== 'unknown') return d;
  return 'contact not recorded';
}

function armarContrato(c) {
  const regs = c.regs;
  const r0 = regs[0];
  const resellerOk = x => x && x.toLowerCase() !== 'admin';
  const rol = (r0.customer ?? '').trim() ? 'end customer'
    : resellerOk((r0.reseller ?? '').trim()) ? 'reseller'
    : (r0.distributor && r0.distributor !== 'unknown') ? 'distributor' : null;
  const deSellout = rol === 'end customer' ? regs.some(r => r.customer_source === 'sellout')
    : rol === 'reseller' ? regs.some(r => r.reseller_source === 'sellout') : false;
  const modelos = [...regs.reduce((m, r) => {
    const d = r.device ?? '?';
    m.set(d, (m.get(d) ?? 0) + 1);
    return m;
  }, new Map()).entries()].sort((a, b) => b[1] - a[1])
    .map(([d, n]) => (n > 1 ? `${d} ×${n}` : d));
  const serials = uniq(regs.map(r => r.serial)).sort();
  return {
    ...c,
    id: `SUB-${c.end_date}-${serials[0] ?? 'x'}`,
    estado: estadoContrato(c.end_date),
    dias: diasHasta(c.end_date),
    rol, deSellout,
    endCustomer: rol === 'end customer' ? c.nombre : '',
    resellers: uniq(regs.map(r => r.reseller)).filter(resellerOk),
    distribuidores: uniq(regs.map(r => r.distributor)).filter(d => d !== 'unknown' && d !== '—'),
    originales: uniq(regs.map(r => r.original_customer)),
    fuentes: uniq(regs.flatMap(r => r.sources ?? ['launchpad'])),
    sos: uniq(regs.map(r => r.so_number)).sort(),
    emails: uniq(regs.map(r => r.customer_email)),
    resellerEmails: uniq(regs.map(r => r.reseller_email)),
    workspaces: uniq(regs.map(r => r.customer_workspace)),
    registros: uniq(regs.map(r => r.submitted)).sort(),
    ventas: uniq(regs.map(r => r.date_of_sale)).sort(),
    planes: uniq(regs.map(r => (r.plan_years ? `${r.plan_years}y` : null))),
    modelos, serials,
    devices: serials.length,
    renovados: regs.filter(r => r.renovado).length,
    noReportados: regs.filter(r => r.noReportado).length,
    mismatches: regs.filter(r => r.mismatch),
    ...resumenSeguimiento(regs),
  };
}

// Qué le falta a un contrato, en palabras (para la pantalla y los exports).
function banderas(c) {
  const out = [];
  if (c.rol !== 'end customer') out.push('end customer unknown');
  if (c.deSellout) out.push(`${c.rol} name taken from the distributor sell-out report`);
  if (c.noReportados) out.push(`${c.noReportados} device(s) not reported sold by the distributor`);
  for (const r of c.mismatches) out.push(`${r.serial}: Launchpad "${r.customer}" vs sell-out "${r.sellout?.end_customer}"`);
  return out;
}

function coincide(r, q) {
  const t = q.toLowerCase();
  return [r.serial, r.customer, r.customer_email, r.reseller, r.reseller_email, r.distributor,
          r.so_number, r.plan_code, r.device]
    .some(v => (v ?? '').toLowerCase().includes(t));
}

// ── Exports ─────────────────────────────────────────────────────────────────
// Una fila por contrato = un deal de renovación en HubSpot. Encabezados en
// palabras: al importar en HubSpot se mapean a mano (Deal name, Close date,
// Pipeline; End customer → end_customer, Distributor → distributor__synced_test,
// Reseller → reseller__synced_test).
function filaContrato(c) {
  return {
    'Deal name': `Renewal – ${c.nombre} – ${c.devices} device${c.devices === 1 ? '' : 's'} – ends ${c.end_date}`,
    'Pipeline': 'Sales Pipeline',
    'Close date': c.end_date,
    'Amount': '',
    'Follow-up status': segLabel(c.seguimiento),
    'Follow-up note': c.nota,
    'Contact (who to call)': c.nombre,
    'Contact role': c.rol ?? 'unknown',
    'End customer': c.endCustomer,
    'End customer source': c.rol === 'end customer' ? (c.deSellout ? 'distributor sell-out report' : 'Launchpad / NetSuite') : '',
    'Reseller': c.resellers.join('; '),
    'Distributor': c.distribuidores.join('; '),
    'Customer email': c.emails.join('; '),
    'Reseller email': c.resellerEmails.join('; '),
    'Devices': c.devices,
    'Device models': c.modelos.join('; '),
    'Plan': c.planes.join('/'),
    'Start date': c.ventas[0] ?? '',
    'End date': c.end_date,
    'Days left': c.dias,
    'Status': ESTADO_C[c.estado].label,
    'Source': c.fuentes.map(f => (f === 'invoice' ? 'NetSuite invoice' : 'Launchpad')).join(' + '),
    'NetSuite SO / invoice': c.sos.join('; '),
    'Serial numbers': c.serials.join('; '),
    'Data gaps': banderas(c).join('; '),
    'Contract ID': c.id,
  };
}

async function exportarExcel(contratos, software) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const ws0 = XLSX.utils.aoa_to_sheet([
    ['RealWear subscriptions — export of ' + HOY()],
    [],
    ['Contracts', 'One row per contract = the devices of one contact that end on the same day. One renewal deal each (same columns as the HubSpot CSV).'],
    ['Devices', 'One row per serial, with its contract ID.'],
    ['Software', 'Device Pro (DEV-PRO-12) from NetSuite; no serials.'],
    [],
    ['Contact (who to call)', 'End customer if known; otherwise the reseller; otherwise the distributor RealWear invoiced. "Contact role" says which.'],
    ['End customer source', '"Launchpad / NetSuite" = registered in a system. "distributor sell-out report" = only known from the Channel Ops sell-out Excel.'],
    ['Source', 'Launchpad = registered by the reseller. NetSuite invoice = sold as a subscription SKU with coverage dates on the invoice line, never registered in Launchpad.'],
    ['Status', `Renewal window = ends within ${DIAS_POR_VENCER} days. Lapsed = ended in the last ${DIAS_POR_VENCER} days. Expired = earlier.`],
    ['Follow-up status', 'Set by the team on the site: Not contacted / Contacted / Quote sent / Renewed / Lost.'],
    ['Data gaps', 'What is missing or inconsistent for that contract (unknown end customer, devices the distributor has not reported as sold, customer name mismatch).'],
  ]);
  ws0['!cols'] = [{ wch: 22 }, { wch: 120 }];
  XLSX.utils.book_append_sheet(wb, ws0, 'Read me');

  const ws1 = XLSX.utils.json_to_sheet(contratos.map(filaContrato));
  ws1['!cols'] = [{ wch: 50 }, { wch: 14 }, { wch: 11 }, { wch: 8 }, { wch: 14 }, { wch: 30 }, { wch: 30 },
                  { wch: 13 }, { wch: 28 }, { wch: 22 }, { wch: 24 }, { wch: 24 }, { wch: 28 }, { wch: 28 },
                  { wch: 7 }, { wch: 22 }, { wch: 6 }, { wch: 11 }, { wch: 11 }, { wch: 8 }, { wch: 14 },
                  { wch: 18 }, { wch: 16 }, { wch: 40 }, { wch: 40 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Contracts');

  const ws2 = XLSX.utils.json_to_sheet(contratos.flatMap(c => c.regs.map(r => ({
    'Contract ID': c.id,
    'Serial': r.serial, 'Device': r.device ?? '',
    'Contact (who to call)': c.nombre, 'Contact role': c.rol ?? 'unknown',
    'End customer': r.customer ?? '',
    'End customer source': r.customer ? (r.customer_source === 'sellout' ? 'distributor sell-out report' : 'Launchpad / NetSuite') : '',
    'Reseller': r.reseller ?? '', 'Distributor': r.distributor ?? '',
    'Customer email': r.customer_email ?? '', 'Reseller email': r.reseller_email ?? '',
    'Plan': r.plan_years ? `${r.plan_years}y` : '', 'Plan code': r.plan_code ?? '',
    'Start date': r.date_of_sale ?? '', 'End date': r.end_date,
    'Days left': diasHasta(r.end_date), 'Status': ESTADO_C[estadoContrato(r.end_date)].label,
    'Follow-up status': segLabel(r.fu?.status ?? 'open'),
    'Source': (r.sources ?? ['launchpad']).map(s => (s === 'invoice' ? 'NetSuite invoice' : 'Launchpad')).join(' + '),
    'NetSuite SO / invoice': r.so_number ?? '',
    'Renewed before': r.renovado ? 'yes' : '',
    'Not reported sold by distributor': r.noReportado ? 'yes' : '',
    'Sell-out end customer': r.sellout?.end_customer ?? '',
    'Sell-out reseller': r.sellout?.reseller ?? '',
    'Sell-out date sold': r.sellout?.date_sold ?? '',
  }))));
  ws2['!cols'] = [{ wch: 30 }, { wch: 19 }, { wch: 10 }, { wch: 30 }, { wch: 13 }, { wch: 28 }, { wch: 22 },
                  { wch: 24 }, { wch: 24 }, { wch: 28 }, { wch: 28 }, { wch: 6 }, { wch: 14 }, { wch: 11 },
                  { wch: 11 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 9 },
                  { wch: 12 }, { wch: 28 }, { wch: 24 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Devices');

  const ws3 = software.length === 0
    ? XLSX.utils.aoa_to_sheet([['No Device Pro plans in this view']])
    : XLSX.utils.json_to_sheet(software.map(r => ({
    'SO': r.so_number, 'Customer': nombreCuenta(r.customer),
    'Plan': 'Device Pro · 12 months', 'Start': r.start_date, 'End': r.end_date,
    'Days left': diasHasta(r.end_date),
    'Status': estadoGarantia(r.end_date),
  })));
  ws3['!cols'] = [{ wch: 11 }, { wch: 38 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 9 }, { wch: 9 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Software');

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

// ── Página ──────────────────────────────────────────────────────────────────
export function Subscriptions() {
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState('renew');
  const [seg, setSeg] = useState('any');
  const [vista, setVista] = useState('devices');
  const [exportando, setExportando] = useState(false);
  // Seguimientos guardados en esta sesión (para no recargar todo al guardar)
  const [fuLocal, setFuLocal] = useState(() => new Map());
  const { data, loading, error, refetch } = useQuery(fetchSubs, []);

  const v = useMemo(() => {
    if (!data) return null;
    // 1) Una fila por serial y fecha de fin: Launchpad pagas + facturas.
    const lpPagas = data.lp.filter(r => r.plan_code !== 'SSP-STANDARD')
      .map(r => {
        const env = data.envios?.[r.serial];
        return {
          ...r,
          sources: ['launchpad'],
          distributor: r.distributor || (env ? nombreCuenta(env.cliente) : null),
          so_number: r.so_number || env?.so_number || null,
        };
      });
    const planPorFactura = new Map(data.inv.map(w => [w.so_number, w]));
    const deFactura = data.invSer.map(s => filaDesdeFactura(s, planPorFactura));
    const porSerialFact = new Map(deFactura.map(r => [r.serial, r]));
    const filas = [];
    const vistos = new Set();
    for (const r of lpPagas) {
      const f = porSerialFact.get(r.serial);
      if (f) {
        vistos.add(r.serial);
        const gana = f.end_date > r.end_date ? f : r;
        filas.push({
          ...gana,
          customer: r.customer || f.customer,
          customer_email: r.customer_email, customer_workspace: r.customer_workspace,
          reseller: r.reseller, reseller_email: r.reseller_email,
          distributor: r.distributor || f.distributor,
          device: r.device || f.device,
          so_number: r.so_number || f.so_number,
          id: r.id, sources: ['launchpad', 'invoice'],
        });
      } else {
        filas.push(r);
      }
    }
    for (const f of deFactura) if (!vistos.has(f.serial)) filas.push(f);

    // 2) Relleno con el sell-out, banderas y seguimiento por serial.
    const fuPor = new Map(data.fu.map(f => [norm(f.serial), f]));
    for (const [k, f] of fuLocal) fuPor.set(k, f);
    let rellenados = 0;
    for (const r of filas) {
      const so = selloutDe(data.sellout, r.serial);
      r.sellout = so;
      if (so) {
        if (!(r.customer ?? '').trim() && so.end_customer) {
          r.customer = so.end_customer; r.customer_source = 'sellout'; rellenados += 1;
        }
        if (!(r.reseller ?? '').trim() && so.reseller) {
          r.reseller = so.reseller; r.reseller_source = 'sellout';
        }
        if (!r.distributor && so.distributor) r.distributor = so.distributor;
      }
      const e = estadoContrato(r.end_date);
      // Facturado como suscripción, el plazo corre, y el disti no lo reportó vendido
      r.noReportado = (r.sources ?? []).includes('invoice') && !so && (e === 'renew' || e === 'active');
      r.mismatch = Boolean(so?.end_customer && r.customer && r.customer_source !== 'sellout'
        && !mismo(so.end_customer, r.customer));
      r.fu = seguimientoDe(fuPor, r.serial, r.end_date);
    }
    const veces = new Map();
    for (const r of filas) veces.set(r.serial, (veces.get(r.serial) ?? 0) + 1);
    for (const r of filas) r.renovado = veces.get(r.serial) > 1;

    // 3) Contratos: mismo contacto + misma fecha de fin.
    const porClave = new Map();
    for (const r of filas) {
      const nombre = nombreGrupo(r);
      const key = `${r.end_date}|${nombre}`;
      if (!porClave.has(key)) porClave.set(key, { key, end_date: r.end_date, nombre, regs: [] });
      porClave.get(key).regs.push(r);
    }
    const contratos = [...porClave.values()].map(armarContrato)
      .sort((a, b) => (a.end_date < b.end_date ? -1 : a.end_date > b.end_date ? 1 : b.devices - a.devices));

    // 4) Vista: momento (fecha) + estado de seguimiento. Buscar NUNCA filtra:
    //    marca los matches y la tabla abre su contrato y scrollea.
    const testFecha = VISTAS[filtro].test;
    const enFecha = contratos.filter(c => testFecha(c.estado));
    const base = enFecha.filter(c => seg === 'any' || c.seguimiento === seg);
    const enVista = q
      ? base.map(c => {
        const regs = c.regs.map(r => ({ ...r, hit: coincide(r, q) }));
        return { ...c, regs, hit: regs.some(r => r.hit) || c.nombre.toLowerCase().includes(q.toLowerCase()) };
      })
      : base;
    const enVistaKeys = new Set(base.map(c => c.key));
    const fuera = q
      ? contratos.filter(c => !enVistaKeys.has(c.key)
        && (c.regs.some(r => coincide(r, q)) || c.nombre.toLowerCase().includes(q.toLowerCase()))).length
      : 0;

    const conteoFecha = Object.fromEntries(Object.entries(VISTAS)
      .map(([k, f]) => [k, contratos.filter(c => f.test(c.estado)).length]));
    const conteoSeg = { any: enFecha.length };
    for (const c of enFecha) conteoSeg[c.seguimiento] = (conteoSeg[c.seguimiento] ?? 0) + 1;

    // KPIs: siempre sobre el total (no sobre la vista).
    const act = contratos.filter(c => c.estado === 'renew' || c.estado === 'active');
    const ren = contratos.filter(c => c.estado === 'renew');
    const lap = contratos.filter(c => c.estado === 'lapsed');
    const devs = cs => cs.reduce((s, c) => s + c.devices, 0);
    const kpi = {
      devicesAct: new Set(act.flatMap(c => c.serials)).size,
      contratosAct: act.length,
      clientesAct: new Set(act.filter(c => c.rol === 'end customer').map(c => c.nombre.toLowerCase())).size,
      renew: ren.length, renewDev: devs(ren),
      renewOpen: ren.filter(c => c.seguimiento === 'open').length,
      lapsed: lap.length, lapsedDev: devs(lap),
      lapsedOpen: lap.filter(c => c.seguimiento !== 'renewed' && c.seguimiento !== 'lost').length,
      sinEC: act.filter(c => c.rol !== 'end customer').length,
      conGaps: act.filter(c => c.rol !== 'end customer' || c.noReportados || c.mismatches.length).length,
      noRep: act.reduce((s, c) => s + c.noReportados, 0),
      mismatch: act.reduce((s, c) => s + c.mismatches.length, 0),
      rellenados,
      swVig: data.sw.filter(r => estadoGarantia(r.end_date) !== 'expired').length,
      estandar: data.lp.filter(r => r.plan_code === 'SSP-STANDARD').length,
    };
    const software = data.sw.filter(r => {
      const e = estadoContrato(r.end_date);
      return testFecha(e);
    });
    return { filas, contratos, enVista, base, fuera, conteoFecha, conteoSeg, kpi, software };
  }, [data, q, filtro, seg, fuLocal]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  const guardar = async (c, estado, nota) => {
    const filas = await guardarSeguimiento('subscription_followup', c.regs, estado, nota);
    setFuLocal(prev => {
      const n = new Map(prev);
      for (const f of filas) n.set(norm(f.serial), f);
      return n;
    });
  };

  const exportarXlsx = async () => {
    if (exportando || !v) return;
    setExportando(true);
    try { await exportarExcel(v.base, v.software); } finally { setExportando(false); }
  };
  const exportarHubspot = () => {
    if (!v) return;
    descargarCSV(v.base.map(filaContrato), `subscriptions_hubspot_${filtro}_${HOY()}.csv`);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Subscriptions</h1>
        <p className="text-xs text-muted font-mono mt-0.5">
          Renewal tracker for paid device subscriptions (Launchpad + NetSuite invoices) and Device Pro.
          One row = one contract: the devices of one contact that end on the same day.
        </p>
      </div>

      {loading || !v ? <KPISkeleton /> : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <KPICard label="Active subscriptions" value={v.kpi.devicesAct.toLocaleString()}
            sub={`devices · ${v.kpi.contratosAct} contracts · ${v.kpi.clientesAct} end customers`} accent />
          <KPICard label={`To renew ≤${DIAS_POR_VENCER}d`} value={v.kpi.renew.toLocaleString()}
            color={v.kpi.renew ? 'text-warning' : undefined}
            sub={`contracts · ${v.kpi.renewDev} devices · ${v.kpi.renewOpen} not contacted yet`} />
          <KPICard label={`Lapsed ≤${DIAS_POR_VENCER}d`} value={v.kpi.lapsed.toLocaleString()}
            color={v.kpi.lapsedOpen ? 'text-danger' : undefined}
            sub={`contracts · ${v.kpi.lapsedDev} devices · ${v.kpi.lapsedOpen} not marked renewed or lost`} />
          <KPICard label="Active contracts with data gaps" value={v.kpi.conGaps.toLocaleString()}
            color={v.kpi.conGaps ? 'text-warning' : undefined}
            sub={`${v.kpi.sinEC} without end customer · ${v.kpi.noRep} devices not reported sold · ${v.kpi.mismatch} customer name mismatches`} />
          <KPICard label="Software (Device Pro)" value={v.kpi.swVig.toLocaleString()}
            sub="active · from NetSuite" />
        </div>
      )}

      {v && (
        <ExpiryChart
          filas={vista === 'software' ? data.sw : v.filas}
          titulo={vista === 'software' ? 'Device Pro expirations by month' : 'Device subscription expirations by month'} />
      )}

      {/* Barra: qué momento (fecha), qué estado de seguimiento, buscar, exportar */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {Object.entries(VISTAS).map(([k, f]) => (
              <button key={k} onClick={() => setFiltro(k)}
                className={`px-2.5 py-1.5 rounded text-[11px] font-mono transition-colors ${
                  filtro === k ? 'bg-accent/15 text-accent' : 'text-muted hover:text-white'}`}>
                {f.label}{v ? <span className="opacity-60"> · {v.conteoFecha[k]}</span> : null}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 sm:ml-auto">
            {[['devices', 'Devices'], ['software', 'Software']].map(([k, label]) => (
              <button key={k} onClick={() => setVista(k)}
                className={`px-2.5 py-1.5 rounded text-[11px] font-mono border transition-colors ${
                  vista === k ? 'border-accent/50 text-white' : 'border-white/[0.12] text-muted hover:text-white'}`}>
                {label}
              </button>
            ))}
            <button onClick={exportarXlsx} disabled={exportando || !v}
              title="Excel with Read me, Contracts, Devices and Software sheets — for the current view"
              className="px-3 py-1.5 rounded border border-white/[0.12] text-[11px] font-mono text-slate-300 hover:text-white hover:border-accent/50 disabled:opacity-60 transition-colors whitespace-nowrap">
              {exportando ? 'Exporting…' : 'Export Excel'}
            </button>
            <button onClick={exportarHubspot} disabled={!v || vista !== 'devices'}
              title="CSV with one row per contract (one renewal deal each), ready to import into HubSpot as Deals — for the current view"
              className="px-3 py-1.5 rounded border border-accent/40 text-[11px] font-mono text-accent hover:bg-accent/10 disabled:opacity-40 transition-colors whitespace-nowrap">
              Export for HubSpot{v && vista === 'devices' ? ` (${v.base.length})` : ''}
            </button>
          </div>
        </div>
        {vista === 'devices' && (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="search"
              placeholder="Serial, customer, reseller, distributor, email or SO #…"
              value={q}
              onChange={e => setQ(e.target.value)}
              className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-full sm:w-80"
            />
            <SeguimientoFiltro seg={seg} setSeg={setSeg} conteo={v?.conteoSeg} />
            {q && v?.fuera > 0 && (
              <button onClick={() => { setFiltro('all'); setSeg('any'); }}
                className="text-[10px] font-mono text-warning underline underline-offset-2">
                {v.fuera} more match{v.fuera === 1 ? '' : 'es'} outside this view — show all
              </button>
            )}
          </div>
        )}
      </div>

      {data?.falta && (
        <p className="text-xs font-mono text-warning bg-warning/5 border border-warning/20 rounded px-3 py-2">
          Launchpad table not created yet — run SQL_launchpad.sql in Supabase, then one pipeline run.
        </p>
      )}
      {data?.fuFalta && (
        <p className="text-xs font-mono text-warning bg-warning/5 border border-warning/20 rounded px-3 py-2">
          Follow-up can’t be saved yet: the subscription_followup table doesn’t exist (SQL_subscription_followup.sql).
        </p>
      )}

      {loading || !v ? <TableSkeleton rows={10} cols={7} /> : (
        <>
          {vista === 'devices' && (
            <TablaContratos contratos={v.enVista} q={q} onGuardar={guardar} sinTabla={data.fuFalta} filtro={filtro} />
          )}
          {vista === 'software' && <TablaSoftware filas={v.software} />}

          <div className="text-[10px] text-muted font-mono leading-relaxed space-y-1.5">
            <p className="text-slate-300">How to use it</p>
            <p>1 · Work the “To renew” list: the big name is who to call (badge says if it’s the end customer, the reseller or the distributor). Open the contract, set Follow-up (Contacted → Quote sent → Renewed / Lost) and leave a note. Everyone sees it.</p>
            <p>2 · When the renewal arrives (new Launchpad registration or invoice), the contract moves to its new end date and starts again as “Not contacted” — the old status stays with the old period.</p>
            <p>3 · “Export for HubSpot” = one row per contract (one renewal deal), close date = end date. “Export Excel” = same contracts plus one row per device and Device Pro. Both export the current view.</p>
            <p className="pt-1">
              Sources: Launchpad (reseller registers each serial; plan codes 2224 = 3y, 2227 = 2y, 2228 = 1y) and NetSuite invoices with coverage dates on the line (devices sold as a subscription SKU, never registered in Launchpad).
              When neither names the end customer, the distributor’s sell-out report fills it in, marked “{SELLOUT_LABEL}”.
              “Not reported sold” = invoiced as a subscription, running, but the distributor hasn’t reported selling it (still in its stock, or a missing report).
              Standard 1-year warranties ({v.kpi.estandar.toLocaleString()} Launchpad registrations) are in Warranties, not here.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tabla de contratos: fecha de fin → contrato → seriales ───────────────────
function TablaContratos({ contratos, q, onGuardar, sinTabla, filtro }) {
  // Todo arranca COLAPSADO. Una búsqueda abre solo los contratos con match y
  // scrollea al primero.
  const [abiertos, setAbiertos] = useState(() => new Set());
  // Depende de QUÉ contratos matchean (no del array): guardar un seguimiento
  // recalcula los contratos y no tiene que cerrar lo que el usuario abrió.
  const hits = contratos.filter(c => c.hit).map(c => c.key).join('\n');
  useEffect(() => {
    if (!q) { setAbiertos(new Set()); return; }
    setAbiertos(new Set(hits.split('\n').filter(Boolean)));
    const timer = setTimeout(() => {
      document.querySelector('[data-hit="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => clearTimeout(timer);
  }, [q, hits]);

  const grupos = useMemo(() => {
    const porFecha = new Map();
    for (const c of contratos) {
      if (!porFecha.has(c.end_date)) porFecha.set(c.end_date, []);
      porFecha.get(c.end_date).push(c);
    }
    const lista = [...porFecha.entries()].map(([fecha, cs]) => ({
      fecha, cs, total: cs.reduce((s, c) => s + c.devices, 0),
    }));
    // Lo vencido se lee del más reciente al más viejo; lo vigente, al revés.
    return lista.sort((a, b) => (filtro === 'lapsed'
      ? (a.fecha < b.fecha ? 1 : -1)
      : (a.fecha < b.fecha ? -1 : 1)));
  }, [contratos, filtro]);

  const alternar = k => setAbiertos(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  if (grupos.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-white/[0.08] px-4 py-8 text-center text-muted font-mono text-xs">
        Nothing in this view
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-1">
        <button onClick={() => setAbiertos(new Set(contratos.map(c => c.key)))}
          className="px-2.5 py-1 rounded border border-white/[0.12] text-[10px] font-mono text-muted hover:text-white hover:border-accent/50 transition-colors">
          Expand all
        </button>
        <button onClick={() => setAbiertos(new Set())}
          className="px-2.5 py-1 rounded border border-white/[0.12] text-[10px] font-mono text-muted hover:text-white hover:border-accent/50 transition-colors">
          Collapse all
        </button>
      </div>
      {(q ? grupos : grupos.slice(0, 80)).map(g => {
        const est = estadoContrato(g.fecha);
        const dias = diasHasta(g.fecha);
        return (
          <div key={g.fecha} className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <div className="flex items-baseline gap-3 px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
              <span className={`font-mono font-semibold text-sm ${ESTADO_C[est].cls}`}>{g.fecha}</span>
              <span className={`font-mono text-[11px] ${ESTADO_C[est].cls} opacity-80`}>
                {dias > 0 ? `in ${dias}d` : dias === 0 ? 'today' : `${-dias}d ago`}
              </span>
              <span className="ml-auto font-mono text-[11px] text-muted">
                {g.total} {g.total === 1 ? 'device' : 'devices'} · {g.cs.length} {g.cs.length === 1 ? 'contract' : 'contracts'}
              </span>
            </div>
            {g.cs.map(c => (
              <FilaContrato key={c.key} c={c} abierto={abiertos.has(c.key)} onToggle={() => alternar(c.key)}
                onGuardar={onGuardar} sinTabla={sinTabla} />
            ))}
          </div>
        );
      })}
      {!q && grupos.length > 80 && (
        <p className="text-[10px] text-muted font-mono">
          Showing the first 80 of {grupos.length} end dates — narrow the view or use Export Excel.
        </p>
      )}
    </div>
  );
}

const ROL_STYLE = {
  'end customer': 'bg-success/15 text-success',
  reseller: 'bg-warning/15 text-warning',
  distributor: 'bg-warning/15 text-warning',
};
const ROL_TITLE = {
  'end customer': 'End customer registered in Launchpad / NetSuite',
  reseller: 'No end customer recorded: the reseller is the contact',
  distributor: 'No end customer recorded: the distributor RealWear invoiced is the contact',
};

function FilaContrato({ c, abierto, onToggle, onGuardar, sinTabla }) {
  const gaps = banderas(c).filter(b => b !== 'end customer unknown' && !b.includes('sell-out report'));
  return (
    <div className="border-b border-white/[0.04] last:border-b-0">
      <button onClick={onToggle} data-hit={c.hit && !(abierto && c.regs.some(r => r.hit)) ? 'true' : undefined}
        className={`w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors ${
          c.hit ? 'bg-warning/[0.06] hover:bg-warning/10' : 'hover:bg-white/[0.03]'}`}>
        <span className={`inline-block transition-transform text-[9px] text-muted ${abierto ? 'rotate-90' : ''}`}>▶</span>
        <span className="font-sans text-white text-sm font-medium truncate max-w-[300px]" title={c.nombre}>{c.nombre}</span>
        {c.rol && (
          <span title={c.deSellout ? SELLOUT_TITLE : ROL_TITLE[c.rol]}
            className={`font-mono text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap ${
              c.deSellout ? 'bg-accent/15 text-accent' : ROL_STYLE[c.rol]}`}>
            {c.rol}{c.deSellout ? ` · ${SELLOUT_LABEL}` : ''}
          </span>
        )}
<SeguimientoPill c={c} />
        <span className="font-sans text-[10px] whitespace-nowrap truncate max-w-[340px] text-muted"
          title={`Reseller: ${c.resellers.join(', ') || '—'}\nDistributor (invoiced by RealWear): ${c.distribuidores.join(', ') || 'unknown'}${c.originales.length ? `\nOriginal customer: ${c.originales.join(', ')}` : ''}${c.sos.length ? `\nNetSuite SO / invoice: ${c.sos.join(', ')}` : ''}`}>
          {c.fuentes.map(f => (
            <span key={f} className={`font-mono text-[9px] px-1.5 py-0.5 rounded mr-1.5 ${
              f === 'invoice' ? 'bg-accent/15 text-accent' : 'bg-white/[0.07] text-slate-300'}`}>
              {f === 'invoice' ? 'Invoice' : 'Launchpad'}
            </span>
          ))}
          {c.rol === 'end customer' && c.resellers.length > 0 && <>reseller <span className="text-accent/80">{c.resellers.join(', ')}</span> · </>}
          {c.rol !== 'distributor' && <>distributor <span className="text-accent/80">{c.distribuidores.join(', ') || 'unknown'}</span></>}
          {c.rol === 'distributor' && <>invoiced by RealWear{c.sos.length > 0 && <> · <span className="text-accent/80">{c.sos.slice(0, 3).join(', ')}{c.sos.length > 3 ? ` +${c.sos.length - 3}` : ''}</span></>}</>}
        </span>
        <span className="font-mono text-[10px] text-muted whitespace-nowrap">
          {c.devices} {c.devices === 1 ? 'device' : 'devices'}{c.planes.length > 0 && ` · ${c.planes.join('/')}`}
          {' · '}<span className="text-slate-300">start {c.ventas[0]}{c.ventas.length > 1 ? ` … ${c.ventas[c.ventas.length - 1]}` : ''}</span>
        </span>
        {gaps.length > 0 && (
          <span title={gaps.join('\n')} className="font-mono text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap bg-warning/15 text-warning">
            {gaps.length} gap{gaps.length === 1 ? '' : 's'}
          </span>
        )}
        <span className="font-mono text-[10px] text-muted truncate max-w-[200px] hidden xl:inline ml-auto" title={c.modelos.join(', ')}>
          {c.modelos.slice(0, 3).join(' · ')}{c.modelos.length > 3 ? ` +${c.modelos.length - 3}` : ''}
        </span>
      </button>
      {abierto && (
        <div className="pb-2.5">
          <p className="px-4 pl-10 pt-1 pb-1.5 text-[10px] font-mono text-muted">
            {c.emails.length > 0 ? <>customer <span className="text-slate-300 select-all">{c.emails.join(', ')}</span></> : 'no customer email'}
            {c.resellerEmails.length > 0 && <> · reseller <span className="text-slate-300 select-all">{c.resellerEmails.join(', ')}</span></>}
            {c.workspaces.length > 0 && ` · workspace ${c.workspaces.join(', ')}`}
            {c.registros.length > 0 && ` · registered ${c.registros[0]}${c.registros.length > 1 ? ` … ${c.registros[c.registros.length - 1]}` : ''}`}
            {c.renovados > 0 && ` · ${c.renovados} renewed before`}
          </p>
          {gaps.length > 0 && (
            <ul className="px-4 pl-10 pb-1.5 text-[10px] font-mono text-warning space-y-0.5">
              {gaps.map(b => <li key={b}>· {b}</li>)}
            </ul>
          )}
          <SeguimientoEditor key={`${c.key}|${c.fuAt ?? ''}|${c.seguimiento}`} c={c} onGuardar={onGuardar} sinTabla={sinTabla} />
          <div className="flex flex-wrap gap-1.5 px-4 pl-10">
            {c.regs.map(r => (
              <Link key={`${r.id}-${r.end_date}`} to={`/serials?q=${r.serial}`}
                data-hit={r.hit ? 'true' : undefined}
                title={`${r.device ?? 'device unknown'} · start ${r.date_of_sale ?? '?'}${r.renovado ? ' · renewed before' : ''}${r.noReportado ? ' · not reported sold by the distributor' : ''}${r.sellout ? ` · sell-out: ${r.sellout.end_customer ?? '—'} via ${r.sellout.reseller ?? '—'} (${r.sellout.date_sold ?? '?'})` : ''}`}
                className={`font-mono text-[11px] px-2 py-0.5 rounded transition-colors ${
                  r.hit
                    ? 'bg-warning/25 text-warning ring-1 ring-warning/60 hover:bg-warning/30'
                    : 'bg-white/[0.05] text-slate-300 hover:text-accent hover:bg-white/[0.08]'}`}>
                {r.serial}
                <span className="text-muted"> · {r.device ?? '?'}</span>
                {c.ventas.length > 1 && <span className="text-muted opacity-70"> · {r.date_of_sale}</span>}
                {r.renovado && <span className="text-accent/80"> ·R</span>}
                {r.noReportado && <span className="text-warning"> ·not sold</span>}
              </Link>
            ))}
          </div>
        </div>
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

function TablaSoftware({ filas }) {
  return (
    <Panel>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/[0.06]">
            {['SO', 'Customer', 'Plan', 'Start', 'Ends', 'Status'].map(h => (
              <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 ? (
            <tr><td colSpan={6} className="px-4 py-8 text-center text-muted font-mono">Nothing in this view</td></tr>
          ) : filas.map((r, i) => {
            const dias = diasHasta(r.end_date);
            const vencido = estadoGarantia(r.end_date) === 'expired';
            return (
              <tr key={`${r.so_number}-${i}`} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                  <Link to={`/backlog?so=${r.so_number}`} className="text-accent hover:text-accent/80">{r.so_number}</Link>
                </td>
                <td className="px-4 py-2.5 font-sans text-white max-w-[300px] truncate" title={r.customer}>{nombreCuenta(r.customer)}</td>
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
