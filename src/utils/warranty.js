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

// Qué es cada plan, en humano. Los SKUs vienen de NetSuite (PLAZO_PLAN del
// pipeline). "Warranty" y "subscription" acá son lo mismo: un contrato de
// cobertura/soporte por tiempo vendido en la línea de la SO. WAR/SUPP/RMA
// suelen venir juntos en un mismo contrato grande (garantía + soporte + pool
// de reposición sobre la misma flota).
export const PLAN_LABEL = {
  'SSP-POP1Y': 'Service plan · point of purchase · 1y',
  'SSP-POP2Y': 'Service plan · point of purchase · 2y',
  'SSP-ADD1Y': 'Service plan · added later · 1y',
  'SSP-ADD2Y': 'Service plan · added later · 2y',
  'SSP-12': 'Service plan · 12 months',
  'SSP-24': 'Service plan · 24 months',
  'SSP-36': 'Service plan · 36 months',
  'SP-ADV1': 'Advanced service plan · 1y',
  'SP-ADV2': 'Advanced service plan · 2y',
  'SP-ADV3': 'Advanced service plan · 3y',
  'WAR-STD1Y': 'Standard warranty · 1y',
  'SUPP-STD1Y': 'Standard support · 1y',
  'RMA-POOL1YR': 'RMA replacement pool · 1y',
  'DEV-PRO-12': 'Device Pro subscription · 12 months',
};

export function planLabel(sku) {
  return PLAN_LABEL[sku] ?? sku ?? '';
}
