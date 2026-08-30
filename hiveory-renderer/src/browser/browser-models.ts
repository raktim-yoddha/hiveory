import type { BrowserFrame, BrowserRuntimeState } from '../api/hiveory-client'

export const BROWSER_VIEWPORT_PRESETS = [
  { id: 'default', label: 'Default', dimensions: 'Use the Browser pane size', width: 0, height: 0 },
  { id: 'mobile-s', label: 'Mobile S', dimensions: '320 × 568', width: 320, height: 568 },
  { id: 'mobile-m', label: 'Mobile M', dimensions: '375 × 667', width: 375, height: 667 },
  { id: 'mobile-l', label: 'Mobile L', dimensions: '425 × 812', width: 425, height: 812 },
  { id: 'tablet', label: 'Tablet', dimensions: '768 × 1024', width: 768, height: 1024 },
  { id: 'laptop', label: 'Laptop', dimensions: '1024 × 768', width: 1024, height: 768 },
  { id: 'laptop-large', label: 'Laptop L', dimensions: '1440 × 900', width: 1440, height: 900 },
  { id: 'desktop', label: 'Desktop', dimensions: '1920 × 1080', width: 1920, height: 1080 },
] as const

export type BrowserViewportId = (typeof BROWSER_VIEWPORT_PRESETS)[number]['id']

export function browserViewportLabel(viewportId: string): string {
  const preset = BROWSER_VIEWPORT_PRESETS.find((item) => item.id === viewportId)
  return preset ? `${preset.label}${preset.width ? ` — ${preset.dimensions}` : ''}` : 'Default'
}

function text(value: unknown, fallback = 'Unknown'): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function safeCode(value: unknown, limit = 1200): string {
  return text(value, '').slice(0, limit).replace(/```/g, '` ` `')
}

function safeText(value: unknown, fallback: string, limit = 1200): string {
  const result = text(value, fallback).slice(0, limit)
  return result.replace(/```/g, '` ` `')
}

function pageDetails(payload: Record<string, unknown>, fallback: BrowserRuntimeState) {
  const page = record(payload.page)
  const target = record(payload.target)
  const viewport = record(page.viewport)
  const rect = record(target.rect)
  return { page, target, viewport, rect, url: text(page.url, fallback.url), title: text(page.title, fallback.title || 'Untitled page') }
}

export function formatBrowserGrab(payload: Record<string, unknown>, fallback: BrowserRuntimeState): string {
  const details = pageDetails(payload, fallback)
  const target = details.target
  const attrs = record(target.attributes)
  const attributeLines = Object.entries(attrs).map(([key, value]) => `- ${key}: ${safeCode(value, 240)}`)
  return [
    '# Hiveory page element',
    '',
    `- Page: ${details.title}`,
    `- URL: ${details.url}`,
    `- Viewport: ${text(details.viewport.width, '?')} × ${text(details.viewport.height, '?')}`,
    `- Captured: ${text(details.page.capturedAt, new Date().toISOString())}`,
    '',
    '## Target',
    `- Element: ${text(target.tag, 'element')}`,
    `- Selector: \`${safeCode(target.selector, 500)}\``,
    `- Position: ${text(details.rect.x, '?')}, ${text(details.rect.y, '?')} · ${text(details.rect.width, '?')} × ${text(details.rect.height, '?')}`,
    `- Text: ${safeText(target.text, '(none)') || '(none)'}`,
    '',
    '### Attributes',
    attributeLines.length ? attributeLines.join('\n') : '- None captured',
    '',
    '### HTML',
    '```html',
    safeText(target.html, '<element />'),
    '```',
  ].join('\n')
}

export function formatBrowserAnnotation(payload: Record<string, unknown>, fallback: BrowserRuntimeState): string {
  const details = pageDetails(payload, fallback)
  const target = details.target
  return [
    '# Hiveory page annotation',
    '',
    `- Page: ${details.title}`,
    `- URL: ${details.url}`,
    `- Element: ${text(target.tag, 'element')}`,
    `- Selector: \`${safeCode(target.selector, 500)}\``,
    '',
    '## Comment',
    safeText(payload.comment, '(no comment)'),
    '',
    '## Element text',
    safeText(target.text, '(none)'),
  ].join('\n')
}

export function browserFrameUrl(frame: BrowserFrame): string {
  return `data:image/png;base64,${frame.png_base64}`
}
