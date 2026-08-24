import { useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Link } from 'react-router-dom';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { ChartSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { formatCurrency, isValidSku } from '../utils/coverage';

// Resumen ejecutivo: el negocio en una pantalla — valor de inventario y su
// tendencia, backlog comprometido, compras en camino, margen y qué se está
// vendiendo. Pensado para gerencia: números primero, detalle en cada página.
async function fetchExecutive() {
  const [histRes, backlogRes, posRes, margRes, skusRes] = await Promise.all([
    supabase.from('inventory_history').select('fecha, on_hand, inv_value')
      .eq('sku', '__TOTAL__').order('fecha', { ascending: true }).limit(730),
    supabase.from('sales_backlog').select('so_number, qty_open, amount_open'),
    supabase.from('open_pos').select('amount_remaining, qty_open'),
    supabase.from('sku_margins').select('*'),
    excludeSkus(supabase.from('skus').select('sku, description')),
  ]);
  for (const r of [histRes, backlogRes, posRes, margRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  // Ventas mensuales: acumula meses × SKUs, paginar por las dudas
  const ventas = [];
  for (let desde = 0; desde < 5000; desde += 1000) {
    const res = await supabase.from('monthly_sales')
      .select('month, qty_sold').gt('qty_sold', 0)
      .range(desde, desde + 999);
    if (res.error) throw new Error(res.error.message);
    ventas.push(...(res.data ?? []));
    if ((res.data ?? []).length < 1000) break;
  }
  return {
    hist: histRes.data ?? [],
    backlog: backlogRes.data ?? [],
    pos: posRes.data ?? [],
    margenes: margRes.data ?? [],
    skus: skusRes.data ?? [],
    ventas,
  };
}

const TT_STYLE = {
  backgroundColor: '#162030', border: '1px solid rgba(148,163,184,0.12)',
  borderRadius: 6, fontSize: 12, fontFamily: 'DM Mono, monospace', color: '#e2e8f0',
};

export function Executive() {
  const { data, loading, error, refetch } = useQuery(fetchExecutive, []);

  const v = useMemo(() => {
    if (!data) return null;
    const descBySku = Object.fromEntries(data.skus.map(s => [s.sku, s.description]));

    const ultimo = data.hist[data.hist.length - 1];
    const hace30 = data.hist.length > 1
      ? data.hist[Math.max(0, data.hist.length - 31)] : null;
    const delta30 = ultimo && hace30 ? ultimo.inv_value - hace30.inv_value : null;

    const backlogAbierto = data.backlog.filter(r => (r.qty_open ?? 0) > 0);
    const backlogValor = backlogAbierto.reduce((s, r) => s + (r.amount_open ?? 0), 0);
    const backlogOrdenes = new Set(backlogAbierto.map(r => r.so_number)).size;

    const onOrder = data.pos.reduce((s, r) => s + (r.amount_remaining ?? 0), 0);

    const conVentas = data.margenes.filter(m => (m.revenue_90d ?? 0) > 0);
    const rev = conVentas.reduce((s, m) => s + m.revenue_90d, 0);
    const margenPonderado = rev
      ? conVentas.reduce((s, m) => s + (m.margin_pct ?? 0) * m.revenue_90d, 0) / rev
      : null;

    const topSkus = [...conVentas]
      .sort((a, b) => b.revenue_90d - a.revenue_90d).slice(0, 5)
      .map(m => ({ ...m, description: descBySku[m.sku] ?? '' }));

    const porMes = new Map();
    for (const r of data.ventas) {
      const mes = (r.month ?? '').slice(0, 7);
      if (!mes) continue;
      porMes.set(mes, (porMes.get(mes) ?? 0) + (r.qty_sold ?? 0));
    }
    const meses = [...porMes.entries()].sort().slice(-12)
      .map(([mes, unidades]) => ({ mes, unidades }));

    return {
      inventario: ultimo?.inv_value ?? null,
      delta30,
      serie: data.hist,
      backlogValor, backlogOrdenes, onOrder,
      margenPonderado, topSkus, meses, rev,
    };
  }, [data]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Executive Summary</h1>
        <p className="text-xs text-muted font-mono mt-0.5">The business at a glance — details live in each page</p>
      </div>

      {loading || !v ? <KPISkeleton count={4} /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard
            label="Inventory Value"
            value={v.inventario != null ? formatCurrency(v.inventario) : '—'}
            sub={v.delta30 != null ? `${v.delta30 >= 0 ? '+' : ''}${formatCurrency(v.delta30)} vs 30d ago` : 'trend builds daily'}
          />
          <KPICard label="Committed to Customers" value={formatCurrency(v.backlogValor)} sub={`${v.backlogOrdenes} open orders`} />
          <KPICard label="On Order (Purchases)" value={formatCurrency(v.onOrder)} sub="open POs remaining value" />
          <KPICard
            label="Blended Margin (90d)"
            value={v.margenPonderado != null ? `${v.margenPonderado.toFixed(1)}%` : '—'}
            sub={`on ${formatCurrency(v.rev)} revenue`}
          />
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {loading || !v ? <ChartSkeleton /> : (
          <div className="bg-card rounded-lg border border-white/[0.08] p-4">
            <p className="text-[10px] text-muted font-sans font-medium uppercase tracking-wider mb-2">Inventory value over time</p>
            {v.serie.length < 2 ? (
              <p className="text-xs text-muted font-mono py-10 text-center">
                One point per day — the curve builds itself as the pipeline runs.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={v.serie} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
                  <XAxis dataKey="fecha" tick={{ fontSize: 10, fontFamily: 'DM Mono, monospace', fill: '#64748b' }} />
                  <YAxis tickFormatter={x => `$${(x / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 10, fontFamily: 'DM Mono, monospace', fill: '#64748b' }} width={52} />
                  <Tooltip contentStyle={TT_STYLE} formatter={x => formatCurrency(x)} />
                  <Line type="monotone" dataKey="inv_value" stroke="#38bdf8" strokeWidth={2} dot={v.serie.length < 45} name="Value" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {loading || !v ? <ChartSkeleton /> : (
          <div className="bg-card rounded-lg border border-white/[0.08] p-4">
            <p className="text-[10px] text-muted font-sans font-medium uppercase tracking-wider mb-2">Units sold per month</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={v.meses} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="mes" tick={{ fontSize: 10, fontFamily: 'DM Mono, monospace', fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 10, fontFamily: 'DM Mono, monospace', fill: '#64748b' }} width={40} />
                <Tooltip contentStyle={TT_STYLE} cursor={{ fill: 'rgba(148,163,184,0.06)' }} />
                <Bar dataKey="unidades" fill="#38bdf8" radius={[3, 3, 0, 0]} name="Units" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {!loading && v && (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <p className="px-4 pt-3 pb-1 text-[10px] text-muted font-sans font-medium uppercase tracking-wider">
            Top sellers — last 90 days by revenue
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {['SKU', 'Units', 'Revenue', 'Avg Price', 'Margin'].map(h => (
                    <th key={h} className="px-4 py-1.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[9px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {v.topSkus.map(m => (
                  <tr key={m.sku} className="border-t border-white/[0.04]">
                    <td className="px-4 py-2 max-w-[340px]">
                      {isValidSku(m.sku)
                        ? <Link to={`/item/${m.sku}`} className="font-mono text-accent hover:text-accent/80">{m.sku}</Link>
                        : <span className="font-mono text-muted">{m.sku}</span>}
                      {m.description && <p className="text-[10px] text-muted font-sans truncate" title={m.description}>{m.description}</p>}
                    </td>
                    <td className="px-4 py-2 font-mono text-white">{(m.qty_90d ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2 font-mono text-white">{formatCurrency(m.revenue_90d)}</td>
                    <td className="px-4 py-2 font-mono text-slate-300">{formatCurrency(m.avg_price)}</td>
                    <td className="px-4 py-2 font-mono">
                      <span className={m.margin_pct < 0 ? 'text-danger' : m.margin_pct < 20 ? 'text-warning' : 'text-success'}>
                        {m.margin_pct != null ? `${m.margin_pct.toFixed(1)}%` : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
            Margin uses average cost as COGS proxy and excludes credit memos — directionally right, not accounting-grade.
          </p>
        </div>
      )}
    </div>
  );
}
