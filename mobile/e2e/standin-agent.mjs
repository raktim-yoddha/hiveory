// A stand-in agent CLI for the phone's end-to-end tests: it asks one yes/no question (so it shows as
// "Needs you"), then answers every message it gets. It never calls a model or touches files.
import { createInterface } from 'node:readline'

const out = (text) => process.stdout.write(text)
const work = (then) => {
  out('Working…\r\n')
  setTimeout(() => {
    out('Done.\r\n')
    then()
  }, 1500)
}
const prompt = () => out('> ')

let answered = false
out('Stand-in agent ready.\r\n')
out('Apply the demo change? (y/n) ')

createInterface({ input: process.stdin }).on('line', (line) => {
  const text = line.trim()
  if (!text) return prompt()
  if (!answered) {
    answered = true
    out(`Applied: ${text}\r\n`)
  } else out(`Got: ${text}\r\n`)
  work(prompt)
})
