import { supabase, paginar } from '../lib/supabase';

// Sell-out de los distribuidores (tabla sellout_devices, cargada por el
// pipeline desde el Excel "Sale Out data" de Channel Ops). Es la ÚNICA fuente
// que dice quién usa un equipo cuando NetSuite y Launchpad no lo saben: el
// disti reporta por mail reseller y end customer de cada serial que vendió.
//
// Se usa como RELLENO, nunca como verdad primera: si NetSuite (línea de la SO /
// factura) o Launchpad tienen end customer, ese gana. Lo que viene de acá se
// marca `per sell-out` en pantalla y en los exports, porque es un reporte
// manual del distribuidor, no un dato de sistema.

export const SELLOUT_LABEL = 'per sell-out';
export const SELLOUT_TITLE = 'Reported by the distributor in its monthly sell-out report (Channel Ops Excel) — not recorded in NetSuite or Launchpad';

// serial (mayúsculas) → fila del sell-out. Tolerante: si la tabla no existe o
// Supabase falla, devuelve un mapa vacío y las páginas siguen igual que antes.
export async function fetchSelloutMap() {
  try {
    const filas = await paginar(() => supabase.from('sellout_devices')
      .select('serial, distributor, reseller, end_customer, date_sold, sku, ns_match, ns_serial'));
    const m = new Map();
    for (const r of filas) {
      const k = (r.serial ?? '').trim().toUpperCase();
      if (k) m.set(k, r);
    }
    return m;
  } catch {
    return new Map();
  }
}

export function selloutDe(mapa, serial) {
  return mapa?.get((serial ?? '').trim().toUpperCase()) ?? null;
}

// Cómo leer ns_match (lo calcula el pipeline, subir_sellout._match_netsuite).
export const NS_MATCH = {
  shipped: null, // normal: el serial salió de NetSuite — no se marca
  typo: { label: 'serial typo?', title: s => `Not in NetSuite as written. NetSuite has ${s.ns_serial} (same ending) — the distributor probably mistyped it`, cls: 'bg-warning/15 text-warning' },
  invoice_only: { label: 'invoice only', title: () => 'Not shipped in NetSuite: the serial is only typed in the "Serial Numbers" column of an invoice, there is no fulfillment with it (inventory detail missing)', cls: 'bg-danger/15 text-danger' },
  not_found: { label: 'not in NetSuite', title: () => 'This serial does not exist anywhere in NetSuite (no fulfillment, no invoice, no plan). Check the report with the distributor', cls: 'bg-danger/15 text-danger' },
};
