// Prints colored lines into a terminal for a set time, then exits (speed runs, ADR 0066).
// Usage: node flood.mjs <bytes per second, 0 = as fast as the terminal takes it> <seconds> [report.json]
// With a report path it writes how much it printed, and how often the terminal made it wait.
import { writeFileSync } from 'node:fs'

const rate = Number(process.argv[2]) || 0
const end = Date.now() + (Number(process.argv[3]) || 5) * 1000
const report = process.argv[4]
const started = Date.now()
let written = 0
let waits = 0
let waitedMs = 0
const done = () => {
  if (report) writeFileSync(report, JSON.stringify({ written, waits, waitedMs, ms: Date.now() - started }))
  process.exit(0)
}

// What a TUI redraw looks like to a terminal: color changes, text, line ends.
let n = 0
const line = () => `\x1b[3${n % 8}m${String(++n).padStart(8, '0')}\x1b[0m ${'░▒▓█ agent output '.repeat(6)}\r\n`
const block = (bytes) => {
  let out = ''
  while (out.length < bytes) out += line()
  return out
}

if (rate) {
  // Paced: a fiftieth of the rate every 20 ms.
  const timer = setInterval(() => {
    if (Date.now() >= end) {
      clearInterval(timer)
      return process.stdout.write('\r\nflood done\r\n', done)
    }
    const text = block(rate / 50)
    written += text.length
    process.stdout.write(text)
  }, 20)
} else {
  // Unpaced: write until the terminal pushes back, carry on when it drains.
  const pump = () => {
    while (Date.now() < end) {
      const text = block(16_384)
      written += text.length
      if (!process.stdout.write(text)) {
        // The terminal is not taking more: count how often, and for how long.
        waits++
        const at = Date.now()
        return process.stdout.once('drain', () => {
          waitedMs += Date.now() - at
          pump()
        })
      }
    }
    process.stdout.write('\r\nflood done\r\n', done)
  }
  pump()
}
