/* global document */
// Drives the built app end to end with a throwaway profile and repository,
// saving screenshots of each main screen. Usage: pnpm build && pnpm smoke [outDir]
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const outDir = resolve(process.argv[2] ?? join(tmpdir(), 'hiveory-smoke'))
mkdirSync(outDir, { recursive: true })
const sandbox = mkdtempSync(join(tmpdir(), 'hiveory-smoke-'))
const repo = join(sandbox, 'demo-app')
mkdirSync(repo)
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
git('init', '-b', 'main')
writeFileSync(join(repo, 'README.md'), '# demo\n')
git('add', '.')
git('-c', 'user.name=smoke', '-c', 'user.email=smoke@example.test', 'commit', '-m', 'init')

const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, HIVEORY_USER_DATA: join(sandbox, 'profile'), LOCALAPPDATA: join(sandbox, 'local') }
})
const errors = []
app.process().stdout?.on('data', (d) => process.stdout.write(`[main] ${d}`))
app.process().stderr?.on('data', (d) => process.stdout.write(`[main:err] ${d}`))
const page = await app.firstWindow()
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined)
const shot = async (name) => {
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(outDir, `${name}.png`) })
  console.log(`saved ${name}.png`)
}

await page.waitForSelector('text=Welcome to Hiveory')
await shot('01-home')

await app.evaluate(({ dialog }, folder) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
}, repo)
await page.getByRole('button', { name: 'Open project' }).first().click()
await page.waitForSelector('text=Idle')
await shot('02-project-kanban-empty')

await page.getByRole('tab', { name: 'Workspaces' }).click()
await shot('03-workspaces')

await page.getByRole('button', { name: 'Create workspace' }).click()
await page.waitForSelector('dialog[open]')
await page.getByRole('radio', { name: /New branch/ }).click()
await shot('04-create-workspace')
await page.getByRole('button', { name: 'Create empty' }).click()
await page.waitForSelector('text=Empty workspace')
await shot('05-empty-workspace')

if (process.env.SMOKE_AGENTS) {
  const panes = page.locator('section[aria-label$=" agent"]')
  const timed = async (label, action, until) => {
    const start = Date.now()
    await action()
    await until()
    console.log(`${label}: ${Date.now() - start} ms`)
  }
  await timed(
    'open agent → pane visible',
    async () => {
      await page.getByRole('button', { name: /Open agent/ }).click()
      await page.getByRole('menuitem', { name: process.env.SMOKE_AGENTS }).click()
    },
    () => panes.first().waitFor()
  )
  await timed('pane → first terminal output', async () => undefined, () =>
    page.waitForFunction(() => document.querySelector('.xterm-screen canvas, .xterm-rows')?.parentElement)
  )
  await page.waitForTimeout(3000)
  await timed(
    'add second agent → pane visible',
    async () => {
      await page.getByRole('button', { name: 'Add agent' }).first().click()
      await page.getByRole('menuitem', { name: process.env.SMOKE_AGENTS }).click()
    },
    () => panes.nth(1).waitFor()
  )
  await page.waitForTimeout(4000)
  await shot('06-agent-panes')
  await page.getByRole('button', { name: /^Maximize / }).first().click()
  await page.waitForTimeout(400)
  await shot('06e-maximized')
  await page.getByRole('button', { name: /^Restore / }).first().click()
  await page.waitForTimeout(400)

  const paneHeaders = page.locator('section[aria-label$=" agent"] > header')
  const order = () =>
    page.locator('section[aria-label$=" agent"]').evaluateAll((els) =>
      els
        .map((el) => ({ name: el.getAttribute('aria-label'), box: el.getBoundingClientRect() }))
        .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
        .map((p) => `${p.name}@${Math.round(p.box.left)},${Math.round(p.box.top)}`)
    )
  const dragHeader = async (from, toX, toY, swap) => {
    const box = await paneHeaders.nth(from).boundingBox()
    await page.mouse.move(box.x + 60, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 80, box.y + 20, { steps: 4 })
    if (swap) await page.keyboard.down(' ')
    await page.mouse.move(toX, toY, { steps: 12 })
    await page.waitForTimeout(200)
    if (process.env.SMOKE_DRAG_SHOTS) await shot(swap ? '06b-drag-swap-preview' : '06a-drag-dock-preview')
    await page.mouse.up()
    if (swap) await page.keyboard.up(' ')
    await page.waitForTimeout(600)
  }
  console.log('before   ', await order())
  const second = await page.locator('section[aria-label$=" agent"]').nth(1).boundingBox()
  // Drop the first pane onto the bottom edge of the second: a vertical split.
  await dragHeader(0, second.x + second.width / 2, second.y + second.height - 30, false)
  console.log('after dock', await order())
  await shot('06c-after-dock')
  const top = await page.locator('section[aria-label$=" agent"]').nth(0).boundingBox()
  await dragHeader(1, top.x + top.width / 2, top.y + top.height / 2, true)
  console.log('after swap', await order())
  await shot('06d-after-swap')

  await page.getByRole('button', { name: 'demo-app', exact: true }).click()
  await shot('07-kanban-with-agents')
  await page.getByRole('button', { name: /Calm|Amber|Quiet|Copper|Silver|Hidden|Bright|Misty|Golden|Swift|Still|Velvet|Crimson|Lunar|Polar|Cedar|Iron|Hollow|Wild|Northern/ }).first().click()
  const before = await panes.count()
  await timed('close agent → pane gone', () => page.getByRole('button', { name: /^Close / }).first().click(), () =>
    page.waitForFunction((n) => document.querySelectorAll('section[aria-label$=" agent"]').length < n, before)
  )
}

console.log(errors.length ? `renderer errors:\n${errors.join('\n')}` : 'no renderer errors')
await app.close()
console.log(`screenshots in ${outDir}`)
