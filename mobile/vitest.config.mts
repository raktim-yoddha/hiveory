import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Logic tests (transport, stores, parsing, contract and theme parity) run in Node; screens are checked on devices.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, '..', 'src', 'shared'),
      '@': resolve(import.meta.dirname, 'src'),
      // Native modules have Node stand-ins; screens are checked on devices.
      'expo-secure-store': resolve(import.meta.dirname, 'src/test/expo-secure-store.ts'),
      'react-native': resolve(import.meta.dirname, 'src/test/react-native.ts')
    }
  },
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'], environment: 'node' }
})
