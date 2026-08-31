// Programa PepsiCo — datos de la orden cargados a mano (2026-08-27).
// Fuente: kit list de PepsiCo + POs de Peak Technologies.
// qty_shipped se actualiza a mano hasta que el programa termine.
export const PEPSI = {
  customer: 'PepsiCo',
  reseller: 'Peak Technologies',
  program: 'WES Navigator 520 deployment',
  total_kits: 1537,
  currency: 'USD',
  purchase_orders: [
    {
      po_number: 'POINC110038312', date: '2026-08-05', kits: 855, tranche: 'Q4 2026',
      total: 1612209.40,
      amendment_pending: 'expedite fee $200 + Workband price correction',
    },
    {
      po_number: 'POINC110039090', date: '2026-08-11', kits: 682, tranche: 'Q1 2027',
      total: 1303707.90,
      ship_not_before: '2026-11-01',
    },
  ],
  items: [
    {
      // OJO: en NetSuite/Supabase el SKU es con asterisco
      sku: '127128*', name: 'RealWear Navigator 520',
      description: 'Head Mounted Tablet Navigator 520, 720P display, incl. Workband 2 + USB-C cable. Model T21G',
      category: 'device', uom: 'EA', unit_price: 1717.20, serialized: true,
      qty_per_kit: 1, qty_required: 1537,
      qty_by_po: { POINC110038312: 855, POINC110039090: 682 },
      qty_ordered_total: 1537, qty_shipped: 455, status: 'confirmed',
      note: '26 additional units shipped to Pepsi spare pool outside these POs (SO20129: 1, SO20150: 25)',
    },
    {
      sku: '127108', name: 'Battery Pack Navigator 500 Series',
      description: 'Single spare battery pack',
      category: 'accessory', uom: 'EA', unit_price: 108.00, serialized: false,
      qty_per_kit: 1, qty_required: 1537,
      qty_by_po: { POINC110038312: 844, POINC110039090: 682 },
      qty_ordered_total: 1526, qty_shipped: 0, status: 'confirmed',
      note: '11 units short of kit requirement',
    },
    {
      sku: '127149', name: '3M Headband Clips 2PC',
      description: 'Navigator 3M 9100 headband device mounting clips, 1 pair per unit',
      category: 'accessory', uom: 'PAIR', unit_price: 14.00, serialized: false,
      qty_per_kit: 1, qty_required: 1537,
      qty_by_po: { POINC110038312: 644, POINC110039090: 690 },
      qty_ordered_total: 1334, qty_shipped: 0, status: 'confirmed',
      note: "Kit list says '2 clips per kit'; assumes 1 pair per kit. If 2 pairs, requirement is 3074",
    },
    {
      sku: '127105', name: '4x Multi Battery Charger',
      description: '4-bay multi battery charger, Navigator 500 Series. Requires PD charger (9V/4A or 12V/3A), not included',
      category: 'accessory', uom: 'EA', unit_price: 234.00, serialized: false,
      qty_per_kit: 0.275, qty_required: 423,
      qty_by_po: { POINC110038312: 150, POINC110039090: 180 },
      qty_ordered_total: 330, qty_shipped: 0, status: 'confirmed',
      note: '93 units short of kit requirement',
      // La PO de reposicion abierta esta en riesgo: el chip del cargador es
      // EOL. No se cuenta como stock entrante en el calculo de cobertura.
      incoming_at_risk: true,
      incoming_risk_note: 'Incoming PO at risk — charger chip is EOL, may not arrive',
    },
    {
      sku: '127125', name: 'Workband 2',
      description: 'Workband 2, HMT-1 / Navigator 500 Series',
      category: 'accessory', uom: 'EA', unit_price: 10.35, serialized: false,
      qty_per_kit: null, qty_required: null,
      qty_by_po: { POINC110038312: 844, POINC110039090: 690 },
      qty_ordered_total: 1534, qty_shipped: 0, status: 'on_po_unconfirmed',
      note: 'On both POs but absent from PepsiCo kit list. Price to be corrected in amended PO. Navigator 520 already includes a Workband 2',
    },
    {
      sku: '127129', name: '65W USB-C Charger',
      description: 'Power supply for the 4x multi battery charger',
      category: 'accessory', uom: 'EA', unit_price: null, serialized: false,
      qty_per_kit: 0.275, qty_required: 423,
      qty_by_po: {},
      qty_ordered_total: 0, qty_shipped: 0, status: 'required_not_ordered',
      note: 'Required by kit list (0.275/kit) but missing from both POs. Price not yet quoted to Peak',
    },
  ],
};
