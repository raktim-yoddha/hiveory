import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const referenceRevisionsFile = join(root, 'techn/reference-audit/reference-revisions.json')

if (!existsSync(referenceRevisionsFile)) {
  console.log('Reference checkouts absent; skipping reference guard.')
  process.exit(0)
}

const references = JSON.parse(await readFile(referenceRevisionsFile, 'utf8'))
for (const reference of references) {
  const referenceDir = join(root, reference.path)
  if (!existsSync(referenceDir)) {
    console.log('Reference checkouts absent; skipping reference guard.')
    process.exit(0)
  }
  const revision = execFileSync('git', ['-C', referenceDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const status = execFileSync('git', ['-C', referenceDir, 'status', '--porcelain'], { encoding: 'utf8' }).trim()
  if (revision !== reference.revision) throw new Error(`${reference.path} revision differs from audited revision`)
  if (status) throw new Error(`${reference.path} has local changes`)
}
console.log('reference guard passed')
