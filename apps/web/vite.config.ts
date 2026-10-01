import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The docs site (apps/docs) is served under /docs: in production from this
// build's dist/docs/ (see package.json's build:docs). Locally, bin/twiner
// runs its own dev server (TWINER_DOCS_PORT) and this redirects /docs there.
// A redirect, not a proxy: Astro's dev pages load their scripts from
// root paths (/@vite/client, /@id/..., /node_modules/...) that collide
// with this server's own, so proxied docs pages got the app's modules and
// their client-side controls (language picker, theme switch) broke.
function docsDevRedirect(port: string | undefined): Plugin {
  return {
    name: 'twiner-docs-dev-redirect',
    apply: 'serve',
    configureServer(server) {
      if (!port) return
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/docs' && !req.url?.startsWith('/docs/')) return next()
        res.statusCode = 302
        res.setHeader('Location', `http://localhost:${port}${req.url}`)
        res.end()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), docsDevRedirect(process.env.TWINER_DOCS_PORT)],
  // maplibre-gl bundles its rendering work into a separate worker file
  // that Vite's dependency pre-bundler doesn't resolve correctly by
  // default (observed: requests for maplibre-gl-worker.mjs hang, leaving
  // the map canvas blank with no console error) -- excluding it from
  // pre-bundling is the documented workaround.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  // ES-module output for DamageMap.tsx's `?worker&url` maplibre worker
  // import (the default, 'iife', can't hold the worker's own ESM imports).
  worker: {
    format: 'es',
  },
})
