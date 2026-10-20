// Programa PepsiCo — datos de la orden cargados a mano (act. 2026-10-19).
// Fuente: POs FINALES de Peak Technologies (Interim Price Agreement,
// "Peak / Pepsi Final Hardware POs" — versiones 9.2.26 F) + kit list PepsiCo.
// qty_shipped se actualiza a mano hasta que el programa termine.
export const PEPSI = {
  as_of: '2026-10-19',
  customer: 'PepsiCo',
  reseller: 'Peak Technologies',
  program: 'WES Navigator 520 deployment',
  total_kits: 1537,
  currency: 'USD',
  // Estado 10/19 (chat "Pepsi" de Teams + NetSuite): falta todo el segundo
  // tramo (682 kits) y sale en NOVIEMBRE 2026 (Tomas, 10/19): la PO lo llama
  // "Q1 2027" pero dice "no antes del 1/11". Peak todavia no confirmo el dia
  // exacto (Pam, 10/13); la PO de
  // hardware sigue sin SO en NetSuite. Los multi-chargers 127105 llegan del
  // proveedor ~15/12 (Kyle, 10/12). Peak mando PO aparte por 150 cargadores
  // 65W (SO20244, 9/23, facturada). SO20248/20290/20291 = 1 Navigator 520 a
  // $0 cada una, fuera de las POs del programa.
  // Estado 9/22: los 3 envios estan asentados en NetSuite (IF20405, IF20449,
  // IF20456/57/60) y SO20159 esta FACTURADA (Billed, $1,837,331). Al salir del
  // backlog abierto, el 'vivo' de la pagina da 0: mandan los qty_shipped
  // manuales de este archivo (855/855/700/180/855), que coinciden con lo
  // despachado. SO20195 quedo partida por tramo: 855 fulfilled + 682 open.
  // Estado 9/10: llego la Service PO de Peak -> SO20195 en NetSuite (9/2),
  // servicios para los 1,537 kits incl. ARIOS Cloud Ultra; fulfilled 9/10,
  // pending billing. La PO Q1 de hardware sigue sin cargarse en NetSuite.
  program_note: 'November 2026 shipment (682 kits): hardware PO not entered in NetSuite yet · Peak has not confirmed the exact date (Pam, 10/13)',
  service_order: {
    so_number: 'SO20195', date: '2026-09-02', total: 977716.44,
    detail: 'Warranty $385,940.70 · Support $195,045.30 · RMA pool $66,398.40 · ARIOS Cloud Ultra $330,332.04 — for all 1,537 kits · Q4 tranche (855) fulfilled 9/10 · November tranche (682) still open in NetSuite',
    // Lineas de 682 abiertas en SO20195 (SoLines, 10/19)
    open_kits: 682, open_amount: 433833.84,
  },
  // Mail de Timon (9/3) con los PDFs de las dos POs finales de hardware
  po_email: 'https://outlook.office365.com/owa/?ItemID=AAMkADEwZGQxZDU1LWY3YzUtNGZlZC1hZmE2LTg2MGRjYWU1OWRiNwBGAAAAAAATk%2F8Xj0YLTIdroYUHAFJ2BwAzCI4YJJD%2BTKdnqF547uDVAAAAAAEMAAAzCI4YJJD%2BTKdnqF547uDVAAGq%2BXqAAAA%3D&exvsurl=1&viewmodel=ReadMessageItem',
  // SOs cuyos seriales se listan en "Serial numbers shipped": las del
  // programa (en purchase_orders) + las de afuera (pool de repuestos y
  // unidades sueltas a $0 para Peak).
  other_sos: [
    { so_number: 'SO20129', label: 'spare pool' },
    { so_number: 'SO20150', label: 'spare pool' },
    { so_number: 'SO20248', label: 'single unit, $0' },
    { so_number: 'SO20290', label: 'single unit, $0' },
    { so_number: 'SO20291', label: 'single unit, $0' },
  ],
  purchase_orders: [
    {
      po_number: 'POINC110038312', date: '2026-08-05', kits: 855, tranche: 'Q4 2026',
      total: 1837331.00,
      // SO en NetSuite: con esto la pagina saca shipped/open en vivo del backlog
      so_number: 'SO20159',
      note: 'Final PO (9/2/26, incl. $171,000 expedite fee) — in NetSuite as SO20159 (8/28): fully shipped in 3 shipments and BILLED ($1.84M, 9/16)',
    },
    {
      // La PO lo llama "Q1 2027", pero el envio es en noviembre 2026
      po_number: 'POINC110039090', date: '2026-08-11', kits: 682, tranche: 'Nov 2026', po_label: 'Q1 2027',
      total: 1340036.40,
      ship_not_before: '2026-11-01',
      note: 'Final PO (9/2/26), labeled "Q1 2027" — ships in November 2026 (PO: not before 11/1) · not entered in NetSuite yet · 10/13 Peak: "schedule is not released", no date yet · next-shipment call with Nataly 10/19',
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
      qty_ordered_total: 1537, qty_shipped: 855, status: 'confirmed',
      note: 'Shipment 1 (SO-PEPSICO-BO, 8/28, FedEx 876425239864 = IF20405): 455 · Shipment 3 (SO-PEPSICO-BO2, 9/15, FedEx 383718639399 = IF20456/60): 400 — Q4 PO fully shipped & billed. Outside these POs: 26 spare-pool units (SO20129: 1, SO20150: 25)',
    },
    {
      sku: '127108', name: 'Battery Pack Navigator 500 Series',
      description: 'Single spare battery pack',
      category: 'accessory', uom: 'EA', unit_price: 108.00, serialized: false,
      qty_per_kit: 1, qty_required: 1537,
      qty_by_po: { POINC110038312: 855, POINC110039090: 682 },
      // Los 3 envios estan asentados y SO20159 facturada: la orden salio del
      // backlog abierto, asi que el 'vivo' (qty_ordered - qty_open) da 0 y
      // mandan estos numeros manuales, que son los despachados finales.
      qty_ordered_total: 1537, qty_shipped: 855, status: 'confirmed',
      note: 'Shipment 2 (SO-PEPSICO-BO1, 9/10, FedEx 383645658410 = IF20449): 455 · Shipment 3 (SO-PEPSICO-BO2, 9/15, FedEx 383718639399 = IF20456/60): 400 — Q4 PO fully shipped & billed',
    },
    {
      sku: '127149', name: '3M Headband Clips 2PC',
      description: 'Navigator 3M 9100 headband device mounting clips, 1 pair per unit',
      category: 'accessory', uom: 'PAIR', unit_price: 14.00, serialized: false,
      qty_per_kit: 1, qty_required: 1537,
      qty_by_po: { POINC110038312: 700, POINC110039090: 690 },
      qty_ordered_total: 1390, qty_shipped: 700, status: 'confirmed',
      note: "Shipment 2 (9/10 = IF20449): 455 · Shipment 3 (9/15 = IF20456/60): 245 — Q4 allocation (700) fully shipped & billed. Kit list says '2 clips per kit'; assumes 1 pair per kit",
    },
    {
      sku: '127105', name: '4x Multi Battery Charger',
      description: '4-bay multi battery charger, Navigator 500 Series. Requires PD charger (9V/4A or 12V/3A), not included',
      category: 'accessory', uom: 'EA', unit_price: 234.00, serialized: false,
      qty_per_kit: 0.275, qty_required: 423,
      qty_by_po: { POINC110038312: 180, POINC110039090: 180 },
      qty_ordered_total: 360, qty_shipped: 180, status: 'confirmed',
      note: '63 units short of kit requirement. Shipment 2 (9/10 = IF20449): 150 · Shipment 3 (9/15 = IF20456/60): 30 — Q4 allocation (180) fully shipped & billed. Stock left: 1 unit. 10/12 (Kyle): if Peak needs the devices before the chargers arrive, propose complimentary single battery chargers as a temporary fix, shipped HK → Portland. With the 682 kits going out in November and the chargers ~Dec 15, the stop-gap is needed',
      // La PO de reposicion abierta esta en riesgo: el chip del cargador es
      // EOL. No se cuenta como stock entrante en el calculo de cobertura.
      incoming_at_risk: true,
      incoming_risk_note: 'Incoming PO2407 (2,000 u, Sunrise Simcom, ordered 12/2025, still pending receipt): vendor estimates shipping ~Dec 15 (Kyle, 10/12) — charger chip is EOL',
    },
    {
      sku: '127125', name: 'Workband 2',
      description: 'Workband 2, HMT-1 / Navigator 500 Series',
      category: 'accessory', uom: 'EA', unit_price: 63.00, serialized: false,
      qty_per_kit: null, qty_required: null,
      qty_by_po: { POINC110038312: 855, POINC110039090: 690 },
      qty_ordered_total: 1545, qty_shipped: 855, status: 'confirmed',
      note: 'Shipment 2 (9/10 = IF20449): 455 · Shipment 3 (9/15 = IF20456/60): 400 — fully shipped & billed. Absent from PepsiCo kit list — Navigator 520 already includes a Workband 2. Most stock sits in HK: move to Portland before the November shipment',
    },
    {
      sku: '127129', name: '65W USB-C Charger',
      description: 'Power supply for the 4x multi battery charger',
      category: 'accessory', uom: 'EA', unit_price: null, serialized: false,
      qty_per_kit: 0.275, qty_required: 423,
      qty_by_po: {},
      // Fuera de las 2 POs: Peak mando una PO aparte -> SO20244
      other_orders: [{ so_number: 'SO20244', date: '2026-09-23', qty: 150, note: 'billed' }],
      qty_ordered_total: 150, qty_shipped: 150, status: 'partially_ordered',
      note: 'Not on the two Peak hardware POs — Peak sent a separate PO: SO20244 (9/23), 150 units, $5,130, billed. Kit requirement is 423 → 273 still not ordered. RealWear stock is fine (PO2452 fully received)',
    },
  ],
  // Lo ultimo del chat "Pepsi" de Teams (mas nuevo primero). Solo lo que
  // afecta envios / entregas; lo comercial (MSA, matriz de servicios) resumido.
  chat_url: 'https://teams.microsoft.com/l/message/19%3A035d2caf12094d598ae92c3de2d54b92%40thread.v2/1792358166203?context=%7b%22contextType%22%3a%22chat%22%7d&tenantId=3fb8c4c4-8d65-442d-8093-6d8790fc6b85',
  updates: [
    { date: '2026-10-19', text: 'Mon 10am EST: next-shipment discussion with Nataly · 12pm EST: finish the service matrix with Peak & Pepsi · Tue 10/20 1:30pm EST: service support alignment call with Gopal (Pepsi)' },
    { date: '2026-10-14', text: 'Peak (Pam) asks whether the devices already shipped in the "pilot" phase need service POs / entitlement — RealWear to answer this week' },
    { date: '2026-10-13', text: 'Peak (Pam): no date yet for the next shipment — "schedule is not released"' },
    { date: '2026-10-12', text: 'Multi-chargers (127105) expected from the vendor ~Dec 15. If Peak needs devices earlier, offer complimentary single battery chargers as a stop-gap, shipped HK → Portland' },
    { date: '2026-10-09', text: 'Service responsibility matrix reviewed with Pepsi & Peak; open points on Level 2 support, RMA and warranty registration' },
    { date: '2026-10-01', text: 'Pepsi: Peak bills RMA services directly; RealWear devices/warranty/cloud/support go through Peak; Pepsi wants steady-state pricing for 8,000 devices; services co-termed' },
    { date: '2026-09-23', text: 'Peak separate PO for 65W USB-C chargers → SO20244, 150 units, billed' },
  ],
};
