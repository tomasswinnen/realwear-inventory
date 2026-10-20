import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase env vars not set. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local');
}

export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder'
);

// PostgREST corta en 1000 filas por respuesta aunque pidas más, así que
// cualquier tabla que pueda pasar de mil filas se trae por páginas con Range.
// `armar` tiene que devolver una query NUEVA en cada llamada (el builder de
// supabase-js no se puede reusar después de ejecutarlo).
// La primera página va sola (las tablas chicas terminan ahí); si vino llena,
// las siguientes se piden de a PARALELO: antes iban una atrás de otra y una
// tabla de 20 páginas eran 20 viajes al servidor en fila.
const PARALELO = 5;
export async function paginar(armar, { pagina = 1000, tope = 50000 } = {}) {
  const primera = await armar().range(0, pagina - 1);
  if (primera.error) throw new Error(primera.error.message);
  const filas = [...(primera.data ?? [])];
  if (filas.length < pagina) return filas;
  for (let desde = pagina; desde < tope; desde += pagina * PARALELO) {
    const tanda = [];
    for (let i = 0; i < PARALELO && desde + i * pagina < tope; i++) {
      const d = desde + i * pagina;
      tanda.push(armar().range(d, d + pagina - 1));
    }
    const res = await Promise.all(tanda);
    let corto = false;
    for (const r of res) {
      if (r.error) throw new Error(r.error.message);
      const lote = r.data ?? [];
      filas.push(...lote);
      if (lote.length < pagina) { corto = true; break; }
    }
    if (corto) break;
  }
  return filas;
}

// SKUs permanently excluded from all pages and queries.
export const EXCLUDED_SKUS = ['171026', '171033', '127160*', '171016', '171012'];
// Chained .neq() instead of not.in so special chars (e.g. *) aren't misread by PostgREST.
export const excludeSkus = (q) =>
  EXCLUDED_SKUS.reduce((acc, sku) => acc.neq('sku', sku), q);
