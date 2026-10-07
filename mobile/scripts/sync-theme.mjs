// Writes src/core/theme/palettes.ts from the desktop's tokens.css (see theme-from-desktop.mjs).
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopPalettes } from './theme-from-desktop.mjs'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core', 'theme', 'palettes.ts')
const body = `// Synced from the desktop's src/renderer/src/styles/tokens.css by \`pnpm sync:theme\`. Do not edit by hand.
// A test fails when the desktop's colors change and this file was not re-synced.
export const PALETTES = ${JSON.stringify(desktopPalettes(), null, 2).replace(/"([a-zA-Z]+)":/g, '$1:').replace(/"/g, "'")} as const
`
writeFileSync(out, body)
console.log(`wrote ${out}`)
