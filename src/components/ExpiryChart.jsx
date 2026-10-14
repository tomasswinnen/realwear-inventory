import { useMemo } from 'react';
import { HOY, DIAS_POR_VENCER } from '../utils/warranty';

// Vencimientos por mes, compartido por Subscriptions y Warranties. Solo lo que
// VIENE (desde el mes actual), porque es para planificar renovaciones: lo
// vencido no se puede renovar y achicaba todo. Meses corridos (los vacíos
// también, para ver los huecos), hasta 24 meses; lo posterior se suma en una
// última barra "later". Ancho completo, número arriba de cada barra.
// Ámbar = ventana de renovación (≤90 días), celeste = después.
// Espera filas con `end_date` (YYYY-MM-DD).
const HORIZONTE = 24;
const MES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sumarMes(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function ExpiryChart({ filas, titulo }) {
  const datos = useMemo(() => {
    const hoy = HOY();
    const mesHoy = hoy.slice(0, 7);
    const ultimo = sumarMes(mesHoy, HORIZONTE - 1);
    const d90 = new Date(`${hoy}T00:00:00Z`);
    d90.setUTCDate(d90.getUTCDate() + DIAS_POR_VENCER);
    const fin90 = d90.toISOString().slice(0, 10);
    const mes90 = fin90.slice(0, 7);

    const por = new Map();
    let despues = 0;
    let enVentana = 0; // exacto por fecha (la barra del mes 90 puede ser parcial)
    for (const r of filas) {
      const end = r.end_date ?? '';
      if (!end || end <= hoy) continue; // ya vencido: no va
      if (end <= fin90) enVentana += 1;
      const m = end.slice(0, 7);
      if (m > ultimo) despues += 1;
      else por.set(m, (por.get(m) ?? 0) + 1);
    }
    if (!por.size && !despues) return null;
    // Hasta el último mes con datos (sin cola vacía), mínimo 6 meses
    const conDatos = [...por.keys()].sort();
    const hasta = despues ? ultimo : (conDatos[conDatos.length - 1] ?? mesHoy);
    const meses = [];
    for (let m = mesHoy; m <= hasta || meses.length < 6; m = sumarMes(m, 1)) {
      meses.push(m);
      if (meses.length >= HORIZONTE) break;
    }
    const barras = meses.map(m => ({ m, v: por.get(m) ?? 0, ventana: m <= mes90 }));
    if (despues) barras.push({ m: 'later', v: despues, ventana: false, later: true });
    const total = barras.reduce((s, b) => s + b.v, 0);
    return { barras, max: Math.max(1, ...barras.map(b => b.v)), total, enVentana };
  }, [filas]);

  if (!datos) return null;
  const { barras, max, total, enVentana } = datos;
  const H = 150;
  return (
    <div className="bg-card rounded-lg border border-white/[0.08] p-4">
      <div className="flex items-baseline gap-3 flex-wrap mb-3">
        <p className="text-[10px] text-muted font-mono uppercase tracking-widest">{titulo} · upcoming</p>
        <span className="text-[10px] font-mono text-muted">
          <span className="inline-block w-2 h-2 rounded-sm bg-[#f59e0b] mr-1 align-middle" />
          renewal window ≤{DIAS_POR_VENCER}d · <span className="text-warning">{enVentana.toLocaleString()}</span>
          <span className="inline-block w-2 h-2 rounded-sm bg-[#38bdf8] ml-3 mr-1 align-middle" />
          later · <span className="text-slate-300">{(total - enVentana).toLocaleString()}</span>
        </span>
      </div>
      <div className="flex items-end gap-1" style={{ height: H + 40 }}>
        {barras.map(b => {
          const h = b.v ? Math.max(4, Math.round((b.v / max) * H)) : 0;
          const [y, mm] = b.later ? [] : b.m.split('-');
          const etiqueta = b.later ? 'later' : MES[Number(mm) - 1];
          const enero = !b.later && mm === '01';
          // En pantallas angostas solo se rotula cada trimestre (y la primera)
          const rotuloMovil = b.later || b === barras[0] || ['01', '04', '07', '10'].includes(mm);
          return (
            <div key={b.m} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full"
              title={b.later ? `${b.v} end more than ${HORIZONTE} months from now` : `${MES[Number(mm) - 1]} ${y}: ${b.v} ${b.v === 1 ? 'ends' : 'end'}`}>
              <span className={`text-[9px] sm:text-[10px] font-mono mb-0.5 ${b.v ? (b.ventana ? 'text-warning' : 'text-slate-300') : 'text-transparent'}`}>
                {b.v || '0'}
              </span>
              <div className="w-full rounded-t"
                style={{
                  height: h,
                  background: b.later ? 'repeating-linear-gradient(135deg,#38bdf8 0 4px,#38bdf855 4px 8px)'
                    : b.ventana ? '#f59e0b' : '#38bdf8',
                  opacity: 0.9,
                }} />
              <span className={`mt-1 text-[9px] sm:text-[10px] font-mono leading-tight text-center ${rotuloMovil ? '' : 'invisible sm:visible'} ${enero ? 'text-slate-300' : 'text-muted'}`}>
                {etiqueta}
                <span className="block text-[9px] opacity-70">{(enero || b === barras[0]) && !b.later ? y : '\u00a0'}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
