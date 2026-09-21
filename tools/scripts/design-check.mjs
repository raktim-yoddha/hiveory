import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const diff = execFileSync('git', ['diff', '--no-ext-diff', '--unified=0', 'HEAD', '--'], { encoding: 'utf8' })
const changedFiles = new Set([
  ...execFileSync('git', ['diff', '--name-only', 'HEAD', '--'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean),
])
const exemptFiles = new Set(['src/apps/renderer/src/app/styles/design-system.css'])
const legacyStyleFiles = new Set([
  'src/apps/renderer/src/app/styles/app.css',
  'src/apps/renderer/src/features/modes/chat/styles/chat.css',
  'src/apps/renderer/src/features/modes/code/workspace/styles/workspace.css',
])
// These files pass colors to external/runtime APIs or persisted user preferences.
// Their values are still covered by the renderer-wide chromatic-color audit below.
const runtimeColorFiles = new Set([
  'src/apps/renderer/src/app/shell/HiveoryShell.tsx',
  'src/apps/renderer/src/features/global/browser/components/HiveoryBrowserDraw.tsx',
  'src/apps/renderer/src/features/modes/code/views/HiveoryCode.tsx',
  'src/apps/renderer/src/features/modes/code/workspace/components/CliIcons.tsx',
  'src/apps/renderer/src/features/modes/code/workspace/components/CodePaneHeader.tsx',
  'src/apps/renderer/src/features/modes/code/workspace/components/CodeWorkspaceRail.tsx',
  'src/apps/renderer/src/shared/ui/HiveoryBrandIcon.tsx',
  'src/apps/renderer/src/features/modes/code/workspace/components/panes/CodeTerminalPane.tsx',
  'src/apps/renderer/src/shared/api/hiveory-client.ts',
])
const issues = []
let file = ''

const sourceExtensions = new Set(['.css', '.ts', '.tsx', '.js', '.jsx', '.html', '.svg', '.json', '.rs', '.sql', '.toml'])
const colorPattern = /(?<!&)#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g
const rawColorPattern = /(?<!&)#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\brgba?\(|\bhsla?\(/
const namedChromaticColorPattern = /(?:^|[\s:,(])(?:blue|cyan|indigo|violet|purple|magenta|azure|skyblue)\b(?!\s*:)/i

function rendererSourceFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = `${directory}/${entry.name}`
    if (entry.isDirectory()) files.push(...rendererSourceFiles(candidate))
    else if (sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase())) files.push(candidate)
  }
  return files
}

function rgbToHue([red, green, blue]) {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (!delta || max === 0) return null
  let hue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4)
  if (hue < 0) hue += 360
  return { hue, saturation: delta / max }
}

function isForbiddenChromaticColor(value) {
  const trimmed = value.trim()
  let channels
  if (trimmed.startsWith('#')) {
    let hex = trimmed.slice(1)
    if (hex.length === 3 || hex.length === 4) hex = hex.slice(0, 3).split('').map((part) => part + part).join('')
    if (hex.length === 8) hex = hex.slice(0, 6)
    if (hex.length !== 6) return false
    channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
  } else {
    const match = trimmed.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i)
    if (!match) return false
    channels = match.slice(1, 4).map(Number)
  }
  const color = rgbToHue(channels)
  return Boolean(color && color.saturation >= 0.08 && color.hue >= 170 && color.hue <= 300)
}

function hasForbiddenColor(source) {
  if (namedChromaticColorPattern.test(source)) return true
  colorPattern.lastIndex = 0
  for (const match of source.matchAll(colorPattern)) {
    if (isForbiddenChromaticColor(match[0])) return true
  }
  return false
}

for (const line of diff.split(/\r?\n/)) {
  if (line.startsWith('+++ b/')) { file = line.slice(6); continue }
  if (!line.startsWith('+') || line.startsWith('+++') || exemptFiles.has(file) || !/\.(css|tsx?|jsx?)$/.test(file)) continue
  const source = line.slice(1)
  if (legacyStyleFiles.has(file)) continue
  if (/!important\b/.test(source)) issues.push(`${file}: new !important rule`)
  if (/^\s*:root\s*\{/.test(source)) issues.push(`${file}: duplicate token root outside design-system.css`)
  if (!runtimeColorFiles.has(file) && rawColorPattern.test(source)) issues.push(`${file}: raw color value`)
  if (/\b(?:font-size|line-height|padding|margin|gap|border-radius)\s*:\s*[^;]*\b\d+(?:\.\d+)?px\b/.test(source)) issues.push(`${file}: raw typography, spacing, or radius value`)
}

for (const candidate of changedFiles) {
  if (!existsSync(candidate) || exemptFiles.has(candidate) || legacyStyleFiles.has(candidate) || !/\.(css|tsx?|jsx?)$/.test(candidate)) continue
  if (diff.includes(`+++ b/${candidate}`)) continue
  for (const source of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
    if (/!important\b/.test(source)) issues.push(`${candidate}: new !important rule`)
    if (/^\s*:root\s*\{/.test(source)) issues.push(`${candidate}: duplicate token root outside design-system.css`)
    if (!runtimeColorFiles.has(candidate) && rawColorPattern.test(source)) issues.push(`${candidate}: raw color value`)
    if (/\b(?:font-size|line-height|padding|margin|gap|border-radius)\s*:\s*[^;]*\b\d+(?:\.\d+)?px\b/.test(source)) issues.push(`${candidate}: raw typography, spacing, or radius value`)
  }
}

const applicationFiles = [
  ...rendererSourceFiles('src/apps/renderer/src'),
  'src/apps/renderer/index.html',
  ...rendererSourceFiles('src/apps/desktop/src-tauri/src'),
  ...rendererSourceFiles('src/crates'),
]

for (const candidate of applicationFiles) {
  for (const source of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
    if (hasForbiddenColor(source)) issues.push(`${candidate}: forbidden blue or chromatic accent color`)
  }
}

if (issues.length) {
  process.stderr.write(`Design-system check failed:\n${[...new Set(issues)].map((issue) => `- ${issue}`).join('\n')}\n`)
  process.exit(1)
}

process.stdout.write('Design-system check passed.\n')
