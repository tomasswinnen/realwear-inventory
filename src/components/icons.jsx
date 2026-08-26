// Set propio de íconos de trazo (24×24) para la navegación — consistente,
// nítido en pantallas retina y sin depender de emojis del sistema.
const PATHS = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </>
  ),
  forecast: (
    <>
      <path d="M3.5 4v15a1.5 1.5 0 0 0 1.5 1.5h15.5" />
      <path d="M7 15.5l4-5 3.5 2.5 5-6.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8 20.5 20.5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.2 21 19.3H3z" />
      <path d="M12 10v4.2" />
      <path d="M12 16.6v.01" strokeWidth="2.4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-5.4-6.5-10.6a6.5 6.5 0 1 1 13 0C18.5 15.6 12 21 12 21z" />
      <circle cx="12" cy="10.2" r="2.3" />
    </>
  ),
  trend: (
    <>
      <path d="M3.5 7l6 6.5 3.5-3.5 7.5 7.5" />
      <path d="M20.5 12.6v4.9h-4.9" />
    </>
  ),
  swap: (
    <>
      <path d="M20 7.5H4.5M8 4l-3.5 3.5L8 11" />
      <path d="M4 16.5h15.5M16 13l3.5 3.5L16 20" />
    </>
  ),
  box: (
    <>
      <path d="M12 3.2 20 7.6v8.8l-8 4.4-8-4.4V7.6z" />
      <path d="M12 12 20 7.6M12 12 4 7.6M12 12v8.8" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5.5" y="4.5" width="13" height="16" rx="2" />
      <rect x="9" y="3" width="6" height="3.2" rx="1.2" />
      <path d="M9 10.5h6M9 14h6M9 17.5h3.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2.2" />
    </>
  ),
  receipt: (
    <>
      <path d="M6.5 3.5h11V20l-2.2-1.6-2.1 1.6-1.2-.9-1.2.9-2.1-1.6L6.5 20z" />
      <path d="M9.5 8h5M9.5 11.5h5M9.5 15h3" />
    </>
  ),
  archive: (
    <>
      <rect x="3.5" y="4" width="17" height="4.5" rx="1.2" />
      <path d="M5.5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5" />
      <path d="M10 12.5h4" />
    </>
  ),
  dollar: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v10M14.6 9.3c-.5-.9-1.5-1.4-2.6-1.4-1.4 0-2.6.8-2.6 2.1s1.3 1.8 2.6 2.1c1.3.2 2.6.8 2.6 2.1s-1.2 2.1-2.6 2.1c-1.1 0-2.1-.5-2.6-1.4" />
    </>
  ),
  percent: (
    <>
      <path d="M6 18 18 6" />
      <circle cx="7.5" cy="7.5" r="2.2" />
      <circle cx="16.5" cy="16.5" r="2.2" />
    </>
  ),
  store: (
    <>
      <path d="M4.5 9 6 4h12l1.5 5" />
      <path d="M4.5 9h15" />
      <path d="M5.5 9v10.5h13V9" />
      <path d="M10 19.5V14h4v5.5" />
    </>
  ),
  calc: (
    <>
      <rect x="5.5" y="3.5" width="13" height="17" rx="2" />
      <path d="M9 7.5h6" />
      <path d="M9 12h.01M12 12h.01M15 12h.01M9 15.5h.01M12 15.5h.01M15 15.5h.01" strokeWidth="2.4" />
    </>
  ),
  hash: (
    <>
      <path d="M9.8 4.5 8 19.5M16 4.5l-1.8 15M4.8 9.3h15M4.2 14.7h15" />
    </>
  ),
  more: (
    <>
      <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3.4" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.7 3.8v3.4h-3.4" />
    </>
  ),
  signout: (
    <>
      <path d="M14 4.5H7A1.5 1.5 0 0 0 5.5 6v12A1.5 1.5 0 0 0 7 19.5h7" />
      <path d="M10.5 12h9M16.5 8.5 20 12l-3.5 3.5" />
    </>
  ),
  x: (
    <>
      <path d="M6 6l12 12M18 6 6 18" />
    </>
  ),
};

export function Icon({ name, className = 'w-5 h-5', strokeWidth = 1.8 }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name] ?? PATHS.dashboard}
    </svg>
  );
}
