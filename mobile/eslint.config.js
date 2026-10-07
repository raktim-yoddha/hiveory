// Lint = Expo's rules + the app's architecture (ADR 0027), so the boundaries hold by build, not by habit:
//   src/app       routes only: compose features, each through its public index
//   src/features  islands: a feature never imports another one (or a route)
//   src/core      shared infrastructure and UI: never knows a feature or a route
//   @shared/*     the desktop's contract: types only, except dependency-free modules
const fs = require('node:fs')
const path = require('node:path')
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')
const globals = require('globals')

const features = fs
  .readdirSync(path.join(__dirname, 'src', 'features'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

/** Desktop modules with no imports of their own: safe to bundle on the phone. */
const SHARED_AT_RUNTIME = ['domain/tailnet', 'domain/cli', 'domain/project', 'domain/workspace', 'ipc/remote']

// Climbing more than one folder must use the @/ alias, so the rules below see every crossing.
const noDeepRelative = { group: ['../../*'], message: 'Import across folders with @/… so boundaries stay checkable.' }

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', '.expo/*', 'src/core/terminal/terminal-html.generated.ts'] },
  { files: ['*.js', 'scripts/**/*.mjs'], languageOptions: { globals: globals.node } },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: `^@shared/(?!(${SHARED_AT_RUNTIME.join('|')})$)`,
              allowTypeImports: true,
              message: 'Only types come from the desktop (import type), except the dependency-free modules in eslint.config.js.'
            }
          ]
        }
      ]
    }
  },
  ...features.map((feature) => ({
    files: [`src/features/${feature}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: `^@/features/(?!${feature}(/|$))`, message: 'A feature never imports another feature; compose them in src/app.' },
            { group: ['@/app/*'], message: 'Features never import routes; navigate by path.' },
            noDeepRelative
          ]
        }
      ]
    }
  })),
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@/features/*', '@/app/*'], message: 'core is shared by every feature and never knows one.' }, noDeepRelative] }
      ]
    }
  },
  {
    files: ['src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['@/features/*/**'], message: "Use a feature through its index (its public API), not its files." }] }]
    }
  }
])
