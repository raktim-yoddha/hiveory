import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Renderer must never reach privileged APIs directly (AGENTS.md rule 4).
      'no-restricted-imports': [
        'error',
        { patterns: ['electron', 'node:*', 'child_process', 'fs', 'path', '@lydell/node-pty'] }
      ]
    }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'scripts/**/*.mjs', '*.config.ts', '*.config.js'],
    languageOptions: { globals: globals.node }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  }
)
