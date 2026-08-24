// Acepta dos formas en `date`:
//   'YYYY-MM-DD'                 -> solo día (columnas `date` de Supabase)
//   '2026-08-24T09:00:31.123Z'   -> día y hora (timestamptz)
//
// La distinción existe porque las columnas updated_at de inventory_snapshot,
// inventory_valuation, demand_forecast y distributor_stock son de tipo `date`
// en Supabase: de ahí no hay hora que mostrar. La hora real de la corrida sale
// de la tabla pipeline_runs (ver SQL_pipeline_runs.sql en la carpeta del
// pipeline).
function tieneHora(s) {
  return !!s && !/^\d{4}-\d{2}-\d{2}$/.test(String(s));
}

function parseWhen(s) {
  if (!s) return null;
  // Una fecha sola se interpreta a medianoche LOCAL. Sin el 'T00:00:00'
  // JavaScript la toma como UTC y, según la zona horaria, algo de "hoy" puede
  // aparecer como "1 day ago".
  const d = tieneHora(s) ? new Date(s) : new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

function daysAgo(dateStr) {
  const d = parseWhen(dateStr);
  if (!d) return null;
  // Se comparan días de calendario, no bloques de 24 horas: algo de ayer a las
  // 23:00 visto hoy a las 09:00 son 10 horas, pero corresponde "1 day ago".
  // Antes era Math.floor(ms / 86400000), que en ese caso decía "today".
  const hoy = new Date();
  const a = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.max(0, Math.round((a - b) / 86400000));
}

function hhmm(dateStr) {
  if (!tieneHora(dateStr)) return null;
  const d = parseWhen(dateStr);
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
}

function freshnessDotClass(days) {
  if (days == null) return 'bg-muted';
  if (days <= 3) return 'bg-success';
  if (days <= 14) return 'bg-warning';
  return 'bg-danger';
}

function freshnessTextClass(days) {
  if (days == null) return 'text-muted';
  if (days <= 3) return 'text-slate-300';
  if (days <= 14) return 'text-warning';
  return 'text-danger';
}

function freshnessLabel(days) {
  if (days == null) return 'no data';
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

/**
 * sources: [{ label: string, date: 'YYYY-MM-DD' | ISO timestamp | null }]
 */
export function DataFreshness({ sources }) {
  return (
    <div className="flex items-center gap-4 flex-wrap text-[11px] font-mono">
      {sources.map(s => {
        const days = daysAgo(s.date);
        const hora = hhmm(s.date);
        return (
          <span
            key={s.label}
            className="flex items-center gap-1.5"
            title={s.date ? (parseWhen(s.date)?.toLocaleString() ?? undefined) : undefined}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${freshnessDotClass(days)}`} />
            <span className="text-muted">{s.label}:</span>
            <span className={freshnessTextClass(days)}>
              {freshnessLabel(days)}
              {hora && <span className="text-muted"> · {hora}</span>}
            </span>
          </span>
        );
      })}
    </div>
  );
}
