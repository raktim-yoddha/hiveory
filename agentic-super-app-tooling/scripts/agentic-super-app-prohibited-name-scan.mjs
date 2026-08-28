import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'

const root = process.cwd()

// SHA-256 hashes of canonical lowercase prohibited identities
const PROHIBITED_HASHES = new Set([
  'e0c924608fdcda8536bd9cc86b0fce0ab2d54ecc1e8ed9673624c39cde7f7820',
  'f72ae0c9ef66c9b28790fadd7e6725ab38a5c5d59470f286ff0720eecf36ae00',
  '91324c45374f52375b543031d0d02e54d9e4d50866aac98585ec81fbe7f1106f',
  '01f509f4b6f55639e034321a00e7c82c0c69b79fee8bf661c11edb6e934eee10',
  '19ea087c7722c524e5d8b6825e015ce5924fda62e24fe6870d311aa14bfabef0',
  '8cfde6efdfc4ed5ab1f6acbbd1ba49bf31932f84d0a4c090eb41c7d151e8b180',
  '21e63e26eab42a77f93d868a8a536c6e0c97d6769bd2cd44a65ed741f1e50a9a',
  'a25477d5a13d36c391615b19221467f1edd904b9c0666b2a1d365173c291e999',
  '2d87f3d38782aa14e5a6fdd0c1f374cd6090400b872f50cb78ee7e8d80810e98',
  '1fb89a939f36eaf94d79f85f1629c63d390bcd2bd17bf519637b1802ec2f695b',
  'ab5be3492be3abef0491e24c815a1426c6af00acff1e0fe9927720607da4c65b',
  '9c4e3993cbbe48e7c0c1d830c9c352c5c9edf187ea8d8173eae4f7e2298fc219',
  'd3c8e4779fdde5dbce10452eaefc73bf140c61c373831b8956905cc793d69b8d',
  '092a429205dfcbd3bc93a8a9897d7a0298c1f35256cbcad35a6740fffad11c07',
  'a80b1c447a15f7a0355a277688140e910236e5e3439cee4aff462e808abdc330',
])

function sha256(str) {
  return createHash('sha256').update(str).digest('hex')
}

function scanText(text) {
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || []
  for (let i = 0; i < tokens.length; i++) {
    const single = tokens[i]
    if (PROHIBITED_HASHES.has(sha256(single))) return single
    if (i + 1 < tokens.length) {
      const next = tokens[i + 1]
      const twoSpace = `${single} ${next}`
      if (PROHIBITED_HASHES.has(sha256(twoSpace))) return twoSpace
      const twoHyphen = `${single}-${next}`
      if (PROHIBITED_HASHES.has(sha256(twoHyphen))) return twoHyphen
      const twoUnderscore = `${single}_${next}`
      if (PROHIBITED_HASHES.has(sha256(twoUnderscore))) return twoUnderscore
      const twoConcat = `${single}${next}`
      if (PROHIBITED_HASHES.has(sha256(twoConcat))) return twoConcat
    }
  }
  return null
}

const excludedRoots = new Set(['.git', 'techn', 'target', 'node_modules', 'dist', 'releases', 'graphify-out'])
const excludedFiles = new Set(['THIRD_PARTY_NOTICES.md', 'tauri-agent-super-app-prd.md'])
const violations = []

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedRoots.has(entry.name)) continue
    const fullPath = join(directory, entry.name)
    const path = relative(root, fullPath).replaceAll('\\', '/')
    if (entry.isDirectory()) {
      const pathViolation = scanText(path)
      if (pathViolation) violations.push(`${path} (directory path violation)`)
      await visit(fullPath)
      continue
    }
    if (excludedFiles.has(entry.name) || !entry.isFile()) continue
    const pathViolation = scanText(path)
    if (pathViolation) {
      violations.push(`${path} (file path violation)`)
      continue
    }
    const content = await readFile(fullPath, 'utf8').catch(() => '')
    const contentViolation = scanText(content)
    if (contentViolation) {
      violations.push(`${path} (content violation)`)
    }
  }
}

await visit(root)
if (violations.length) {
  console.error(`Prohibited source identity found:\n${violations.join('\n')}`)
  process.exit(1)
}
console.log('identity scan passed')
