// A stand-in chat CLI for end-to-end runs (speed and durability, ADR 0066): prints plain lines at a
// set pace, then an end marker. What to print comes from fake-chat-cli.json beside this file, so
// nothing depends on the arguments or the environment a turn is started with.
//   with -p (a chat turn): answers once and exits
//   without (a terminal agent): shows a prompt, answers each line typed, and waits for the next
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const { lines = 20, lineChars = 100, everyMs = 100, perTick = 1, end = 'END-OF-REPLY', mark = 'L' } = JSON.parse(readFileSync(join(import.meta.dirname, 'fake-chat-cli.json'), 'utf8'))

const filler = 'the quick brown fox jumps over the lazy dog '
const line = (n) => {
  // Mostly prose, with a heading and a code block now and then, as replies have.
  if (n % 25 === 0) return `\n## Section ${n}\n`
  if (n % 40 === 1) return '```ts\nconst value = compute(input)\n```'
  // `mark` starts each numbered line, so two replies on one page are told apart.
  return `${mark}${n} ${filler.repeat(Math.ceil(lineChars / filler.length)).slice(0, Math.max(0, lineChars - String(n).length - 1 - mark.length))}`
}

/** Prints the answer at the configured pace, then calls `done`. */
const answer = (done) => {
  let printed = 0
  const timer = setInterval(() => {
    for (let i = 0; i < perTick && printed < lines; i++) process.stdout.write(`${line(++printed)}\r\n`)
    if (printed < lines) return
    clearInterval(timer)
    process.stdout.write(`${end}\r\n`, done)
  }, everyMs)
}

if (process.argv.includes('-p')) answer(() => process.exit(0))
else {
  process.stdout.write('Stand-in agent. Type a request.\r\n> ')
  const input = createInterface({ input: process.stdin })
  input.on('line', (text) => {
    if (!text.trim()) return void process.stdout.write('> ')
    answer(() => process.stdout.write('> '))
  })
}
