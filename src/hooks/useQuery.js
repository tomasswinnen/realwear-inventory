import { useState, useEffect, useCallback, useRef } from 'react';

// useQuery con caché en memoria (dura mientras la pestaña esté abierta).
//
// Antes cada página volvía a bajar TODO cada vez que se entraba. Ahora:
//   · si ya se cargó hace menos de FRESCO_MS → se muestra al instante, sin
//     consultar;
//   · si se cargó hace más → se muestra lo guardado al instante y se
//     actualiza en segundo plano (stale-while-revalidate);
//   · la primera vez funciona como siempre (skeleton + consulta).
// Los datos cambian cada 2 horas (pipeline), así que 5 minutos de frescura
// no pierde nada. Después de guardar un seguimiento se llama invalidarCache()
// para que la próxima visita vuelva a consultar.
//
// La clave es la función de consulta (su nombre o su código) + los deps, así
// cada página/parámetro tiene su entrada sin tener que declarar una clave.
const FRESCO_MS = 5 * 60 * 1000;
const cache = new Map(); // clave → { data, at, promesa }

export function invalidarCache() {
  for (const e of cache.values()) e.at = 0;
}

function claveDe(fn, deps) {
  return `${fn.name || fn.toString()}|${JSON.stringify(deps)}`;
}

export function useQuery(queryFn, deps = []) {
  const clave = claveDe(queryFn, deps);
  const entrada = cache.get(clave);
  const [data, setData] = useState(entrada?.data ?? null);
  const [loading, setLoading] = useState(!entrada?.data);
  const [error, setError] = useState(null);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  const correr = useCallback(async (conSkeleton) => {
    if (conSkeleton) setLoading(true);
    setError(null);
    let e = cache.get(clave);
    if (!e) { e = { data: null, at: 0, promesa: null }; cache.set(clave, e); }
    // Si ya hay una consulta en vuelo para esta clave, se comparte
    if (!e.promesa) {
      e.promesa = (async () => {
        const result = await queryFn();
        e.data = result; e.at = Date.now();
        return result;
      })().finally(() => { e.promesa = null; });
    }
    try {
      const result = await e.promesa;
      if (vivo.current) setData(result);
    } catch (err) {
      if (vivo.current) setError(err?.message ?? 'Unknown error');
    } finally {
      if (vivo.current) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  useEffect(() => {
    const e = cache.get(clave);
    if (e?.data) {
      setData(e.data); setLoading(false);
      if (Date.now() - e.at > FRESCO_MS) correr(false); // refresca sin skeleton
    } else {
      setData(null);
      correr(true);
    }
  }, [clave, correr]);

  const refetch = useCallback(() => {
    const e = cache.get(clave);
    if (e) e.at = 0;
    return correr(true);
  }, [clave, correr]);

  return { data, loading, error, refetch };
}
