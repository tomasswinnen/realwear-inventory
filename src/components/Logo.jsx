// Marca oficial de RealWear (extraída del logo del sitio realwear.com).
// Se pinta con currentColor, así toma el color del contexto.
export function LogoMark({ className = 'w-6 h-6' }) {
  return (
    <svg className={className} viewBox="0 0 156.9 135.3" fill="currentColor" aria-hidden="true">
      <path d="M27.7 131.1h31.7l19-14.4 19 14.4h31.8L78.4 90.5z" />
      <path d="M116.5 4.2 78.4 36 40.3 4.2h-38v104.1l25.4 22.8V25.4L53 46.5v40.6l25.4-19.4 25.4 19.4V46.5l25.3-21.1.1 105.7 25.3-22.8V4.2z" />
    </svg>
  );
}
