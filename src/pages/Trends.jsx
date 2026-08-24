import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { ChartSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { SearchableSelect } from '../components/SearchableSelect';
import { formatCurrency } from '../utils/coverage';

// Valuación del inventario EN EL TIEMPO. Fuente: inventory_history, que el
// pipeline llena con una foto por SKU por día (y una fila __TOTAL__ por día).
// El total se lee de esa fila sintética: 1 fila por día en vez de descargar y
// sumar todas las filas por SKU, que superan el tope de 1000 de PostgREST en
// cuanto pasan unos días.
async function fetchTrends(sku) {
  const clave = sku || '__TOTAL__';
  const [histRes, skusRes] = await Promise.all([
    supabase.from('inventory_history').select('fecha, on_hand, inv_value')
      .eq('sku', clave).order('fecha', { ascending: true }).limit(730),
    excludeSkus(supabase.from('skus').select('sku, description')),
  ]);
  if (histRes.error) throw new Error(histRes.error.message);
  return { hist: histRes.data ?? [], skus: skusRes.data ?? [] };
}

const CHART_TOOLTIP_STYLE = {
  backgroundColor: '#162030',
  border: '1px solid rgba(148,163,184,0.12)',
  borderRadius: 6,
  fontSize: 12,
  fontFamily: 'DM Mono, monospace',
  color: '#e2e8f0',
};

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={CHART_TOOLTIP_STYLE} className="px-3 py-2">
      <p className="font-sans text-white text-xs mb-1">{label}</p>
      <p className="font-mono text-xs text-accent">{formatCurrency(d.inv_value)}</p>
      <p className="font-mono text-xs text-muted">{d.on_hand?.toLocaleString()} units</p>
    </div>
  );
}

export function Trends() {
  const [sku, setSku] = useState('');
  const { data, loading, error, refetch } = useQuery(() => fetchTrends(sku), [sku]);

  const { serie, kpis, skuOptions } = useMemo(() => {
    if (!data) return { serie: [], kpis: null, skuOptions: [] };
    const serie = data.hist.map(h => ({
      fecha: h.fecha,
      inv_value: h.inv_value ?? 0,
      on_hand: h.on_hand ?? 0,
    }));
    const primero = serie[0];
    const ultimo = serie[serie.length - 1];
    const delta = primero && ultimo ? ultimo.inv_value - primero.inv_value : null;
    const kpis = ultimo ? {
      actual: ultimo.inv_value,
      unidades: ultimo.on_hand,
      dias: serie.length,
      delta,
    } : null;
    const skuOptions = data.skus.map(s => ({
      value: s.sku, label: s.sku, description: s.description ?? undefined,
    }));
    return { serie, kpis, skuOptions };
  }, [data]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Inventory Trends</h1>
        <p className="text-xs text-muted font-mono mt-0.5">Valuation over time — one snapshot per day since 24 Aug 2026</p>
      </div>

      <div className="flex items-center gap-3">
        <SearchableSelect
          value={sku}
          onChange={setSku}
          options={skuOptions}
          placeholder="Total inventory"
          clearable
          clearLabel="Total inventory"
          className="w-56"
        />
      </div>

      {loading ? <KPISkeleton count={4} /> : kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label={sku ? `${sku} Value` : 'Inventory Value'} value={formatCurrency(kpis.actual)} />
          <KPICard label="Units" value={kpis.unidades.toLocaleString()} />
          <KPICard label="Days Tracked" value={kpis.dias} />
          <KPICard
            label="Change Over Period"
            value={kpis.delta != null ? `${kpis.delta >= 0 ? '+' : ''}${formatCurrency(kpis.delta)}` : '—'}
          />
        </div>
      )}

      {loading ? <ChartSkeleton /> : serie.length === 0 ? (
        <div className="bg-card rounded-lg border border-white/[0.08] p-8 text-center text-muted font-mono text-sm">
          No history yet — the chart builds itself one point per day as the pipeline runs.
        </div>
      ) : (
        <div className="bg-card rounded-lg border border-white/[0.08] p-4">
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={serie} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
              <XAxis dataKey="fecha" tick={{ fontSize: 10, fontFamily: 'DM Mono, monospace', fill: '#64748b' }} />
              <YAxis
                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 10, fontFamily: 'DM Mono, monospace', fill: '#64748b' }}
                width={56}
              />
              <Tooltip content={<TrendTooltip />} />
              <Line type="monotone" dataKey="inv_value" stroke="#38bdf8" strokeWidth={2} dot={serie.length < 45} />
            </LineChart>
          </ResponsiveContainer>
          {serie.length < 7 && (
            <p className="text-[10px] text-muted font-mono mt-2">
              History starts the day this feature shipped — give it a couple of weeks to become a real curve.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
