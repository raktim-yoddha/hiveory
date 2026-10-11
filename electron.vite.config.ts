import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { build, type Plugin } from 'vite'

const shared = { '@shared': resolve(import.meta.dirname, 'src/shared') }
const resources = { '@resources': resolve(import.meta.dirname, 'resources') }

/**
 * hiveoryd, the host daemon (ADR 0022), as one self-contained file: out/main/host.js. It also
 * runs on remote machines where only it and node-pty are installed, so it is built on its own
 * after main (never sharing main's chunks); only Node built-ins and node-pty stay external.
 */
const hostDaemon = (): Plugin => ({
  name: 'hiveory-host-daemon',
  apply: 'build',
  async closeBundle() {
    await build({
      configFile: false,
      logLevel: 'warn',
      resolve: { alias: shared },
      ssr: { noExternal: true },
      build: {
        ssr: resolve(import.meta.dirname, 'src/host/main.ts'),
        outDir: resolve(import.meta.dirname, 'out/main'),
        emptyOutDir: false,
        target: 'node20',
        minify: false,
        reportCompressedSize: false,
        rollupOptions: {
          external: ['@lydell/node-pty', /^node:/],
          output: { format: 'es', entryFileNames: 'host.js', inlineDynamicImports: true }
        }
      }
    })
  }
})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), hostDaemon()],
    resolve: { alias: { ...shared, ...resources } }
  },
  preload: {
    resolve: { alias: shared },
    // Sandboxed preloads must be a single CJS file: bundle everything except Electron itself.
    build: { rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    // electron-vite leaves builds unminified; the renderer is parsed on every window start, so it is
    // minified (ADR 0044). Main and preload stay readable for stack traces in the log.
    build: { minify: true },
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
