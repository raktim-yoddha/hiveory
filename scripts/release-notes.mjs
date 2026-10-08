// Release text for Hiveory, from one source: CHANGELOG.md holds each version's title and highlights
// (written by hand), git holds the commits (listed as written). Used by the release workflow:
//   node scripts/release-notes.mjs v0.21.0 > notes.md   (first line: "title: …", then the body)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const REPO_URL = 'https://github.com/raktim-yoddha/hiveory'

const SECTIONS = [
  ['Breaking changes', /^[a-z]+(\([^)]*\))?!:/],
  ['Features', /^feat(\([^)]*\))?:/],
  ['Fixes', /^(fix|revert)(\([^)]*\))?:/],
  ['Other', /^(docs|test|chore|refactor|ci|build|perf|style)(\([^)]*\))?:/]
]

/** Every `## vX.Y.Z — Title` entry of a changelog: its title, date line and highlight bullets. */
export const parseChangelog = (text) => {
  const entries = new Map()
  for (const block of text.split(/^## /m).slice(1)) {
    const [heading, ...lines] = block.split(/\r?\n/)
    const match = /^(v\d+\.\d+\.\d+\S*)\s+—\s+(.+)$/.exec(heading.trim())
    if (!match) continue
    const highlights = lines.filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim())
    const date = lines.map((l) => /^_(\d{4}-\d{2}-\d{2})/.exec(l)?.[1]).find(Boolean)
    entries.set(match[1], { tag: match[1], title: match[2].trim(), date, highlights })
  }
  return entries
}

/** Commit subjects grouped by Conventional Commit type; anything else lands in "Changes". */
export const groupCommits = (commits) => {
  const used = new Set()
  const groups = SECTIONS.map(([title, re]) => {
    const hits = commits.filter((c) => !used.has(c) && re.test(c.subject))
    hits.forEach((c) => used.add(c))
    return [title, hits]
  })
  groups.push(['Changes', commits.filter((c) => !used.has(c))])
  return groups.filter(([, hits]) => hits.length)
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

export const commitsBetween = (from, to) =>
  git('log', '--reverse', '--format=%h %s', from ? `${from}..${to}` : to)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({ sha: line.slice(0, line.indexOf(' ')), subject: line.slice(line.indexOf(' ') + 1) }))

/** The tag before `tag` in version order, or null for the first release. */
export const previousTag = (tag) => {
  const tags = git('tag', '--list', 'v*', '--sort=v:refname').split(/\r?\n/).filter(Boolean)
  const i = tags.indexOf(tag)
  return i > 0 ? tags[i - 1] : null
}

/** Markdown body of a GitHub release. `retroactive` adds the banner for versions tagged after the fact. */
export const releaseBody = ({ entry, commits, previous, retroactive }) => {
  const parts = []
  if (retroactive) parts.push(`_Retroactive release: shipped on ${entry.date}, tagged later. Source code only, no installers._`)
  if (entry.highlights.length) parts.push(`### Highlights\n${entry.highlights.map((h) => `- ${h}`).join('\n')}`)
  for (const [title, hits] of groupCommits(commits)) parts.push(`### ${title}\n${hits.map((c) => `- ${c.subject} (${c.sha})`).join('\n')}`)
  parts.push(previous ? `**Full changelog:** ${REPO_URL}/compare/${previous}...${entry.tag}` : `**Source:** ${REPO_URL}/tree/${entry.tag}`)
  return `${parts.join('\n\n')}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2]
  const entry = parseChangelog(readFileSync('CHANGELOG.md', 'utf8')).get(tag)
  if (!entry) {
    console.error(`CHANGELOG.md has no "## ${tag} — Title" entry.`)
    process.exit(1)
  }
  const previous = previousTag(tag)
  console.log(`title: ${tag} — ${entry.title}`)
  console.log(releaseBody({ entry, commits: commitsBetween(previous, tag), previous, retroactive: false }))
}
