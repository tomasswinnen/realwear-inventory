import { useEffect, useState } from 'react';

// true cuando el viewport es angosto (teléfono). Sigue los cambios de tamaño.
export function useIsMobile(bp = 640) {
  const [esMobile, setEsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(`(max-width: ${bp - 1}px)`).matches);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp - 1}px)`);
    const onChange = e => setEsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [bp]);

  return esMobile;
}
