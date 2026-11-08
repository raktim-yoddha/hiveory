/* global document */
// End-to-end: what makes Hiveory a native app (ADR 0061) — agent notifications and their click, the
// taskbar/dock attention badge, hiveory:// links (open and prompt drafts), the jump list, and Workspace
// scripts. Notifications are captured in the main process, never shown. No model is called.
// Usage: pnpm build && node scripts/e2e-native.mjs [screenshotDir]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { agentMcp, app, close, expect, finish, invoke, launch, page, relaunch, sandbox, shot, test, value, waitFor } from './e2e-harness.mjs'

const repo = join(sandbox, 'demo-app')
mkdirSync(repo, { recursive: true })
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
git('init', '-q', '-b', 'main')
git('config', 'user.email', 'e2e@example.test')
git('config', 'user.name', 'e2e')
writeFileSync(join(repo, 'README.md'), '# demo\n')
git('add', '.')
git('commit', '-q', '-m', 'init')

let project
let primary
let other
const sidebar = () => page.getByRole('navigation', { name: 'Workspaces' })
/** Sends an event to the window as the main process would. */
const sendEvent = (event, payload) => app.evaluate(({ BrowserWindow }, [e, p]) => BrowserWindow.getAllWindows()[0].webContents.send(`hiveory:${e}`, p), [event, payload])

console.log('Hiveory E2E: native app (notifications, badge, links, jump list, scripts)')
await launch()

await test('setup: capture notifications, the badge and the jump list in the main process', async () => {
  await app.evaluate(({ Notification, BrowserWindow, app: electronApp }) => {
    globalThis.__shown = []
    Notification.prototype.show = function () {
      globalThis.__shown.push(this)
    }
    globalThis.__overlay = []
    const w = BrowserWindow.getAllWindows()[0]
    const setOverlay = w.setOverlayIcon.bind(w)
    w.setOverlayIcon = (image, text) => {
      globalThis.__overlay.push(text)
      setOverlay(image, text)
    }
    globalThis.__badge = []
    const setBadge = electronApp.setBadgeCount.bind(electronApp)
    electronApp.setBadgeCount = (n) => {
      globalThis.__badge.push(n)
      return setBadge(n)
    }
    globalThis.__jump = []
    electronApp.setJumpList = (list) => {
      globalThis.__jump.push(list)
      return 'ok'
    }
  })
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, repo)
  await value('projects.pickFolder', { purpose: 'project' })
  project = await value('projects.add', { mode: 'folder', path: repo })
  await waitFor(async () => (await value('workspaces.list', { projectId: project.id })).some((w) => w.kind === 'main'), 'primary')
  primary = (await value('workspaces.list', { projectId: project.id })).find((w) => w.kind === 'main')
  other = await value('workspaces.create', { projectId: project.id, kind: 'isolated', name: 'side-task', cliSelections: [], autoApprove: false })
})

await test('the jump list offers the Workspace (Windows) / nothing breaks elsewhere', async () => {
  if (process.platform !== 'win32') return
  await waitFor(async () => (await app.evaluate(() => JSON.stringify(globalThis.__jump.at(-1) ?? []))).includes('demo-app'), 'demo-app in the jump list')
  const args = await app.evaluate(() => globalThis.__jump.at(-1)[0].items[0].args)
  expect(args.endsWith(`hiveory://open?p=${project.id}`), `jump list args: ${args}`)
})

await test('an agent that needs you raises a notification; clicking it opens that worktree', async () => {
  await sidebar().getByText('demo-app', { exact: true }).first().click()
  await page.locator('section[aria-label$="worktree"]').first().waitFor()
  // An alert from a worktree that is not on screen.
  await sendEvent('agent.alert', { kind: 'waiting', instanceId: 'x1', petName: 'Juno', cliName: 'Claude Code', projectId: project.id, workspaceId: other.id, workspaceName: 'side-task', reason: 'permission' })
  await waitFor(async () => (await app.evaluate(() => globalThis.__shown.length)) === 1, 'one notification')
  const shown = await app.evaluate(() => ({ title: globalThis.__shown[0].title, body: globalThis.__shown[0].body }))
  expect(shown.title === 'Juno needs you' && shown.body === 'Claude Code · side-task — permission', JSON.stringify(shown))
  await app.evaluate(() => globalThis.__shown[0].emit('click'))
  await page.locator('section[aria-label="side-task worktree"]').waitFor()
  await shot('n1-opened-from-notification')
})

await test('Settings › Agents › Desktop notifications chooses what alerts (main filters, ADR 0061)', async () => {
  await page.keyboard.press('Control+Comma')
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Agents' }).click()
  await page.getByRole('combobox', { name: 'Desktop notifications' }).or(page.getByRole('button', { name: /Desktop notifications/ })).first().click()
  await page.getByRole('option', { name: 'Only when an agent needs you' }).click()
  await waitFor(async () => (await value('settings.get')).desktopAlerts === 'needs-you', 'saved as needs-you')
  await shot('n1b-alerts-setting')
  const bad = await invoke('settings.update', { desktopAlerts: 'sometimes' })
  expect(!bad.ok, 'an unknown alerts value was accepted')
  await value('settings.update', { desktopAlerts: 'all' })
  await page.keyboard.press('Escape')
})

await test('the attention badge follows how many agents need you', async () => {
  const now = await value('agents.attention')
  expect(now.waiting === 0, `waiting at start: ${now.waiting}`)
  await sendEvent('agents.attention', { waiting: 2 })
  await sendEvent('agents.attention', { waiting: 0 })
  if (process.platform === 'win32') {
    await waitFor(async () => (await app.evaluate(() => globalThis.__overlay.join('|'))).includes('2 agents need you'), 'overlay for 2')
    expect((await app.evaluate(() => globalThis.__overlay.at(-1))) === '', 'overlay not cleared')
  } else {
    await waitFor(async () => (await app.evaluate(() => globalThis.__badge.join(','))).endsWith('2,0'), 'badge 2 then 0')
  }
  // Out-of-range counts never reach the system.
  const r = await invoke('app.setAttention', { waiting: -1 })
  expect(!r.ok, 'a negative count was accepted')
})

await test('hiveory://open goes to the worktree; a link to a missing Workspace says so', async () => {
  await sendEvent('app.link', { kind: 'open', projectId: project.id, workspaceId: primary.id })
  await page.locator('section[aria-label$="worktree"]').filter({ hasNot: page.locator('[aria-label="side-task worktree"]') }).first().waitFor()
  await waitFor(async () => (await page.locator('section[aria-label="side-task worktree"]').count()) === 0, 'left side-task')
  await sendEvent('app.link', { kind: 'open', projectId: 'nope' })
  await page.getByText('That Workspace is not in Hiveory on this computer.').waitFor()
  // The link that started Hiveory is read once.
  expect((await value('app.pendingLink')) === null, 'a pending link was left')
})

await test('hiveory://new puts the prompt in a new chat’s box, never sends it', async () => {
  const clis = await value('chat.clis')
  if (!clis.length) return console.log('    (no chat CLI installed: skipped)')
  const before = (await value('agents.list', { workspaceId: primary.id })).length
  await sendEvent('app.link', { kind: 'new', prompt: 'Explain README.md in one line', projectId: project.id, workspaceId: primary.id })
  const box = page.getByRole('textbox', { name: 'Message', exact: true })
  await box.waitFor({ timeout: 20_000 })
  await waitFor(async () => (await box.inputValue()) === 'Explain README.md in one line', `draft: ${await box.inputValue().catch(() => '')}`)
  const agents = await value('agents.list', { workspaceId: primary.id })
  expect(agents.length === before + 1, 'no new chat agent')
  const chat = await value('chat.get', { chatId: agents.at(-1).id })
  expect(!chat.messages?.some((m) => m.role === 'user'), 'the prompt was sent')
  await shot('n2-prompt-draft')
  await value('agents.close', { instanceId: agents.at(-1).id })
})

await test('Workspace scripts: saved, refused when bad, run from the pane "+"', async () => {
  const bad = await invoke('projects.update', { projectId: project.id, settings: { scripts: [{ name: 'dev', command: 'a\nb' }] } })
  expect(!bad.ok, 'a two-line command was accepted')
  const twice = await invoke('projects.update', { projectId: project.id, settings: { scripts: [{ name: 'dev', command: 'x' }, { name: 'DEV', command: 'y' }] } })
  expect(!twice.ok, 'two scripts with one name were accepted')
  await value('projects.update', { projectId: project.id, settings: { scripts: [{ name: 'say-hi', command: 'echo hiveory-script-ok' }] } })
  // A terminal to have an area with a "+".
  const shell = (await value('clis.list')).find((c) => c.kind === 'shell' && c.available)
  await value('agents.open', { workspaceId: primary.id, cliId: shell.id })
  await page.getByRole('button', { name: 'Add agent' }).first().click()
  const menu = page.getByRole('menu', { name: 'Open' })
  await menu.getByRole('menuitem', { name: 'say-hi' }).waitFor()
  await shot('n3-scripts-in-plus')
  await menu.getByRole('menuitem', { name: 'say-hi' }).click()
  let script
  await waitFor(async () => {
    script = (await value('agents.list', { workspaceId: primary.id })).find((a) => a.petName === 'say-hi')
    return Boolean(script)
  }, 'a terminal named after the script')
  await waitFor(async () => (await value('terminal.snapshot', { instanceId: script.id })).data.includes('hiveory-script-ok'), 'the script ran', 20_000)
})

await test('Workspace settings list scripts and add one; Find runs them', async () => {
  await page.locator('aside[aria-label="Side panel"]').count()
  if (!(await page.locator('aside[aria-label="Side panel"]').getByRole('tablist').count())) await page.getByRole('button', { name: /side panel$/i }).first().click()
  await page.locator('aside[aria-label="Side panel"]').getByRole('tab', { name: 'Settings' }).click()
  const scripts = page.getByRole('list', { name: 'Scripts' })
  await scripts.getByText('say-hi').waitFor()
  await page.getByLabel('Script name').fill('lint')
  await page.getByLabel('Script command').fill('echo lint-ok')
  await page.getByLabel('Script command').press('Enter')
  await scripts.getByText('lint', { exact: true }).waitFor()
  await page.getByLabel('Script name').fill('lint')
  await page.getByLabel('Script command').fill('again')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('alert').getByText('A script already has that name.').waitFor()
  await shot('n4-scripts-settings')
  // What main puts on the clipboard (the system clipboard itself is another program's to lock).
  await app.evaluate(({ clipboard }) => {
    globalThis.__copied = []
    const write = clipboard.writeText.bind(clipboard)
    clipboard.writeText = (text, type) => {
      globalThis.__copied.push(text)
      try {
        write(text, type)
      } catch {
        // A locked system clipboard is not what this test checks.
      }
    }
  })
  await page.keyboard.press('Control+Shift+KeyP')
  const find = page.getByRole('dialog', { name: 'Command palette' })
  await find.getByRole('combobox').fill('lint')
  await find.getByRole('option').filter({ hasText: 'Run script' }).first().waitFor()
  await find.getByRole('combobox').fill('copy a link')
  await find.getByRole('combobox').press('Enter')
  await waitFor(async () => (await app.evaluate(() => globalThis.__copied.at(-1) ?? '')) === `hiveory://open?p=${project.id}&w=${primary.id}`, 'worktree link copied')
})

await test('Ctrl+F6 moves between the sidebar, the worktree and the side panel, and back', async () => {
  await page.keyboard.press('Escape')
  const where = () =>
    page.evaluate(() => {
      const el = document.activeElement
      return el?.closest('nav[aria-label="Workspaces"]') ? 'sidebar' : el?.closest('aside[aria-label="Side panel"]') ? 'panel' : el?.closest('main') ? 'main' : 'none'
    })
  await sidebar().getByRole('button').first().focus()
  expect((await where()) === 'sidebar', `start: ${await where()}`)
  const seen = []
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Control+F6')
    seen.push(await where())
  }
  expect(JSON.stringify(seen) === JSON.stringify(['main', 'panel', 'sidebar']), `forward: ${seen}`)
  await page.keyboard.press('Control+Shift+F6')
  expect((await where()) === 'panel', `back: ${await where()}`)
})

await test('an agent lists and runs the Workspace scripts over its Hiveory tools', async () => {
  const claude = (await value('clis.list')).find((c) => c.id === 'claude' && c.available)
  if (!claude) return console.log('    (Claude Code not installed: skipped)')
  const { agent } = await value('agents.open', { workspaceId: primary.id, cliId: 'claude' })
  const { tool } = await agentMcp(agent.id)
  const listed = await tool('list_scripts')
  expect(listed.content[0].text.includes('say-hi: echo hiveory-script-ok'), JSON.stringify(listed))
  const unknown = await tool('run_script', { name: 'nope' })
  expect(unknown.isError && /Scripts: say-hi/.test(unknown.content[0].text), JSON.stringify(unknown))
  const ran = await tool('run_script', { name: 'lint', wait_seconds: 2 })
  expect(!ran.isError && ran.content[0].text.includes('Started "lint"'), JSON.stringify(ran))
  await waitFor(async () => {
    const pane = (await value('agents.list', { workspaceId: primary.id })).filter((a) => a.petName === 'lint').at(-1)
    return Boolean(pane) && (await value('terminal.snapshot', { instanceId: pane.id })).data.includes('lint-ok')
  }, 'the agent-started script printed', 20_000)
})

await test('with the window in the tray, an agent opens, reads and captures a page', async () => {
  const claude = (await value('clis.list')).find((c) => c.id === 'claude' && c.available)
  if (!claude) return console.log('    (Claude Code not installed: skipped)')
  const site = createServer((_req, res) => res.end('<!doctype html><title>Tray fixture</title><h1>Tray fixture</h1><button id="go">Go</button>'))
  await new Promise((ok) => site.listen(0, '127.0.0.1', ok))
  try {
    await value('settings.update', { keepRunningInBackground: true })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await page.waitForTimeout(800)
    // The page is created while the window is away: it must still lay out at a real size.
    const { agent } = await value('agents.open', { workspaceId: primary.id, cliId: 'claude' })
    const { tool } = await agentMcp(agent.id)
    const text = (r) => r.content.map((c) => c.text ?? '').join('\n')
    const nav = await tool('browser_navigate', { url: `http://127.0.0.1:${site.address().port}/` })
    expect(!nav.isError && text(nav).includes('heading "Tray fixture"') && !/viewport 0×0/.test(text(nav)), text(nav).slice(0, 400))
    const click = await tool('browser_click', { target: '#go' })
    expect(!click.isError, text(click).slice(0, 300))
    const picture = await tool('browser_screenshot', {})
    expect(!picture.isError && picture.content.some((c) => c.type === 'image'), text(picture).slice(0, 300))
  } finally {
    site.close()
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      if (w.isMinimized()) w.restore()
      w.show()
    })
    await value('settings.update', { keepRunningInBackground: false })
  }
})

await test('the window reopens where it was, at its size', async () => {
  const wanted = { x: 140, y: 90, width: 1180, height: 760 }
  await app.evaluate(({ BrowserWindow }, b) => BrowserWindow.getAllWindows()[0].setBounds(b), wanted)
  await page.waitForTimeout(1200)
  // The system may adjust what was asked by a few pixels (borders, scaling): the window's own bounds count.
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
  expect(Math.abs(before.x - wanted.x) < 20 && Math.abs(before.width - wanted.width) < 20, `setBounds gave ${JSON.stringify(before)}`)
  Object.assign(wanted, before)
  await relaunch()
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
  // Within the few pixels display scaling rounds to.
  const close = (a, b) => Math.abs(a - b) <= 3
  expect(close(bounds.x, wanted.x) && close(bounds.y, wanted.y) && close(bounds.width, wanted.width) && close(bounds.height, wanted.height), `reopened at ${JSON.stringify(bounds)}`)
})

await close()
finish()
