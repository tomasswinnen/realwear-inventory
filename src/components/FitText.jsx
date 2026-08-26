import { useLayoutEffect, useRef } from 'react';

// Texto de UNA línea que se achica solo para entrar en su contenedor, como el
// minimumScaleFactor de iOS. Nunca agranda por encima del tamaño natural, y
// nunca baja de `min` (fracción del tamaño natural); si aun así no entra,
// recorta con elipsis en vez de desbordar el cuadro.
export function FitText({ children, min = 0.6, className = '' }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ajustar = () => {
      el.style.fontSize = '';               // volver al tamaño natural y medir
      const contenedor = el.clientWidth;
      const texto = el.scrollWidth;
      if (texto > contenedor && contenedor > 0) {
        const base = parseFloat(getComputedStyle(el).fontSize);
        const k = Math.max(min, contenedor / texto);
        el.style.fontSize = `${base * k}px`;
      }
    };

    ajustar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children, min]);

  return (
    <span
      ref={ref}
      className={`block whitespace-nowrap overflow-hidden text-ellipsis ${className}`}
    >
      {children}
    </span>
  );
}
