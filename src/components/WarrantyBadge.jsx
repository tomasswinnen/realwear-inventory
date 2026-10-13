import { estadoGarantia, diasHasta, ESTADO_LABEL, ESTADO_STYLE, clienteFinal } from '../utils/warranty';

// Badge de cobertura, usado en Serials, SO History y Warranties. Muestra el
// estado y, al pasar el mouse, de dónde salió: plan, fechas, cliente final y
// si el inicio es estimado (cuando en NetSuite no cargaron sold_date).
export function WarrantyBadge({ w, compact = false }) {
  const estado = estadoGarantia(w?.end_date);
  if (estado === 'none') return null;
  const dias = diasHasta(w.end_date);
  const ec = clienteFinal(w);
  const detalle = [
    w.sku && `Plan ${w.sku}`,
    `${w.start_date} → ${w.end_date}`,
    w.start_source && w.start_source !== 'sold_date' && 'start date estimated from the SO date',
    ec ? `End customer: ${ec}` : 'End customer not recorded in NetSuite',
    w.so_number && `SO ${w.so_number}`,
  ].filter(Boolean).join('\n');

  return (
    <span title={detalle}
      className={`inline-flex items-center gap-1 whitespace-nowrap align-middle text-[10px] font-mono px-1.5 py-0.5 rounded ${ESTADO_STYLE[estado]}`}>
      {compact ? (estado === 'expired' ? '✕' : '✓') : ESTADO_LABEL[estado]}
      {!compact && (
        <span className="opacity-70">
          {estado === 'expired' ? w.end_date : `${w.end_date}${dias <= 90 ? ` · ${dias}d` : ''}`}
        </span>
      )}
      {w.start_source && w.start_source !== 'sold_date' && (
        <span className="opacity-60" title="Start date estimated from the SO date">~</span>
      )}
    </span>
  );
}
