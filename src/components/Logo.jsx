// Marca oficial de RealWear — assets de brand 2026 (Brand Mark y Wordmark,
// archivos __RealWear_*_RGB.svg en la raíz del repo). Se pintan con
// currentColor, así toman el color del contexto. Ambos son más anchos que
// altos: usar h-* + w-auto para no deformarlos.

// Monograma "RW" (Brand Mark). Relación de aspecto ~1.48:1.
export function LogoMark({ className = 'h-6 w-auto' }) {
  return (
    <svg className={className} viewBox="0 0 591.4 400" fill="currentColor" aria-hidden="true">
      <path d="M577.7,190.3h0s0,0,0,0ZM0,196.6v74.3h129.1v-74.3H0ZM491.4,262.8l86.3-72.6h0v-110.8L484,0H129.1v196.6s86.8,0,86.8,0v-122.3h228.6l46.3,38.3v45.7l-46.3,38.3h-228.6v74.3h-86.8v129.1h86.8v-129.1h173.2l114.3,129.1h88v-26.9l-100-110.3Z" />
    </svg>
  );
}

// Wordmark "REALWEAR" completo. Relación de aspecto ~10.8:1.
export function LogoWordmark({ className = 'h-5 w-auto' }) {
  return (
    <svg className={className} viewBox="0 0 4331.2 400" fill="currentColor" aria-label="RealWear">
      <path d="M740.2,232.5h262.3v-68.5h-262.3v-89.7h342.3V0h-429.2v400h436.6v-74.3h-349.7v-93.2ZM1344.5,0l-209.1,373.1v26.8h81.7l48-87.5h274.8l47.5,87.5h84v-26.8L1461.7,0h-117.2ZM1305.7,238.2l90.3-165.7h13.7l89.7,165.7h-193.7ZM1803.7,0h-86.8v400h374.8v-76.5h-288V0ZM2891.9,232.5h262.3v-68.5h-262.3v-89.7h342.3V0h-429.1v400h436.6v-74.3h-349.7v-93.2ZM3496.3,0l-209.1,373.1v26.8h81.7l48-87.5h274.8l47.4,87.5h84v-26.8L3613.4,0h-117.2ZM3457.4,238.2l90.3-165.7h13.7l89.7,165.7h-193.7ZM4317.4,190.3v-110.8L4223.8,0h-354.9v400h86.8v-129.1h173.2l114.3,129.1h88v-26.8l-100-110.3,86.3-72.5ZM4230.6,158.3l-46.3,38.3h-228.6v-122.3h228.6l46.3,38.3v45.7ZM577.7,190.3h0s0,0,0,0ZM577.7,190.3h0v-110.8L484,0H129.1v196.6s86.8,0,86.8,0v-122.3h228.6l46.3,38.3v45.7l-46.3,38.3h-228.6v74.3h-86.8v129.1h86.8v-129.1h173.2l114.3,129.1h88v-26.9l-100-110.3,86.3-72.6ZM0,196.6v74.3h129.1v-74.3H0ZM2569.7,322.2h-17.9L2433.2.2h-61.2l-118.5,322.1h-17.9L2127.6,0h-81.6v26.8l130.1,373h133.9l86.9-232.2h11.5l86.9,232.2h133.9l130.1-373V0h-81.6l-108,322.2Z" />
    </svg>
  );
}
