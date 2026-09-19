import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const script = resolve(root, 'tools/scripts/hiveory-release.mjs')

function run(...arguments_) {
  return execFileSync(process.execPath, [script, ...arguments_], { cwd: root, encoding: 'utf8' })
}

test('release validation accepts synchronized 0.2.2 repair metadata', () => {
  assert.match(run('validate', '--version', '0.2.2', '--tag', '0.2.2'), /Validated Hiveory 0\.2\.2/)
})

test('release notes contain the stable Windows updater contract', () => {
  const output = run('notes', '--version', '0.2.2')
  assert.match(output, /## Highlights/)
  assert.match(output, /Hiveory-portable\.exe/)
  assert.match(output, /latest\.json/)
  assert.match(output, /compare\/0\.2\.1\.\.\.v0\.2\.2/)
})

test('release validation rejects an unprefixed future tag', () => {
  assert.throws(() => run('validate', '--version', '0.2.2', '--tag', '0.2.3'))
})

test('release utility computes the default patch bump', () => {
  assert.equal(run('next-version', '--version', '1.4.9').trim(), '1.4.10')
})
