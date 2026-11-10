// Prints a line every 400 ms, each naming this process's own start id (durability runs, ADR 0066):
// the same id with a rising count after Hiveory reopens proves the process never restarted.
const boot = Math.random().toString(36).slice(2, 10)
let tick = 0
setInterval(() => console.log(`boot=${boot} tick=${++tick} .`), 400)
