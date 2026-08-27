import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const root = process.cwd()
const prohibitedFile = join(root, 'docs/reference-audit/prohibited-source-identities.txt')
const prohibited = (await readFile(prohibitedFile, 'utf8')).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => line.toLowerCase())
const excludedRoots = new Set(['.git', 'techn', 'target', 'node_modules', 'dist', 'graphify-out', 'docs/reference-audit'])
const excludedFiles = new Set(['THIRD_PARTY_NOTICES.md', 'tauri-agent-super-app-prd.md'])
const violations = []

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedRoots.has(entry.name)) continue
    const fullPath = join(directory, entry.name)
    const path = relative(root, fullPath).replaceAll('\\', '/')
    if (path === 'docs/reference-audit' || path.startsWith('docs/reference-audit/')) continue
    if (entry.isDirectory()) { await visit(fullPath); continue }
    if (excludedFiles.has(entry.name) || !entry.isFile()) continue
    const haystack = `${path}\n${await readFile(fullPath, 'utf8').catch(() => '')}`.toLowerCase()
    for (const term of prohibited) if (haystack.includes(term)) violations.push(`${path}: ${term}`)
  }
}

await visit(root)
if (violations.length) { console.error(`Prohibited source identity found:\n${violations.join('\n')}`); process.exit(1) }
console.log('identity scan passed')
