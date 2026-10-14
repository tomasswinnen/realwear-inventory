import { Fragment, useEffect, useMemo, useState } from 'react';
import { ExpiryChart } from '../components/ExpiryChart';
import { Link } from 'react-router-dom';
import { supabase, paginar } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { WarrantyBadge } from '../components/WarrantyBadge';
import {
  HOY, DIAS_POR_VENCER, diasHasta, estadoGarantia, nombreCuenta, clienteFinal,
  planLabel,
} from '../utils/warranty';
import { fetchSelloutMap, selloutDe, SELLOUT_LABEL, SELLOUT_TITLE } from '../utils/sellout';
import { REGIONES, regionDe } from '../utils/region';
import {
  segLabel, normSerial, seguimientoDe, resumenSeguimiento, guardarSeguimiento,
  descargarCSV, SeguimientoPill, SeguimientoFiltro, SeguimientoEditor,
} from '../components/FollowUp';

// Garantías / service plans. Fuente: tablas `warranties` (una fila por línea
// de plan vendida) y `warranty_serials` (una fila por equipo cubierto), que
// el pipeline arma con las columnas custom de la LÍNEA de la sales order en
// NetSuite: custcol_sp_end_customer, custcol_sp_sold_date y
// custcol_serial_numbers. El serial en sí (inventorynumber) no tiene fecha de
// garantía, así que esto es lo único que hay.
//
// La vista principal es POR EQUIPO (serial): cada fila es un dispositivo con
// su plan, región responsable y fechas exactas de inicio y fin. La región
// sale de la cuenta facturada (el distribuidor responsable de la zona:
// Westbase → EMEA, ScanSource → Americas, JMACS → Japan…), ver utils/region.
//
// Dos cosas que la página dice en vez de esconder:
//   1. `customer` es a quién se le FACTURÓ — casi siempre un distribuidor.
//      El cliente final es `end_customer`, y se carga a mano en NetSuite: en
//      2026 está en ~1 de cada 5 líneas, así que muchas coberturas solo
//      llegan hasta el distribuidor.
//   2. Cuando no hay sold_date, el inicio se estima con la fecha de la SO.
//      Esas filas van marcadas con "~".

// Las dos tablas se traen con tolerancia: hasta que alguien corra
// SQL_warranties.sql en Supabase no existen, y en ese caso la página tiene que
// explicar qué falta en vez de tirar un error de PostgREST a la cara.
async function fetchWarranties() {
  const traer = async tabla => {
    try {
      return await paginar(() => supabase.from(tabla).select('*')
        .order('end_date', { ascending: false }));
    } catch {
      return null; // tabla ausente
    }
  };
  const [planes, seriales, sellout, fu] = await Promise.all([
    traer('warranties'), traer('warranty_serials'),
    // Relleno: end customer reportado por el disti en el sell-out, para los
    // seriales cuya línea de NetSuite no lo tiene.
    fetchSelloutMap(),
    // Seguimiento de renovaciones (lo marca el equipo en la página)
    traer('warranty_followup'),
  ]);
  return {
    planes: planes ?? [],
    seriales: seriales ?? [],
    sellout,
    fu: fu ?? [], fuFalta: fu === null,
    falta: planes === null,
  };
}

// Momento de una cobertura según su fecha de fin (igual que Subscriptions).
function momento(end) {
  const d = diasHasta(end);
  if (d == null) return 'old';
  if (d > DIAS_POR_VENCER) return 'active';
  if (d > 0) return 'renew';
  if (d > -DIAS_POR_VENCER) return 'lapsed';
  return 'old';
}
const MOMENTO_LABEL = { renew: 'Renewal window', active: 'In warranty', lapsed: 'Lapsed', old: 'Expired' };

const FILTROS = {
  renew: { label: `To renew ≤${DIAS_POR_VENCER}d`, test: e => e === 'renew' },
  vigentes: { label: 'In warranty', test: e => e === 'renew' || e === 'active' },
  lapsed: { label: `Lapsed ≤${DIAS_POR_VENCER}d`, test: e => e === 'lapsed' },
  todas: { label: 'All', test: () => true },
};

const uniq = xs => [...new Set(xs.filter(Boolean))];

// Una fila por contrato (equipos de un mismo cliente que vencen el mismo día)
// = un deal de renovación en HubSpot. Mismas columnas base que Subscriptions.
function filaContrato(c) {
  const regs = c.regs;
  const esFinal = Boolean(clienteFinal(regs[0]));
  const serials = uniq(regs.map(r => r.serial)).sort();
  const inicios = uniq(regs.map(r => r.start_date)).sort();
  const skus = [...regs.reduce((m, r) => m.set(r.sku ?? '?', (m.get(r.sku ?? '?') ?? 0) + 1), new Map()).entries()]
    .map(([k, n]) => (n > 1 ? `${k} ×${n}` : k));
  return {
    'Deal name': `Warranty renewal – ${c.cliente} – ${serials.length} device${serials.length === 1 ? '' : 's'} – ends ${c.end_date}`,
    'Pipeline': 'Sales Pipeline',
    'Close date': c.end_date,
    'Amount': '',
    'Follow-up status': segLabel(c.seguimiento),
    'Follow-up note': c.nota,
    'Contact (who to call)': c.cliente,
    'Contact role': esFinal ? 'end customer' : 'distributor',
    'End customer': esFinal ? c.cliente : '',
    'End customer source': esFinal ? (regs.some(r => r.end_customer_source === 'sellout') ? 'distributor sell-out report' : 'NetSuite') : '',
    'Reseller (sell-out)': uniq(regs.map(r => r.sellout_reseller)).join('; '),
    'Distributor (billed to)': uniq(regs.map(r => nombreCuenta(r.customer))).join('; '),
    'Region': uniq(regs.map(r => r.region)).join('/'),
    'Devices': serials.length,
    'Device SKUs': skus.join('; '),
    'Plan': uniq(regs.map(r => r.plan_sku)).map(planLabel).join('; '),
    'Start date': inicios[0] ?? '',
    'Start estimated': regs.some(r => r.start_source === 'so_date') ? 'yes' : '',
    'End date': c.end_date,
    'Days left': diasHasta(c.end_date),
    'Status': MOMENTO_LABEL[momento(c.end_date)],
    'NetSuite SO': uniq(regs.map(r => r.so_number)).sort().join('; '),
    'Serial numbers': serials.join('; '),
    'Contract ID': `WAR-${c.end_date}-${serials[0] ?? 'x'}`,
  };
}

const VISTAS = [
  ['devices', 'By device'],
  ['regions', 'By region'],
  ['customers', 'By customer'],
  ['coverages', 'By coverage'],
];

function coincide(w, q) {
  if (!q) return true;
  const t = q.toLowerCase();
  return [w.end_customer, w.customer, w.so_number, w.sku, w.serial, w.plan_sku]
    .some(v => (v ?? '').toLowerCase().includes(t));
}

async function exportarExcel(planes, seriales, contratos) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  // Contratos primero: es la lista de trabajo (una fila = un deal de renovación)
  const ws0 = XLSX.utils.json_to_sheet(contratos.map(filaContrato));
  ws0['!cols'] = [{ wch: 50 }, { wch: 14 }, { wch: 11 }, { wch: 8 }, { wch: 14 }, { wch: 30 }, { wch: 30 },
                  { wch: 13 }, { wch: 28 }, { wch: 22 }, { wch: 22 }, { wch: 28 }, { wch: 9 }, { wch: 7 },
                  { wch: 24 }, { wch: 34 }, { wch: 11 }, { wch: 9 }, { wch: 11 }, { wch: 8 }, { wch: 14 },
                  { wch: 16 }, { wch: 40 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws0, 'Contracts');

  // Equipos primero: es la hoja que responde "¿este serial está cubierto?"
  const ws2 = XLSX.utils.json_to_sheet(seriales.map(s => ({
    'Serial': s.serial, 'Item': s.sku,
    'Plan': s.plan_sku ?? '', 'Years': s.plan_years ?? '',
    'Region': s.region, 'SO': s.so_number,
    'End Customer': s.end_customer || '',
    'End Customer Source': s.end_customer_source === 'sellout' ? 'distributor sell-out report' : (s.end_customer ? 'NetSuite' : ''),
    'Billed To': s.customer,
    'Warranty Start': s.start_date,
    'Start Estimated': s.start_source === 'so_date' ? 'yes' : '',
    'Warranty End': s.end_date,
    'Days Left': Math.max(0, diasHasta(s.end_date) ?? 0),
    'Status': MOMENTO_LABEL[momento(s.end_date)],
    'Follow-up': segLabel(s.fu?.status ?? 'open'),
    'Follow-up note': s.fu?.note ?? '',
  })));
  ws2['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 6 }, { wch: 10 },
                  { wch: 11 }, { wch: 28 }, { wch: 22 }, { wch: 32 }, { wch: 13 }, { wch: 13 },
                  { wch: 13 }, { wch: 9 }, { wch: 14 }, { wch: 14 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Devices');

  const hojaPlanes = planes.map(w => ({
    'SO': w.so_number, 'SO Date': w.so_date, 'Region': w.region,
    'Billed To': w.customer, 'End Customer': w.end_customer || '',
    'Plan': w.sku, 'Qty': w.qty, 'Years': w.plan_years,
    'Start': w.start_date, 'Start Estimated': w.start_source === 'so_date' ? 'yes' : '',
    'End': w.end_date, 'Status': estadoGarantia(w.end_date),
    'Serials Listed': w.serial_count,
  }));
  const ws1 = XLSX.utils.json_to_sheet(hojaPlanes);
  ws1['!cols'] = [{ wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 32 }, { wch: 28 },
                  { wch: 14 }, { wch: 6 }, { wch: 6 }, { wch: 11 }, { wch: 14 },
                  { wch: 11 }, { wch: 11 }, { wch: 13 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Coverages');

  XLSX.writeFile(wb, `warranties_${HOY()}.xlsx`);
}

export function Warranties() {
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState('renew');
  const [seg, setSeg] = useState('any');
  // Seguimientos guardados en esta sesión (para no recargar todo al guardar)
  const [fuLocal, setFuLocal] = useState(() => new Map());
  const [region, setRegion] = useState('all');
  const [vista, setVista] = useState('devices');
  const [exportando, setExportando] = useState(false);
  const { data, loading, error, refetch } = useQuery(fetchWarranties, []);

  const v = useMemo(() => {
    if (!data) return null;

    // Enriquecido: región (por cuenta facturada) en planes y seriales, y el
    // plan (tipo + plazo) en cada serial, buscando en la misma SO la cobertura
    // con las mismas fechas. warranty_serials ya trae start/end, pero no dice
    // QUÉ plan es — eso vive en la línea (tabla warranties).
    const planesR = data.planes.map(w => ({ ...w, region: regionDe(w.customer) }));
    const planPorSo = new Map();
    for (const w of planesR) {
      if (!planPorSo.has(w.so_number)) planPorSo.set(w.so_number, []);
      planPorSo.get(w.so_number).push(w);
    }
    const serialesR = data.seriales.map(s => {
      const cand = planPorSo.get(s.so_number) ?? [];
      const plan =
        cand.find(w => w.end_date === s.end_date && w.start_date === s.start_date)
        ?? cand.find(w => w.end_date === s.end_date)
        ?? cand[0] ?? null;
      const fila = {
        ...s,
        region: regionDe(s.customer),
        plan_sku: plan?.sku ?? null,
        plan_years: plan?.plan_years ?? null,
        start_source: plan?.start_source ?? null,
        end_customer_source: (s.end_customer ?? '').trim() ? 'netsuite' : null,
      };
      // Sin end customer en NetSuite → el del sell-out del disti, marcado.
      if (!fila.end_customer_source) {
        const so = selloutDe(data.sellout, s.serial);
        if (so?.end_customer) {
          fila.end_customer = so.end_customer;
          fila.end_customer_source = 'sellout';
          fila.sellout_reseller = so.reseller ?? null;
        }
      }
      return fila;
    });

    // Seguimiento por serial (solo vale para su fecha de fin) y contrato =
    // fecha de fin + cliente (end customer, o la cuenta facturada).
    const fuPor = new Map(data.fu.map(f => [normSerial(f.serial), f]));
    for (const [k, f] of fuLocal) fuPor.set(k, f);
    const porContrato = new Map();
    for (const s of serialesR) {
      s.fu = seguimientoDe(fuPor, s.serial, s.end_date);
      s.cliente = (clienteFinal(s) ?? nombreCuenta(s.customer)) || '—';
      s.ckey = `${s.end_date}|${s.cliente}`;
      if (!porContrato.has(s.ckey)) porContrato.set(s.ckey, []);
      porContrato.get(s.ckey).push(s);
    }
    const contratosTodos = [...porContrato.entries()].map(([key, regs]) => ({
      key, regs, end_date: regs[0].end_date, cliente: regs[0].cliente,
      momento: momento(regs[0].end_date), ...resumenSeguimiento(regs),
    }));
    const segDe = new Map(contratosTodos.map(c => [c.key, c.seguimiento]));

    const test = FILTROS[filtro].test;
    const enRegion = r => region === 'all' || r.region === region;
    const okSeg = s => seg === 'any' || segDe.get(s.ckey) === seg;
    const planes = planesR.filter(w => test(momento(w.end_date)) && coincide(w, q) && enRegion(w));
    // Busqueda con contexto (igual que Subscriptions): el grupo fecha+cliente
    // que contiene el match se muestra ENTERO y el serial se resalta.
    const baseSer = serialesR.filter(s => test(momento(s.end_date)) && enRegion(s) && okSeg(s));
    // Searching never removes rows: everything stays, matches get flagged.
    const seriales = q ? baseSer.map(s => ({ ...s, hit: coincide(s, q) })) : baseSer;
    const enVista = new Set(baseSer.map(s => s.ckey));
    const fuera = q
      ? new Set(serialesR.filter(s => !enVista.has(s.ckey) && coincide(s, q)).map(s => s.ckey)).size
      : 0;
    const contratosVista = contratosTodos.filter(c => enVista.has(c.key))
      .sort((a, b) => (a.end_date < b.end_date ? -1 : 1));
    const cRegion = contratosTodos.filter(c => c.regs.some(enRegion));
    const conteoFecha = Object.fromEntries(Object.entries(FILTROS)
      .map(([k, f]) => [k, cRegion.filter(c => f.test(c.momento)).length]));
    const conteoSeg = { any: 0 };
    for (const c of cRegion.filter(c => test(c.momento))) {
      conteoSeg.any += 1;
      conteoSeg[c.seguimiento] = (conteoSeg[c.seguimiento] ?? 0) + 1;
    }

    // Resumen por región: sobre TODO el histórico (sin búsqueda ni filtro de
    // estado) — es el mapa de responsabilidades, no una vista filtrada.
    const porRegion = new Map();
    const reg = r => {
      if (!porRegion.has(r)) {
        porRegion.set(r, {
          region: r, equiposVig: 0, porVencer: 0, vencidos: 0,
          planesVig: 0, unidades: 0, dist: new Set(), proximo: null,
        });
      }
      return porRegion.get(r);
    };
    for (const s of serialesR) {
      const g = reg(s.region);
      const e = estadoGarantia(s.end_date);
      if (e === 'expired') g.vencidos += 1;
      else {
        g.equiposVig += 1;
        if (e === 'expiring') g.porVencer += 1;
        if (g.proximo === null || s.end_date < g.proximo) g.proximo = s.end_date;
      }
    }
    for (const w of planesR) {
      const g = reg(w.region);
      g.dist.add(nombreCuenta(w.customer));
      if (estadoGarantia(w.end_date) !== 'expired') {
        g.planesVig += 1;
        g.unidades += w.qty ?? 0;
      }
    }
    const regiones = [...REGIONES, 'Unassigned']
      .map(r => porRegion.get(r)).filter(Boolean);

    // Agrupado por cliente. La clave es el cliente final cuando está cargado;
    // si no, la cuenta facturada, marcada como distribuidor para que no se
    // confunda con un usuario final.
    const porCliente = new Map();
    const clave = r => clienteFinal(r) ?? `__dist__${r.customer ?? '?'}`;
    for (const w of planes) {
      const k = clave(w);
      if (!porCliente.has(k)) {
        porCliente.set(k, {
          k,
          nombre: clienteFinal(w) ?? nombreCuenta(w.customer),
          esFinal: Boolean(clienteFinal(w)),
          region: w.region,
          distribuidores: new Set(),
          planes: 0, unidades: 0, equipos: new Set(),
          proximo: null, skus: new Set(),
        });
      }
      const g = porCliente.get(k);
      g.planes += 1;
      g.unidades += w.qty ?? 0;
      if (w.customer) g.distribuidores.add(nombreCuenta(w.customer));
      if (w.sku) g.skus.add(w.sku);
      const vigente = estadoGarantia(w.end_date) !== 'expired';
      if (vigente && (g.proximo === null || w.end_date < g.proximo)) g.proximo = w.end_date;
    }
    for (const s of seriales) {
      const g = porCliente.get(clave(s));
      if (g) g.equipos.add(s.serial);
    }
    const clientes = [...porCliente.values()]
      .sort((a, b) => (b.equipos.size - a.equipos.size) || (b.unidades - a.unidades));

    // KPIs: siempre sobre el total, no sobre el filtro — son la foto de hoy.
    const vigPlanes = planesR.filter(w => estadoGarantia(w.end_date) !== 'expired');
    const vigSer = serialesR.filter(s => estadoGarantia(s.end_date) !== 'expired');
    const kpi = {
      equipos: vigSer.length,
      planes: vigPlanes.length,
      finales: new Set(vigPlanes.map(clienteFinal).filter(Boolean)).size,
      sinFinal: vigPlanes.filter(w => !clienteFinal(w)).length,
      // Equipos cubiertos que NADIE identificó por serial: la diferencia entre
      // unidades vendidas con plan y seriales listados. Es el tamaño real del
      // agujero de datos, y conviene tenerlo a la vista.
      sinSerial: vigPlanes.reduce((s, w) => s + Math.max(0, (w.qty ?? 0) - (w.serial_count ?? 0)), 0),
      porVencer: vigPlanes.filter(w => estadoGarantia(w.end_date) === 'expiring').length,
      equiposPorVencer: vigSer.filter(s => estadoGarantia(s.end_date) === 'expiring').length,
      estimados: vigPlanes.filter(w => w.start_source === 'so_date').length,
      rellenados: vigSer.filter(s => s.end_customer_source === 'sellout').length,
    };
    const ren = contratosTodos.filter(c => c.momento === 'renew');
    const lap = contratosTodos.filter(c => c.momento === 'lapsed');
    kpi.renew = ren.length;
    kpi.renewDev = ren.reduce((n, c) => n + c.regs.length, 0);
    kpi.renewOpen = ren.filter(c => c.seguimiento === 'open').length;
    kpi.lapsed = lap.length;
    kpi.lapsedOpen = lap.filter(c => c.seguimiento !== 'renewed' && c.seguimiento !== 'lost').length;
    return {
      planes, seriales, clientes, regiones, kpi, serialesTodos: serialesR,
      contratosVista, conteoFecha, conteoSeg, fuera,
    };
  }, [data, q, filtro, region, seg, fuLocal]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  const exportar = async () => {
    if (exportando || !v) return;
    setExportando(true);
    try { await exportarExcel(v.planes, v.seriales, v.contratosVista); } finally { setExportando(false); }
  };
  const exportarHubspot = () => {
    if (!v) return;
    descargarCSV(v.contratosVista.map(filaContrato), `warranties_hubspot_${filtro}_${HOY()}.csv`);
  };
  const guardar = async (c, estado, nota) => {
    const filas = await guardarSeguimiento('warranty_followup', c.regs, estado, nota);
    setFuLocal(prev => {
      const n = new Map(prev);
      for (const f of filas) n.set(normSerial(f.serial), f);
      return n;
    });
  };

  const regionesPresentes = v
    ? [...new Set(v.regiones.map(r => r.region))]
    : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Warranties</h1>
        <p className="text-xs text-muted font-mono mt-0.5">
          Renewal tracker for service plan coverage (NetSuite) — one row = the devices of one customer that end on the same day, with exact dates, plan and the region responsible
        </p>
      </div>

      {loading || !v ? <KPISkeleton /> : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <KPICard label="Devices in warranty" value={v.kpi.equipos.toLocaleString()}
            sub={`${v.kpi.planes} active coverages · ${v.kpi.sinSerial.toLocaleString()} more units covered without a serial`}
            accent />
          <KPICard label="End customers" value={v.kpi.finales.toLocaleString()}
            sub={`${v.kpi.sinFinal} coverages with distributor only${v.kpi.rellenados ? ` · ${v.kpi.rellenados} devices named only by sell-out` : ''}`} />
          <KPICard label={`To renew ≤${DIAS_POR_VENCER}d`} value={v.kpi.renew.toLocaleString()}
            sub={`contracts · ${v.kpi.renewDev} devices · ${v.kpi.renewOpen} not contacted yet`}
            color={v.kpi.renew ? 'text-warning' : undefined} />
          <KPICard label={`Lapsed ≤${DIAS_POR_VENCER}d`} value={v.kpi.lapsed.toLocaleString()}
            sub={`contracts · ${v.kpi.lapsedOpen} not marked renewed or lost`}
            color={v.kpi.lapsedOpen ? 'text-danger' : undefined} />
          <KPICard label="Estimated start" value={v.kpi.estimados.toLocaleString()}
            sub="no sold date in NetSuite" />
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="search"
          placeholder="Serial, end customer, distributor, SO # or plan SKU…"
          value={q}
          onChange={e => setQ(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-full sm:w-80"
        />
        <div className="flex items-center gap-1 flex-wrap">
          {Object.entries(FILTROS).map(([k, f]) => (
            <button key={k} onClick={() => setFiltro(k)}
              className={`px-2.5 py-1.5 rounded text-[11px] font-mono transition-colors ${
                filtro === k ? 'bg-accent/15 text-accent' : 'text-muted hover:text-white'}`}>
              {f.label}{v ? <span className="opacity-60"> · {v.conteoFecha[k]}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 sm:ml-auto">
          {VISTAS.map(([k, label]) => (
            <button key={k} onClick={() => setVista(k)}
              className={`px-2.5 py-1.5 rounded text-[11px] font-mono border transition-colors ${
                vista === k
                  ? 'border-accent/50 text-white'
                  : 'border-white/[0.12] text-muted hover:text-white'}`}>
              {label}
            </button>
          ))}
          <button onClick={exportar} disabled={exportando}
            title="Contracts, devices and coverages — for the current view"
            className="px-3 py-1.5 rounded border border-white/[0.12] text-[11px] font-mono text-slate-300 hover:text-white hover:border-accent/50 disabled:opacity-60 transition-colors whitespace-nowrap">
            {exportando ? 'Exporting…' : 'Export Excel'}
          </button>
          <button onClick={exportarHubspot} disabled={!v}
            title="CSV with one row per contract (one renewal deal each), ready to import into HubSpot as Deals — for the current view"
            className="px-3 py-1.5 rounded border border-accent/40 text-[11px] font-mono text-accent hover:bg-accent/10 disabled:opacity-40 transition-colors whitespace-nowrap">
            Export for HubSpot{v ? ` (${v.contratosVista.length})` : ''}
          </button>
        </div>
      </div>

      {/* Filtro por región responsable (aplica a todas las vistas) */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-muted font-mono uppercase tracking-widest mr-1">Region</span>
        {['all', ...regionesPresentes].map(r => (
          <button key={r} onClick={() => setRegion(r)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-mono border transition-colors ${
              region === r
                ? 'border-accent/60 bg-accent/10 text-accent'
                : 'border-white/[0.1] text-muted hover:text-white'}`}>
            {r === 'all' ? 'All' : r}
          </button>
        ))}
      </div>

      {vista === 'devices' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <SeguimientoFiltro seg={seg} setSeg={setSeg} conteo={v?.conteoSeg} />
          {q && v?.fuera > 0 && (
            <button onClick={() => { setFiltro('todas'); setSeg('any'); setRegion('all'); }}
              className="ml-2 text-[10px] font-mono text-warning underline underline-offset-2">
              {v.fuera} more match{v.fuera === 1 ? '' : 'es'} outside this view — show all
            </button>
          )}
        </div>
      )}
      {data?.fuFalta && (
        <p className="text-xs font-mono text-warning bg-warning/5 border border-warning/20 rounded px-3 py-2">
          Follow-up can’t be saved yet: the warranty_followup table doesn’t exist (SQL_warranty_followup.sql).
        </p>
      )}

      {v && vista === 'devices' && (
        <ExpiryChart filas={v.serialesTodos} titulo="Warranty expirations by month (identified devices)" />
      )}

      {data?.falta && (
        <p className="text-xs font-mono text-warning bg-warning/5 border border-warning/20 rounded px-3 py-2">
          Warranty tables not created yet — run SQL_warranties.sql in Supabase, then one pipeline run.
        </p>
      )}

      {loading || !v ? <TableSkeleton rows={10} cols={6} /> : (
        <>
          {vista === 'devices' && (
            <TablaEquipos seriales={v.seriales} q={q} onGuardar={guardar} sinTabla={data.fuFalta} />
          )}
          {vista === 'regions' && (
            <TablaRegiones regiones={v.regiones}
              onElegir={r => { setRegion(r); setVista('devices'); }} />
          )}
          {vista === 'customers' && <TablaClientes clientes={v.clientes} />}
          {vista === 'coverages' && <TablaCoberturas planes={v.planes} />}

          <div className="text-[10px] text-muted font-mono leading-relaxed space-y-1.5">
            <p className="text-slate-300">How to use it</p>
            <p>1 · Work the “To renew” list (By device): the big name is the end customer, or the distributor RealWear invoiced when NetSuite has no end customer. Open the contract, set Follow-up (Contacted → Quote sent → Renewed / Lost) and leave a note. Everyone sees it.</p>
            <p>2 · When the new coverage arrives (new plan in NetSuite), it starts again as “Not contacted” on its new end date — the old status stays with the old period.</p>
            <p>3 · “Export for HubSpot” = one row per contract (one renewal deal), close date = end date. “Export Excel” = contracts + devices + coverages. Both export the current view.</p>
          </div>
          <p className="text-[10px] text-muted font-mono leading-relaxed">
            Coverage lives on the sales order line in NetSuite, not on the serial.
            “Billed to” is the account that bought it — usually a distributor — and the
            region comes from that account (Westbase → EMEA, ScanSource → Americas,
            JMACS → Japan…); accounts the map doesn’t know yet show as Unassigned. The
            end customer is a field someone fills in by hand, so it is missing on many
            recent orders. A “~” means the start date was estimated from the SO date
            because no sold date was recorded. The serial count per coverage is what
            NetSuite actually lists: it is often lower than the units covered, either
            because nobody typed them in or because the field is capped at 4000
            characters on large orders.
          </p>
        </>
      )}
    </div>
  );
}

function Vacio({ cols, children }) {
  return (
    <tr><td colSpan={cols} className="px-4 py-8 text-center text-muted font-mono">
      {children}
    </td></tr>
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

// ── Por equipo: fecha de fin → end customer → seriales (misma estructura que
// Subscriptions). Los grupos arrancan abiertos; una búsqueda nueva los reabre
// y resalta en amarillo los seriales que matchean.
function TablaEquipos({ seriales, q, onGuardar, sinTabla }) {
  // Todo arranca COLAPSADO; una busqueda expande solo los grupos con match.
  // Depende de QUÉ grupos matchean (no del array): guardar un seguimiento
  // recalcula las filas y no tiene que cerrar lo que el usuario abrió.
  const [abiertos, setAbiertos] = useState(() => new Set());
  const hits = [...new Set(seriales.filter(s => s.hit)
    .map(s => `${s.end_date}|${(clienteFinal(s) ?? nombreCuenta(s.customer)) || '—'}`))].join('\n');
  useEffect(() => {
    if (!q) { setAbiertos(new Set()); return; }
    setAbiertos(new Set(hits.split('\n').filter(Boolean)));
    const timer = setTimeout(() => {
      document.querySelector('[data-hit="true"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => clearTimeout(timer);
  }, [q, hits]);

  const grupos = useMemo(() => {
    const porFecha = new Map();
    for (const s of seriales) {
      if (!porFecha.has(s.end_date)) porFecha.set(s.end_date, new Map());
      const pc = porFecha.get(s.end_date);
      const k = (clienteFinal(s) ?? nombreCuenta(s.customer)) || '—';
      if (!pc.has(k)) pc.set(k, []);
      pc.get(k).push(s);
    }
    return [...porFecha.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([fecha, m]) => ({
        fecha,
        total: [...m.values()].reduce((n, v) => n + v.length, 0),
        clientes: [...m.entries()]
          .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])),
      }));
  }, [seriales]);

  const alternar = k => setAbiertos(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const abrirTodo = () => setAbiertos(new Set(
    grupos.flatMap(g => g.clientes.map(([cliente]) => `${g.fecha}|${cliente}`))));

  if (grupos.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-white/[0.08] px-4 py-8 text-center text-muted font-mono text-xs">
        Nothing matches — or the warranty tables are still empty
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-1">
        <button onClick={abrirTodo}
          className="px-2.5 py-1 rounded border border-white/[0.12] text-[10px] font-mono text-muted hover:text-white hover:border-accent/50 transition-colors">
          Expand all
        </button>
        <button onClick={() => setAbiertos(new Set())}
          className="px-2.5 py-1 rounded border border-white/[0.12] text-[10px] font-mono text-muted hover:text-white hover:border-accent/50 transition-colors">
          Collapse all
        </button>
      </div>
      {(q ? grupos : grupos.slice(0, 80)).map(g => {
        const dias = diasHasta(g.fecha);
        const vencido = estadoGarantia(g.fecha) === 'expired';
        return (
          <section key={g.fecha} className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <header className="flex items-baseline gap-3 px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
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
            </header>
            {g.clientes.map(([cliente, regs]) => {
              const k = `${g.fecha}|${cliente}`;
              const abierto = abiertos.has(k);
              const inicios = [...new Set(regs.map(r => r.start_date))].sort();
              const planes = [...new Set(regs.map(r => r.plan_sku).filter(Boolean))];
              const regiones = [...new Set(regs.map(r => r.region))];
              const esFinal = Boolean(clienteFinal(regs[0]));
              const cuentas = [...new Set(regs.map(r => nombreCuenta(r.customer)))];
              const c = { key: k, cliente, end_date: g.fecha, regs, ...resumenSeguimiento(regs) };
              return (
                <div key={k} className="border-t border-white/[0.04]">
                  <button onClick={() => alternar(k)}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-white/[0.03] transition-colors">
                    <span className={`inline-block transition-transform text-[9px] text-muted ${abierto ? 'rotate-90' : ''}`}>▶</span>
                    <span className="font-sans text-white text-sm font-medium truncate max-w-[300px]" title={cliente}>{cliente}</span>
                    <span title={esFinal ? 'End customer' : 'No end customer in NetSuite: the distributor RealWear invoiced is the contact'}
                      className={`font-mono text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap ${
                        esFinal ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}>
                      {esFinal ? 'end customer' : 'distributor'}
                    </span>
                    <SeguimientoPill c={c} />
                    {regs.some(r => r.end_customer_source === 'sellout') && (
                      <span title={SELLOUT_TITLE}
                        className="font-mono text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap bg-accent/15 text-accent">
                        {SELLOUT_LABEL}
                      </span>
                    )}
                    <span className="font-sans text-[10px] text-accent/80 truncate max-w-[200px] whitespace-nowrap"
                      title={cuentas.join(', ')}>
                      {esFinal
                        ? `via ${[...new Set(regs.map(r => r.sellout_reseller).filter(Boolean))].concat(cuentas).join(', ')}`
                        : 'invoiced by RealWear'}
                    </span>
                    <span className="font-mono text-[10px] text-muted whitespace-nowrap">
                      {regs.length} {regs.length === 1 ? 'device' : 'devices'}
                      {planes.length > 0 && ` · ${planes.join('/')}`}
                      {' · '}
                      <span className="text-slate-300">
                        start {inicios[0]}{inicios.length > 1 ? ` … ${inicios[inicios.length - 1]}` : ''}
                      </span>
                      {' · '}{regiones.join('/')}
                    </span>
                  </button>
                  {abierto && (
                    <SeguimientoEditor key={`${k}|${c.fuAt ?? ''}|${c.seguimiento}`} c={c}
                      onGuardar={onGuardar} sinTabla={sinTabla} />
                  )}
                  {abierto && (
                    <div className="px-4 pb-2.5 pl-10">
                      {planes.length > 0 && (
                        <p className="text-[10px] font-mono text-muted mb-1.5">
                          {planes.map(planLabel).join(' · ')}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        {regs.map(s => (
                          <Link key={`${s.serial}-${s.so_number}`} to={`/serials?q=${s.serial}`}
                            data-hit={s.hit ? 'true' : undefined}
                            title={`${s.sku ?? ''}${s.so_number ? ` · ${s.so_number}` : ''}${s.start_source === 'so_date' ? ' · start estimated' : ''}`}
                            className={`font-mono text-[11px] px-2 py-0.5 rounded transition-colors ${
                              s.hit
                                ? 'bg-warning/25 text-warning ring-1 ring-warning/60 hover:bg-warning/30'
                                : 'bg-white/[0.05] text-slate-300 hover:text-accent hover:bg-white/[0.08]'}`}>
                            {s.serial}
                            <span className="text-muted"> · {s.sku ?? '?'}</span>
                            {s.start_source === 'so_date' && <span className="text-muted opacity-70">~</span>}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
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

// ── Por región: quién es responsable de qué zona y cuánto vence ───────────
function TablaRegiones({ regiones, onElegir }) {
  return (
    <Panel>
      <table className="w-full text-xs">
        <Encabezados cols={['Region', 'Devices in warranty', `Expiring ≤${DIAS_POR_VENCER}d`,
                            'Expired', 'Active coverages', 'Units covered',
                            'Responsible distributors', 'Next expiry']} />
        <tbody>
          {regiones.length === 0 ? (
            <Vacio cols={8}>The warranties tables are still empty</Vacio>
          ) : regiones.map(g => {
            const dias = g.proximo ? diasHasta(g.proximo) : null;
            const dist = [...g.dist].sort();
            return (
              <tr key={g.region}
                onClick={() => onElegir(g.region)}
                title={`Show ${g.region} devices`}
                className="border-b border-white/[0.04] hover:bg-white/[0.03] cursor-pointer transition-colors">
                <td className="px-4 py-2.5 font-sans font-medium whitespace-nowrap">
                  <span className={g.region === 'Unassigned' ? 'text-muted' : 'text-white'}>
                    {g.region}
                  </span>
                  {g.region === 'Unassigned' && (
                    <span className="block text-[10px] font-mono text-muted">
                      accounts the region map doesn’t know yet
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 font-num text-white">{g.equiposVig || '—'}</td>
                <td className="px-4 py-2.5 font-num">
                  {g.porVencer
                    ? <span className="text-warning">{g.porVencer}</span>
                    : <span className="text-muted">—</span>}
                </td>
                <td className="px-4 py-2.5 font-num text-muted">{g.vencidos || '—'}</td>
                <td className="px-4 py-2.5 font-num text-slate-300">{g.planesVig || '—'}</td>
                <td className="px-4 py-2.5 font-num text-slate-300">{g.unidades || '—'}</td>
                <td className="px-4 py-2.5 font-sans text-slate-300 max-w-[340px] truncate"
                  title={dist.join(', ')}>
                  {dist.slice(0, 3).join(' · ')}{dist.length > 3 ? ` +${dist.length - 3}` : ''}
                </td>
                <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                  {g.proximo
                    ? <span className={dias <= DIAS_POR_VENCER ? 'text-warning' : 'text-slate-300'}>
                        {g.proximo}{dias <= DIAS_POR_VENCER ? ` · ${dias}d` : ''}
                      </span>
                    : <span className="text-muted">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
        Region comes from the billed-to account (the distributor responsible for the zone).
        Click a row to see its devices. To assign an Unassigned account, add it to src/utils/region.js.
      </p>
    </Panel>
  );
}

function TablaClientes({ clientes }) {
  return (
    <Panel>
      <table className="w-full text-xs">
        <Encabezados cols={['Customer', 'Region', 'Devices', 'Coverages', 'Units', 'Plans', 'Next expiry']} />
        <tbody>
          {clientes.length === 0 ? (
            <Vacio cols={7}>Nothing matches — or the warranties tables are still empty</Vacio>
          ) : clientes.map(g => {
            const dias = g.proximo ? diasHasta(g.proximo) : null;
            return (
              <tr key={g.k} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                <td className="px-4 py-2.5 max-w-[320px]">
                  <p className="font-sans text-white truncate" title={g.nombre}>{g.nombre}</p>
                  <p className="text-[10px] font-mono text-muted truncate"
                    title={[...g.distribuidores].join(', ')}>
                    {g.esFinal
                      ? `via ${[...g.distribuidores].join(', ') || '—'}`
                      : 'distributor — end customer not recorded'}
                  </p>
                </td>
                <td className="px-4 py-2.5 font-mono text-slate-300 whitespace-nowrap">{g.region}</td>
                <td className="px-4 py-2.5 font-num text-white">{g.equipos.size || '—'}</td>
                <td className="px-4 py-2.5 font-num text-slate-300">{g.planes}</td>
                <td className="px-4 py-2.5 font-num text-slate-300">{g.unidades}</td>
                <td className="px-4 py-2.5 font-mono text-muted max-w-[200px] truncate"
                  title={[...g.skus].map(planLabel).join('\n')}>{[...g.skus].join(' · ')}</td>
                <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                  {g.proximo
                    ? <span className={dias <= DIAS_POR_VENCER ? 'text-warning' : 'text-slate-300'}>
                        {g.proximo}{dias <= DIAS_POR_VENCER ? ` · ${dias}d` : ''}
                      </span>
                    : <span className="text-muted">expired</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function TablaCoberturas({ planes }) {
  return (
    <Panel>
      <table className="w-full text-xs">
        <Encabezados cols={['SO', 'Region', 'End customer', 'Billed to', 'Plan', 'Qty', 'Coverage', 'Status']} />
        <tbody>
          {planes.length === 0 ? <Vacio cols={8}>Nothing matches</Vacio> : planes.slice(0, 500).map((w, i) => (
            <tr key={`${w.so_number}-${w.sku}-${i}`} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
              <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                <Link to={`/backlog?so=${w.so_number}`} className="text-accent hover:text-accent/80">
                  {w.so_number}
                </Link>
                <span className="block text-[10px] text-muted">{w.so_date}</span>
              </td>
              <td className="px-4 py-2.5 font-mono text-slate-300 whitespace-nowrap">{w.region}</td>
              <td className="px-4 py-2.5 font-sans max-w-[220px] truncate"
                title={w.end_customer || 'not recorded in NetSuite'}>
                {w.end_customer
                  ? <span className="text-white">{w.end_customer}</span>
                  : <span className="text-muted">—</span>}
              </td>
              <td className="px-4 py-2.5 font-sans text-slate-300 max-w-[220px] truncate"
                title={w.customer}>{nombreCuenta(w.customer)}</td>
              <td className="px-4 py-2.5 whitespace-nowrap">
                <span className="font-mono text-muted">{w.sku}</span>
                <span className="block text-[10px] font-sans text-muted opacity-80">{planLabel(w.sku)}</span>
              </td>
              <td className="px-4 py-2.5 font-num text-slate-300 whitespace-nowrap">
                {w.qty}
                {/* Cuántos de esos equipos están identificados por serial. Casi
                    nunca es el total: o no los cargaron, o NetSuite cortó el
                    campo en 4000 caracteres (órdenes grandes). */}
                <span className={`text-[10px] ml-1 ${w.serial_count < w.qty ? 'text-warning/70' : 'text-muted'}`}
                  title={w.serial_count < w.qty
                    ? `${w.serial_count} of ${w.qty} covered devices identified by serial in NetSuite`
                    : 'every covered device identified by serial'}>
                  · {w.serial_count} s/n
                </span>
              </td>
              <td className="px-4 py-2.5 font-mono text-muted whitespace-nowrap">
                {w.start_date}{w.start_source === 'so_date' && <span title="estimated from the SO date">~</span>}
                {' → '}{w.end_date}
              </td>
              <td className="px-4 py-2.5"><WarrantyBadge w={w} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {planes.length > 500 && (
        <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
          Showing the first 500 of {planes.length.toLocaleString()} — narrow the search or use Export Excel.
        </p>
      )}
    </Panel>
  );
}
