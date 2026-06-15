export function isValidSku(sku) {
  if (!sku) return false;
  const s = String(sku);
  if (s.includes(':')) return false;
  if (s.startsWith('EarBud') || s.startsWith('Flash Drive')) return false;
  return true;
}

export function calcMonthsCoverage(onHand, avgMonthlySales) {
  if (!avgMonthlySales || avgMonthlySales <= 0) return Infinity;
  return onHand / avgMonthlySales;
}

export function coverageColor(months) {
  if (!isFinite(months)) return '#22c55e';
  if (months < 1) return '#ef4444';
  if (months < 3) return '#f59e0b';
  return '#22c55e';
}

export function coverageLabel(months) {
  if (!isFinite(months)) return '∞';
  return months.toFixed(1);
}

export function coverageTailwind(months) {
  if (!isFinite(months)) return 'text-success';
  if (months < 1) return 'text-danger';
  if (months < 3) return 'text-warning';
  return 'text-success';
}

export function coverageBg(months) {
  if (!isFinite(months)) return 'bg-success/10 text-success';
  if (months < 1) return 'bg-danger/10 text-danger';
  if (months < 3) return 'bg-warning/10 text-warning';
  return 'bg-success/10 text-success';
}

export function formatCurrency(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// Correct average over exactly n calendar months ending at anchorMonth.
// salesMap: { 'YYYY-MM-DD': qty }  anchorMonth: 'YYYY-MM-DD' most recent month in data.
// Months missing from salesMap contribute 0 — the denominator is always n.
export function avgMonthly(salesMap, anchorMonth, n) {
  if (!anchorMonth) return 0;
  let sum = 0;
  const [ay, am] = anchorMonth.slice(0, 7).split('-').map(Number);
  for (let i = 0; i < n; i++) {
    let mo = am - i, yr = ay;
    while (mo <= 0) { mo += 12; yr--; }
    sum += salesMap[`${yr}-${String(mo).padStart(2, '0')}-01`] ?? 0;
  }
  return sum / n;
}
