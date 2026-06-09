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

// SKUs permanently excluded from all pages and queries.
export const EXCLUDED_SKUS = ['171026', '171033', '127160*'];
// Chained .neq() instead of not.in so special chars (e.g. *) aren't misread by PostgREST.
export const excludeSkus = (q) =>
  EXCLUDED_SKUS.reduce((acc, sku) => acc.neq('sku', sku), q);
