import { describe, expect, it } from 'vitest'
import type { BrowserRuntimeState } from '../../shared/api/hiveory-client'
import {
  formatBrowserAnnotations,
  formatBrowserGrab,
  parseBrowserElementPayload,
  type BrowserPageAnnotation,
} from './browser-models'

const fallback: BrowserRuntimeState = {
  browser_id: 'browser-1',
  workspace_id: 'workspace-1',
  url: 'https://fallback.example/',
  title: 'Fallback',
  loading: false,
  can_go_back: false,
  can_go_forward: false,
  error: null,
  profile_id: 'default',
  viewport_id: 'default',
}

function payload() {
  return parseBrowserElementPayload({
    page: {
      url: 'https://example.com/pricing?plan=pro',
      title: 'Pricing',
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 180 },
      dpr: 2,
      capturedAt: '2026-08-31T00:00:00.000Z',
    },
    target: {
      tag: 'button',
      selector: 'main > button.primary',
      fullPath: 'html > body > main > button.primary',
      classes: 'primary',
      sourceFile: 'src/Pricing.tsx:42:8',
      componentPath: '<Application> <PricingAction>',
      attributes: { class: 'primary', type: 'button' },
      accessibility: { role: 'button', label: 'Start free trial' },
      rect: { x: 400, y: 300, width: 148, height: 44 },
      pageRect: { x: 400, y: 480, width: 148, height: 44 },
      styles: { display: 'inline-flex', fontSize: '16px' },
      text: 'Start free trial',
      html: '<button class="primary">Start free trial</button>',
    },
    nearby: ['Pro', '$29/month'],
    ancestors: ['main', 'body', 'html'],
  }, fallback)
}

describe('browser capture models', () => {
  it('normalizes and bounds page-controlled capture fields', () => {
    const parsed = parseBrowserElementPayload({
      page: { viewport: { width: Number.NaN, height: 720 } },
      target: { tag: 'x'.repeat(300), attributes: { count: 3, ignored: {} } },
      nearby: Array.from({ length: 20 }, (_, index) => `item-${index}`),
    }, fallback)

    expect(parsed.page.url).toBe(fallback.url)
    expect(parsed.page.viewport.width).toBe(0)
    expect(parsed.target.tag).toHaveLength(120)
    expect(parsed.target.attributes).toEqual({ count: '3' })
    expect(parsed.nearby).toHaveLength(10)
  })

  it('formats agent-useful element context without application branding', () => {
    const output = formatBrowserGrab(payload())

    expect(output).toContain('Attached browser context from https://example.com/pricing?plan=pro')
    expect(output).toContain('Accessible name: "Start free trial"')
    expect(output).toContain('Selector: main > button.primary')
    expect(output).toContain('Source: src/Pricing.tsx:42:8')
    expect(output).toContain('Component path: <Application> <PricingAction>')
    expect(output).toContain('Dimensions: 148x44')
    expect(output).not.toContain('Hiveory page element')
  })

  it('combines persistent annotations into one bounded agent prompt', () => {
    const annotation: BrowserPageAnnotation = {
      id: 'note-1',
      browserId: 'browser-1',
      comment: 'Make this action easier to find.\n## injected heading',
      intent: 'change',
      createdAt: '2026-08-31T00:00:00.000Z',
      payload: payload(),
    }
    const output = formatBrowserAnnotations([annotation])

    expect(output).toContain('## Design Feedback: /pricing?plan=pro')
    expect(output).toContain('**Browser pane id:** browser-1')
    expect(output).toContain('**Selector:** `main > button.primary`')
    expect(output).toContain('**Intent:** change')
    expect(output).toContain('**Feedback:** Make this action easier to find. ## injected heading')
    expect(output).not.toContain('\n## injected heading')
  })
})
