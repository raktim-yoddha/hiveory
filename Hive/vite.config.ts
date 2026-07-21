import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@hiveory/plugins': path.resolve(__dirname, '../HivePlugins/src'),
      '@hiveory/honeyflow': path.resolve(__dirname, '../HoneyFlow/src'),
      '@hiveory/hiveextension': path.resolve(__dirname, '../HiveExtension/src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
