// Región responsable de cada cobertura, derivada de la cuenta FACTURADA
// (warranties.customer): el distribuidor es el responsable comercial de la
// zona — Westbase cubre Europa, ScanSource Estados Unidos, JMACS Japón, etc.
//
// El mapa es por patrones sobre el nombre de cuenta de NetSuite. Una cuenta
// que no matchea ningún patrón cae en "Unassigned" y la página la muestra
// aparte en vez de adivinarle una zona: para sumar una cuenta nueva, agregar
// una línea acá. Patrones armados el 14/10/2026 con las cuentas reales del
// histórico de planes (Warranties.xls).

export const REGIONES = ['Americas', 'EMEA', 'APAC', 'Japan'];

const REGLAS = [
  // ── Americas ──────────────────────────────────────────────────────────
  [/nsw inc/i, 'Americas'],                 // NSW Inc. — distribuidor US
  [/scansource/i, 'Americas'],
  [/cb technologies/i, 'Americas'],
  [/ingram micro (?!india)/i, 'Americas'],  // US, Mexico, Canada (India va a APAC)
  [/ingram micro$/i, 'Americas'],
  [/peak technologies/i, 'Americas'],
  [/acuraflow/i, 'Americas'],               // Chile
  [/onvirtu/i, 'Americas'],
  [/realwear, inc/i, 'Americas'],           // ventas directas / internas
  [/hippo technologies/i, 'Americas'],
  [/white oak capital/i, 'Americas'],
  [/splashtop|pexip usa|atheer|intralox|reading bakery|voice directed tally/i, 'Americas'],

  // ── EMEA ──────────────────────────────────────────────────────────────
  [/westbase/i, 'EMEA'],                    // UK + B.V. (NL)
  [/\balso\b/i, 'EMEA'],                    // ALSO Deutschland, Finland, etc.
  [/elmark/i, 'EMEA'],
  [/amplicon/i, 'EMEA'],                    // Middle East
  [/barcotec/i, 'EMEA'],                    // Austria
  [/td synnex/i, 'EMEA'],                   // France
  [/tofna/i, 'EMEA'],                       // Turquía
  [/melchioni/i, 'EMEA'],                   // Italia
  [/overit/i, 'EMEA'],
  [/teamviewer/i, 'EMEA'],
  [/intoware/i, 'EMEA'],                    // UK
  [/xr works/i, 'EMEA'],                    // Sudáfrica
  [/pocket virtuality/i, 'EMEA'],           // Chequia
  [/brochesia|transtec/i, 'EMEA'],
  [/dekel technologic/i, 'EMEA'],           // Israel

  // ── APAC (sin Japón) ──────────────────────────────────────────────────
  [/exclusive networks/i, 'APAC'],          // Singapore + Australia
  [/commsplus|comms plus/i, 'APAC'],        // Australia
  [/alloys international/i, 'APAC'],        // Australia
  [/advansoft/i, 'APAC'],                   // Malasia
  [/sysgration/i, 'APAC'],                  // Taiwán
  [/tpm solutions/i, 'APAC'],               // Singapore
  [/structo/i, 'APAC'],                     // Singapore
  [/ingram micro india/i, 'APAC'],
  [/anand it|anadit/i, 'APAC'],             // India
  [/\bjll\b/i, 'APAC'],

  // ── Japan (distribuidores propios, aparte de APAC) ────────────────────
  [/jmacs/i, 'Japan'],
  [/mitsubishi/i, 'Japan'],                 // MMTS
  [/macnica/i, 'Japan'],
  [/nippon sokki/i, 'Japan'],
];

export function regionDe(customer) {
  const c = customer ?? '';
  for (const [re, region] of REGLAS) if (re.test(c)) return region;
  return 'Unassigned';
}
