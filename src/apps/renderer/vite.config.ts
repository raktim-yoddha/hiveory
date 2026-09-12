import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const rendererRoot = import.meta.dirname
const privateRoot = resolve(rendererRoot, '../../../../hiveory-private')
const privateFeatures = resolve(privateRoot, 'src/features/index.tsx')
const devEdition = process.env.VITE_HIVEORY_EDITION === 'dev'
if (devEdition && !existsSync(privateFeatures)) {
  throw new Error(`Hiveory Dev requires the private sibling checkout at ${privateRoot}`)
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@hiveory/premium-features': devEdition ? privateFeatures : resolve(rendererRoot, 'src/app/premium-features.tsx'),
      '@hiveory/premium-theme-style': devEdition ? resolve(privateRoot, 'src/features/themes/theme.css') : resolve(rendererRoot, 'src/app/premium-theme-empty.css'),
      '@hiveory/public': resolve(rendererRoot, 'src'),
    },
    dedupe: ['react', 'react-dom', 'lucide-react'],
  },
  server: { port: 1420, strictPort: true, fs: { allow: [resolve(rendererRoot, '../../../..')] } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          icons: ['lucide-react'],
          richText: [
            '@tiptap/core',
            '@tiptap/extension-code',
            '@tiptap/extension-code-block-lowlight',
            '@tiptap/extension-details',
            '@tiptap/extension-image',
            '@tiptap/extension-link',
            '@tiptap/extension-placeholder',
            '@tiptap/extension-table',
            '@tiptap/extension-table-cell',
            '@tiptap/extension-table-header',
            '@tiptap/extension-table-row',
            '@tiptap/extension-task-item',
            '@tiptap/extension-task-list',
            '@tiptap/markdown',
            '@tiptap/react',
            '@tiptap/starter-kit',
            'lowlight',
            '@tiptap/extension-mathematics',
            'katex',
          ],
        },
      },
    },
  },
  test: { environment: 'jsdom' },
})
