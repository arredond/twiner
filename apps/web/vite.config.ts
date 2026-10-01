import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
  // The docs site (apps/docs) is served under /docs: in production from
  // this build's dist/docs/ (see package.json's build:docs), locally by its
  // own dev server, which bin/twiner starts and points this proxy at.
  server: process.env.TWINER_DOCS_PORT
    ? {
        proxy: {
          '/docs': { target: `http://localhost:${process.env.TWINER_DOCS_PORT}`, ws: true },
        },
      }
    : {},
})
