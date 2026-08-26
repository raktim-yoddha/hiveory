import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const references = JSON.parse(await readFile(join(root, 'docs/reference-audit/reference-revisions.json'), 'utf8'))
for (const reference of references) {
  const revision = execFileSync('git', ['-C', join(root, reference.path), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const status = execFileSync('git', ['-C', join(root, reference.path), 'status', '--porcelain'], { encoding: 'utf8' }).trim()
  if (revision !== reference.revision) throw new Error(`${reference.path} revision differs from audited revision`)
  if (status) throw new Error(`${reference.path} has local changes`)
}
console.log('reference guard passed')
