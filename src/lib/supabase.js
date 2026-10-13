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
export async function paginar(armar, { pagina = 1000, tope = 50000 } = {}) {
  const filas = [];
  for (let desde = 0; desde < tope; desde += pagina) {
    const res = await armar().range(desde, desde + pagina - 1);
    if (res.error) throw new Error(res.error.message);
    const lote = res.data ?? [];
    filas.push(...lote);
    if (lote.length < pagina) break;
  }
  return filas;
}

// SKUs permanently excluded from all pages and queries.
export const EXCLUDED_SKUS = ['171026', '171033', '127160*', '171016', '171012'];
// Chained .neq() instead of not.in so special chars (e.g. *) aren't misread by PostgREST.
export const excludeSkus = (q) =>
  EXCLUDED_SKUS.reduce((acc, sku) => acc.neq('sku', sku), q);
