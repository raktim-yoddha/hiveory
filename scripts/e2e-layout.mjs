/* global document, window */
// The window without a title bar (ADR 0056): sidebar, panes and side panel start at the top, the chrome
// lives in the sidebar (or its rail), and the native window controls never cover a pane's buttons.
// Usage: pnpm build && node scripts/e2e-layout.mjs [screenshotDir]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, close, expect, finish, launch, page, sandbox, shot, test, value, waitFor } from './e2e-harness.mjs'

const repo = join(sandbox, 'demo-app')
mkdirSync(repo)
for (const args of [['init', '-b', 'main'], ['config', 'user.email', 'e2e@example.test'], ['config', 'user.name', 'e2e']]) execFileSync('git', args, { cwd: repo })
writeFileSync(join(repo, 'README.md'), '# demo\n')
execFileSync('git', ['add', '.'], { cwd: repo })
execFileSync('git', ['commit', '-m', 'init'], { cwd: repo })

const sidebar = () => page.getByRole('navigation', { name: 'Workspaces' })
const top = (selector) => page.evaluate((s) => document.querySelector(s)?.getBoundingClientRect().top ?? -1, selector)
/** Vertical centre of a located element: every top bar's buttons share one centre line. */
const middle = async (locator) => {
  const box = await locator.boundingBox()
  return box ? box.y + box.height / 2 : -1
}

await launch()

await test('no title bar and no modes: the sidebar starts at the top with the brand and layout buttons', async () => {
  expect((await page.getByRole('tab', { name: 'Bots' }).count()) === 0, 'a Bots mode tab is still shown')
  expect((await page.getByRole('tab', { name: 'Chat' }).count()) === 0, 'a Chat mode tab is still shown')
  expect((await page.locator('header[data-platform]').count()) === 0, 'the title bar is still there')
  const box = await sidebar().boundingBox()
  expect(box && box.y < 32, `the sidebar starts ${box?.y}px down`)
  await sidebar().getByText('Hiveory').waitFor()
  await sidebar().getByRole('button', { name: 'Hide sidebar' }).waitFor()
  await sidebar().getByRole('button', { name: 'Settings' }).waitFor()
  await shot('l1-home')
})

await test('a worktree: panes and the side panel start at the top too', async () => {
  // Hiveory adds only folders the user picked: stub the picker, then pick.
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, repo)
  await value('projects.pickFolder', { purpose: 'project' })
  const project = await value('projects.add', { mode: 'folder', path: repo })
  let primary
  await waitFor(async () => (primary = (await value('workspaces.list', { projectId: project.id })).find((w) => w.kind === 'main')), 'the primary worktree')
  const cli = (await value('clis.list')).find((c) => c.available)
  expect(cli, 'no CLI or terminal installed')
  await value('agents.open', { workspaceId: primary.id, cliId: cli.id })
  const row = sidebar().getByRole('button', { name: 'demo-app, primary worktree' })
  if (!(await row.isVisible())) await sidebar().getByRole('button', { name: /^demo-app: open/ }).click()
  if (await row.isVisible()) await row.click()
  await page.locator('[data-top-bar]').first().waitFor()
  const pane = await top('[data-top-bar]')
  expect(pane >= 0 && pane < 32, `the first pane starts ${pane}px down`)
  await page.getByRole('button', { name: 'Show side panel' }).click()
  await page.getByRole('region', { name: 'Side panel' }).waitFor()
  const panel = await page.getByRole('region', { name: 'Side panel' }).boundingBox()
  expect(panel && panel.y < 32, `the side panel starts ${panel?.y}px down`)
  // One top-bar height: the sidebar's button, a pane's header and the side panel's button line up (ADR 0056).
  const lines = [
    await middle(sidebar().getByRole('button', { name: 'Hide sidebar' })),
    await middle(page.locator('[data-top-bar]').first()),
    await middle(page.getByRole('button', { name: 'Hide side panel' }))
  ]
  expect(Math.max(...lines) - Math.min(...lines) <= 1, `top bars are off their centre line: ${lines.join(', ')}`)
  const toggle = await page.getByRole('button', { name: 'Hide side panel' }).boundingBox()
  expect(toggle && toggle.x > (await page.evaluate(() => window.innerWidth)) * 0.75, 'the side panel button is not on the right')
  await shot('l2-worktree-panel')
})

await test('the rightmost top bar leaves the window controls room (Windows and Linux)', async () => {
  if (process.platform === 'darwin') return
  // The app draws its own window buttons, on the top bars' centre line (ADR 0056).
  for (const name of ['Minimize window', 'Maximize window', 'Close window']) await page.getByRole('button', { name, exact: true }).waitFor()
  const rows = [await middle(page.getByRole('button', { name: 'Close window', exact: true })), await middle(page.locator('[data-top-bar]').first())]
  expect(Math.abs(rows[0] - rows[1]) <= 1, `the window buttons are off the top bars' centre line: ${rows.join(', ')}`)
  await page.getByRole('button', { name: 'Maximize window', exact: true }).click()
  await page.getByRole('button', { name: 'Restore window', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Restore window', exact: true }).click()
  await page.getByRole('button', { name: 'Maximize window', exact: true }).waitFor()
  await waitFor(
    () => page.evaluate(() => [...document.querySelectorAll('[data-top-bar]')].some((el) => el.hasAttribute('data-under-controls') && el.getBoundingClientRect().right > window.innerWidth - 160)),
    'the side panel header is marked under the controls'
  )
  await page.getByRole('button', { name: 'Hide side panel' }).click()
  await waitFor(
    () => page.evaluate(() => [...document.querySelectorAll('[data-top-bar]')].some((el) => el.hasAttribute('data-under-controls'))),
    'the top-right pane header is marked under the controls'
  )
})

await test('folded, the sidebar is a rail with the same buttons', async () => {
  await sidebar().getByRole('button', { name: 'Hide sidebar' }).click()
  const rail = page.getByRole('navigation', { name: 'App' })
  await rail.getByRole('button', { name: 'Show sidebar' }).waitFor()
  const rows = [await middle(rail.getByRole('button', { name: 'Show sidebar' })), await middle(page.locator('[data-top-bar]').first())]
  expect(Math.abs(rows[0] - rows[1]) <= 1, `the rail's button is off the top bars' centre line: ${rows.join(', ')}`)
  await rail.getByRole('button', { name: 'Settings' }).waitFor()
  await shot('l3-rail')
  await rail.getByRole('button', { name: 'Show sidebar' }).click()
  await sidebar().waitFor()
})

await close()
finish()
