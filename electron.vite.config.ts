import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve(import.meta.dirname, 'src/shared') }
const resources = { '@resources': resolve(import.meta.dirname, 'resources') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { ...shared, ...resources } }
  },
  preload: {
    resolve: { alias: shared },
    // Sandboxed preloads must be a single CJS file: bundle everything except Electron itself.
    build: { rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: { ...shared, ...resources, '@renderer': resolve(import.meta.dirname, 'src/renderer/src') }
    }
  }
})
