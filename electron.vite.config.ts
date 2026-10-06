import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve(import.meta.dirname, 'src/shared') }
const resources = { '@resources': resolve(import.meta.dirname, 'resources') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { ...shared, ...resources } },
    // hiveoryd, the host daemon (ADR 0022), is a second library entry beside main: out/main/host.js.
    // (Library mode keeps electron-vite's externals: electron, Node built-ins and production deps.)
    build: {
      lib: {
        entry: { index: resolve(import.meta.dirname, 'src/main/index.ts'), host: resolve(import.meta.dirname, 'src/host/main.ts') },
        formats: ['es']
      }
    }
  },
  preload: {
    resolve: { alias: shared },
    // Sandboxed preloads must be a single CJS file: bundle everything except Electron itself.
    build: { rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    plugins: [
      react(),
      {
        // The dev server's hot-reload socket is the only reason the CSP allows ws://localhost; builds drop it.
        name: 'hiveory-csp',
        apply: 'build',
        transformIndexHtml: (html: string) => html.replace(' ws://localhost:*', '')
      }
    ],
    resolve: {
      alias: { ...shared, ...resources, '@renderer': resolve(import.meta.dirname, 'src/renderer/src') }
    }
  }
})
