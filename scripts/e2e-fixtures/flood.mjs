// Prints colored lines into a terminal for a set time, then exits (speed runs, ADR 0066).
// Usage: node flood.mjs <bytes per second, 0 = as fast as the terminal takes it> <seconds>
const rate = Number(process.argv[2]) || 0
const end = Date.now() + (Number(process.argv[3]) || 5) * 1000

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
      return process.stdout.write('\r\nflood done\r\n', () => process.exit(0))
    }
    process.stdout.write(block(rate / 50))
  }, 20)
} else {
  // Unpaced: write until the terminal pushes back, carry on when it drains.
  const pump = () => {
    while (Date.now() < end) {
      if (!process.stdout.write(block(16_384))) return process.stdout.once('drain', pump)
    }
    process.stdout.write('\r\nflood done\r\n', () => process.exit(0))
  }
  pump()
}
