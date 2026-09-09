import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 1420, strictPort: true },
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
