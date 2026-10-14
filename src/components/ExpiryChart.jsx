import { useMemo } from 'react';
import { HOY, DIAS_POR_VENCER } from '../utils/warranty';

// Vencimientos por mes, compartido por Subscriptions y Warranties (nació en el
// sandbox "DO NOT TOUCH"). Barras de un solo tono: pasado apagado, ventana de
// 90 días en ámbar, futuro en acento. Tooltip nativo por barra; etiquetas solo
// en los picos. Espera filas con `end_date` (YYYY-MM-DD).
export function ExpiryChart({ filas, titulo }) {
  const datos = useMemo(() => {
    const por = new Map();
    for (const r of filas) {
      const m = (r.end_date ?? '').slice(0, 7);
      if (m) por.set(m, (por.get(m) ?? 0) + 1);
    }
    const meses = [...por.keys()].sort();
    if (!meses.length) return null;
    const hoy = HOY();
    const d90 = new Date(`${hoy}T00:00:00Z`);
    d90.setUTCDate(d90.getUTCDate() + DIAS_POR_VENCER);
    return {
      meses, por, max: Math.max(...por.values()),
      mesHoy: hoy.slice(0, 7), mes90: d90.toISOString().slice(0, 7),
    };
  }, [filas]);

  if (!datos) return null;
  const { meses, por, max, mesHoy, mes90 } = datos;
  const bw = 24, gap = 2, H = 120, pad = 6;
  const W = pad * 2 + meses.length * (bw + gap);
  return (
    <div className="bg-card rounded-lg border border-white/[0.08] p-4">
      <p className="text-[10px] text-muted font-mono uppercase tracking-widest mb-2">{titulo}</p>
      <div className="overflow-x-auto">
        <svg width={W} height={H + 34} role="img" aria-label={titulo} className="block">
          {meses.map((m, i) => {
            const v = por.get(m);
            const h = Math.max(3, Math.round((v / max) * H));
            const x = pad + i * (bw + gap);
            const y = H - h + 6;
            const fill = m < mesHoy ? '#64748b' : m <= mes90 ? '#f59e0b' : '#38bdf8';
            return (
              <g key={m}>
                <rect x={x} y={y} width={bw} height={h} rx="3" fill={fill}
                  opacity={m < mesHoy ? 0.4 : 0.9}>
                  <title>{`${m}: ${v} ${v === 1 ? 'coverage ends' : 'coverages end'}`}</title>
                </rect>
                {v >= max * 0.6 && (
                  <text x={x + bw / 2} y={y - 4} textAnchor="middle"
                    className="fill-slate-400" fontSize="9" fontFamily="monospace">{v}</text>
                )}
                {i % 3 === 0 && (
                  <text x={x + bw / 2} y={H + 22} textAnchor="middle"
                    className="fill-slate-500" fontSize="8" fontFamily="monospace">{m}</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
