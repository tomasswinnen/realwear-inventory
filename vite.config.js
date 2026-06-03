import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// es-toolkit compat files are CJS shims (module.exports = require(...).X).
// Rollup's CJS interop wraps them in lazy factories, which generates
// `var require_X = require_X()` inside arrow-function callbacks — a var-hoisting
// collision that crashes in production. This plugin converts the shims to ESM
// so Rollup never needs to apply CJS interop for them.
function esToolkitCompatToEsm() {
  return {
    name: 'es-toolkit-compat-to-esm',
    transform(code, id) {
      if (!id.includes('es-toolkit') || !id.includes('/compat/') || !id.endsWith('.js')) return
      const m = code.match(/module\.exports\s*=\s*require\(['"]([^'"]+)['"]\)\.(\w+)/)
      if (!m) return
      const [, requirePath, exportName] = m
      const mjsPath = requirePath.replace(/\.js$/, '.mjs')
      return { code: `export { ${exportName} as default } from '${mjsPath}';`, map: null }
    },
  }
}

export default defineConfig({
  plugins: [react(), esToolkitCompatToEsm()],
  build: {
    minify: 'terser',
  },
})
