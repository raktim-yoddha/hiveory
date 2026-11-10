// Draws like an agent CLI for a set time, then exits (speed runs, ADR 0066): not lines scrolling
// by, but a screen redrawn in place with cursor movement, erasing and 24-bit color, which is the
// work a terminal does for Claude Code, Codex or OpenCode.
// Usage: node tui.mjs <inline|fullscreen> <frames per second> <seconds>
//   inline      a 12-line box redrawn at the bottom of the scrollback, a log line added above it now and then
//   fullscreen  the alternate screen repainted whole each frame
const [mode = 'inline', fps = '20', seconds = '5'] = process.argv.slice(2)
const cols = Math.max(40, process.stdout.columns || 100)
const rows = Math.max(10, process.stdout.rows || 30)
const end = Date.now() + Number(seconds) * 1000
const ESC = '\x1b['
const spinner = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const words = 'reading files · planning the change · editing src/app.ts · running tests · '
const rgb = (r, g, b) => `${ESC}38;2;${r};${g};${b}m`
const bg = (r, g, b) => `${ESC}48;2;${r};${g};${b}m`
const reset = `${ESC}0m`
let frame = 0

const BOX = 12
const inline = () => {
  let out = `${ESC}${BOX}A`
  // A finished step joins the log above the box: the box is drawn again one line lower.
  if (frame % 10 === 0) out += `${ESC}2K${rgb(120, 200, 140)}✓${reset} step ${frame / 10}: ${words.slice(0, cols - 20)}\r\n`
  const width = cols - 4
  out += `${ESC}2K${rgb(110, 110, 130)}╭${'─'.repeat(width)}╮${reset}\r\n`
  for (let line = 0; line < BOX - 3; line++) {
    const shift = (frame + line * 7) % words.length
    const text = (words.slice(shift) + words.repeat(3)).slice(0, width - 2)
    out += `${ESC}2K${rgb(110, 110, 130)}│${reset} ${rgb(180 + (line * 8) % 60, 190, 220 - line * 6)}${text}${reset} ${rgb(110, 110, 130)}│${reset}\r\n`
  }
  out += `${ESC}2K${rgb(110, 110, 130)}╰${'─'.repeat(width)}╯${reset}\r\n`
  out += `${ESC}2K${rgb(240, 180, 80)}${spinner[frame % spinner.length]}${reset} Working… ${rgb(130, 130, 150)}(${(frame / Number(fps)).toFixed(1)}s · ${frame * 37} tokens · esc to interrupt)${reset}\r\n`
  return out
}

const fullscreen = () => {
  let out = `${ESC}H`
  for (let row = 0; row < rows; row++) {
    const segment = Math.floor(cols / 4)
    for (let part = 0; part < 4; part++) {
      const shade = 20 + ((row * 3 + part * 11 + frame) % 40)
      const shift = (frame * 2 + row * 5 + part * 13) % words.length
      out += `${bg(shade, shade, shade + 12)}${rgb(170 + part * 20, 200 - row * 2, 230)}${(words.slice(shift) + words.repeat(2)).slice(0, part === 3 ? cols - segment * 3 : segment)}`
    }
    out += reset + (row < rows - 1 ? '\r\n' : '')
  }
  return out
}

if (mode === 'fullscreen') process.stdout.write(`${ESC}?1049h${ESC}?25l`)
else process.stdout.write('\r\n'.repeat(BOX))
const timer = setInterval(() => {
  frame++
  if (Date.now() < end) return void process.stdout.write(mode === 'fullscreen' ? fullscreen() : inline())
  clearInterval(timer)
  process.stdout.write(`${mode === 'fullscreen' ? `${ESC}?1049l${ESC}?25h` : ''}\r\ndrawing done\r\n`, () => process.exit(0))
}, 1000 / Number(fps))
