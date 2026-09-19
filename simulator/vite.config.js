import { defineConfig } from 'vite'

// base './' so the built dist/ folder also runs from a file:// path,
// which is how the demo machine will open it if there is no server.
export default defineConfig({
  base: './',
  build: { target: 'es2020', assetsInlineLimit: 0 },
  server: { host: true }
})
