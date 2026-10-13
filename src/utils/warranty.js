// Estado de una cobertura de service plan. Las fechas vienen YYYY-MM-DD de
// Supabase, así que se comparan como texto: nada de Date ni de husos horarios
// (un new Date('2026-10-13') se interpreta en UTC y en Portland mostraría el
// día anterior).

export const HOY = () => new Date().toISOString().slice(0, 10);

// Una cobertura entra en "expiring" dentro de los 90 días previos al fin: es
// la ventana con la que Supply Chain puede hacer algo (renovar, avisarle al
// distribuidor) antes de que el equipo quede descubierto.
export const DIAS_POR_VENCER = 90;

export function diasHasta(iso, hoy = HOY()) {
  if (!iso) return null;
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / MS);
}

export function estadoGarantia(endDate, hoy = HOY()) {
  if (!endDate) return 'none';
  if (endDate <= hoy) return 'expired';
  return diasHasta(endDate, hoy) <= DIAS_POR_VENCER ? 'expiring' : 'active';
}

export const ESTADO_LABEL = {
  active: 'In warranty',
  expiring: 'Expiring',
  expired: 'Expired',
  none: 'No plan',
};

export const ESTADO_STYLE = {
  active: 'bg-success/10 text-success',
  expiring: 'bg-warning/10 text-warning',
  expired: 'bg-danger/10 text-danger',
  none: 'bg-white/10 text-white/50',
};

// Quién es el cliente de verdad. `customer` es a quién se le facturó, que muy
// seguido es un distribuidor; `end_customer` es el usuario final, cargado a
// mano en NetSuite. Cuando falta, lo único que se sabe es el distribuidor —
// y se dice, en vez de hacerlo pasar por cliente final.
export function clienteFinal(fila) {
  const ec = (fila?.end_customer ?? '').trim();
  return ec || null;
}

// Los nombres de cuenta de NetSuite vienen con el número de cliente adelante
// ("30683 Westbase B.V."). Para mostrar sobra.
export function nombreCuenta(customer) {
  return (customer ?? '').replace(/^\d+\s+/, '') || '—';
}
