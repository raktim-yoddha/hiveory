import type { BrowserFrame, BrowserRuntimeState } from '../../../shared/api/hiveory-client'

export const BROWSER_VIEWPORT_PRESETS = [
  { id: 'default', label: 'Default', dimensions: 'Use the Browser pane size', width: 0, height: 0 },
  { id: 'iphone-se', label: 'iPhone SE', dimensions: '375 × 667', width: 375, height: 667 },
  { id: 'iphone-xr', label: 'iPhone XR', dimensions: '414 × 896', width: 414, height: 896 },
  { id: 'iphone-12-pro', label: 'iPhone 12 Pro', dimensions: '390 × 844', width: 390, height: 844 },
  { id: 'iphone-14-pro-max', label: 'iPhone 14 Pro Max', dimensions: '430 × 932', width: 430, height: 932 },
  { id: 'pixel-7', label: 'Pixel 7', dimensions: '412 × 915', width: 412, height: 915 },
  { id: 'samsung-galaxy-s8-plus', label: 'Samsung Galaxy S8+', dimensions: '360 × 740', width: 360, height: 740 },
  { id: 'samsung-galaxy-s20-ultra', label: 'Samsung Galaxy S20 Ultra', dimensions: '412 × 915', width: 412, height: 915 },
  { id: 'ipad-mini', label: 'iPad Mini', dimensions: '768 × 1024', width: 768, height: 1024 },
  { id: 'ipad-air', label: 'iPad Air', dimensions: '820 × 1180', width: 820, height: 1180 },
  { id: 'ipad-pro', label: 'iPad Pro', dimensions: '1024 × 1366', width: 1024, height: 1366 },
  { id: 'surface-pro-7', label: 'Surface Pro 7', dimensions: '912 × 1368', width: 912, height: 1368 },
  { id: 'surface-duo', label: 'Surface Duo', dimensions: '540 × 720', width: 540, height: 720 },
  { id: 'galaxy-z-fold-5', label: 'Galaxy Z Fold 5', dimensions: '344 × 882', width: 344, height: 882 },
  { id: 'asus-zenbook-fold', label: 'Asus Zenbook Fold', dimensions: '853 × 1280', width: 853, height: 1280 },
  { id: 'samsung-galaxy-a51-71', label: 'Samsung Galaxy A51/71', dimensions: '412 × 914', width: 412, height: 914 },
  { id: 'nest-hub', label: 'Nest Hub', dimensions: '1024 × 600', width: 1024, height: 600 },
  { id: 'nest-hub-max', label: 'Nest Hub Max', dimensions: '1280 × 800', width: 1280, height: 800 },
  { id: 'mobile-s', label: 'Mobile S', dimensions: '320 × 568', width: 320, height: 568 },
  { id: 'mobile-m', label: 'Mobile M', dimensions: '375 × 667', width: 375, height: 667 },
  { id: 'mobile-l', label: 'Mobile L', dimensions: '425 × 812', width: 425, height: 812 },
  { id: 'tablet', label: 'Tablet', dimensions: '768 × 1024', width: 768, height: 1024 },
  { id: 'laptop', label: 'Laptop', dimensions: '1024 × 768', width: 1024, height: 768 },
  { id: 'laptop-large', label: 'Laptop L', dimensions: '1440 × 900', width: 1440, height: 900 },
  { id: 'desktop', label: 'Desktop', dimensions: '1920 × 1080', width: 1920, height: 1080 },
] as const

export type BrowserViewportId = (typeof BROWSER_VIEWPORT_PRESETS)[number]['id']
export type BrowserAnnotationIntent = 'change' | 'question'
export type BrowserRect = { x: number; y: number; width: number; height: number }
export type BrowserClientRect = { left: number; top: number; right: number; bottom: number }

export function intersectBrowserSurface(
  surface: BrowserClientRect,
  stage: BrowserClientRect,
  viewport: { width: number; height: number },
): BrowserRect {
  const left = Math.max(0, surface.left, stage.left)
  const top = Math.max(0, surface.top, stage.top)
  const right = Math.min(viewport.width, surface.right, stage.right)
  const bottom = Math.min(viewport.height, surface.bottom, stage.bottom)
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

export type BrowserElementPayload = {
  page: {
    url: string
    title: string
    viewport: { width: number; height: number }
    scroll: { x: number; y: number }
    dpr: number
    capturedAt: string
  }
  target: {
    tag: string
    selector: string
    fullPath: string
    classes: string
    sourceFile: string | null
    componentPath: string | null
    selectedText: string | null
    fixed: boolean
    attributes: Record<string, string>
    accessibility: { role: string | null; label: string | null }
    rect: BrowserRect
    pageRect: BrowserRect
    styles: Record<string, string>
    text: string
    html: string
    nearbyElements: string[]
  }
  nearby: string[]
  ancestors: string[]
  delivery?: 'text' | 'screenshot'
}

export type BrowserPageAnnotation = {
  id: string
  browserId: string
  comment: string
  intent: BrowserAnnotationIntent
  createdAt: string
  payload: BrowserElementPayload
}

export const BROWSER_ANNOTATION_LIMIT = 20

export function browserViewportLabel(viewportId: string): string {
  const preset = BROWSER_VIEWPORT_PRESETS.find((item) => item.id === viewportId)
  return preset ? `${preset.label}${preset.width ? ` — ${preset.dimensions}` : ''}` : 'Default'
}

function text(value: unknown, fallback = 'Unknown'): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(record(value)).flatMap(([key, item]) => {
    if (typeof item === 'string') return [[key, item]]
    if (typeof item === 'number' || typeof item === 'boolean') return [[key, String(item)]]
    return []
  }))
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').slice(0, limit)
}

function safeInline(value: unknown, limit = 1200): string {
  const source = text(value, '').slice(0, limit)
  return source.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

function inlineCode(value: string): string {
  const fence = value.includes('`') ? '``' : '`'
  return `${fence}${value}${fence}`
}

function rect(value: unknown): BrowserRect {
  const item = record(value)
  return { x: finiteNumber(item.x), y: finiteNumber(item.y), width: finiteNumber(item.width), height: finiteNumber(item.height) }
}

export function parseBrowserElementPayload(value: unknown, fallback: BrowserRuntimeState): BrowserElementPayload {
  const source = record(value)
  const page = record(source.page)
  const viewport = record(page.viewport)
  const scroll = record(page.scroll)
  const target = record(source.target)
  const accessibility = record(target.accessibility)
  return {
    page: {
      url: text(page.url, fallback.url),
      title: text(page.title, fallback.title || 'Untitled page'),
      viewport: { width: finiteNumber(viewport.width), height: finiteNumber(viewport.height) },
      scroll: { x: finiteNumber(scroll.x), y: finiteNumber(scroll.y) },
      dpr: Math.max(1, finiteNumber(page.dpr) || 1),
      capturedAt: text(page.capturedAt, new Date().toISOString()),
    },
    target: {
      tag: safeInline(target.tag, 120) || 'element',
      selector: safeInline(target.selector, 700),
      fullPath: safeInline(target.fullPath, 900),
      classes: safeInline(target.classes, 500),
      sourceFile: safeInline(target.sourceFile, 500) || null,
      componentPath: safeInline(target.componentPath, 500) || null,
      selectedText: safeInline(target.selectedText, 500) || null,
      fixed: target.fixed === true,
      attributes: stringRecord(target.attributes),
      accessibility: {
        role: safeInline(accessibility.role, 120) || null,
        label: safeInline(accessibility.label, 240) || null,
      },
      rect: rect(target.rect),
      pageRect: rect(target.pageRect),
      styles: stringRecord(target.styles),
      text: safeInline(target.text, 4000),
      html: text(target.html, '').slice(0, 8000),
      nearbyElements: stringList(target.nearbyElements, 6),
    },
    nearby: stringList(source.nearby, 10),
    ancestors: stringList(source.ancestors, 10),
    delivery: source.delivery === 'screenshot' ? 'screenshot' : 'text',
  }
}

export function formatBrowserGrab(payload: BrowserElementPayload): string {
  const { page, target } = payload
  const lines = [`Attached browser context from ${page.url}`, '', 'Selected element:', target.tag]
  if (target.accessibility.label) lines.push(`Accessible name: "${target.accessibility.label}"`)
  if (target.accessibility.role) lines.push(`Role: ${target.accessibility.role}`)
  if (target.selector) lines.push(`Selector: ${target.selector}`)
  if (target.sourceFile) lines.push(`Source: ${target.sourceFile}`)
  if (target.componentPath) lines.push(`Component path: ${target.componentPath}`)
  lines.push(`Dimensions: ${Math.round(target.rect.width)}x${Math.round(target.rect.height)}`, '')
  if (target.text) lines.push('Text content:', target.text, '')
  if (payload.nearby.length) lines.push('Nearby context:', ...payload.nearby.map((item) => `- ${item}`), '')
  const styleLines = Object.entries(target.styles)
    .filter(([, value]) => value && value !== 'static' && value !== 'inline' && value !== 'rgba(0, 0, 0, 0)')
    .slice(0, 8)
    .map(([key, value]) => `  ${key}: ${value}`)
  if (styleLines.length) lines.push('Computed styles:', ...styleLines, '')
  if (target.html) lines.push('HTML:', target.html, '')
  if (payload.ancestors.length) lines.push(`Ancestor path: ${payload.ancestors.join(' > ')}`)
  if (target.fullPath) lines.push(`Full DOM path: ${target.fullPath}`)
  return lines.join('\n').trimEnd()
}

function annotationHeading(annotation: BrowserPageAnnotation, index: number): string {
  const { target } = annotation.payload
  const label = target.componentPath || `${target.tag}${target.accessibility.label ? ` "${target.accessibility.label}"` : ''}`
  return `### ${index + 1}. ${safeInline(label, 500)}`
}

export function formatBrowserAnnotations(annotations: readonly BrowserPageAnnotation[]): string {
  if (!annotations.length) return ''
  const first = annotations[0]
  let path = first.payload.page.url
  try {
    const parsed = new URL(first.payload.page.url)
    path = `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    // Keep the captured address when it is not an absolute URL.
  }
  const lines = [`## Design Feedback: ${path}`, '', `**Browser pane id:** ${first.browserId}`, '']
  annotations.forEach((annotation, index) => {
    const { payload } = annotation
    lines.push(annotationHeading(annotation, index))
    if (payload.target.selector) lines.push(`**Selector:** ${inlineCode(payload.target.selector)}`)
    if (payload.target.classes) lines.push(`**Classes:** ${inlineCode(payload.target.classes)}`)
    if (payload.target.sourceFile) lines.push(`**Source:** ${safeInline(payload.target.sourceFile, 500)}`)
    if (payload.target.componentPath) lines.push(`**Component path:** ${safeInline(payload.target.componentPath, 500)}`)
    lines.push(`**Intent:** ${annotation.intent}`)
    if (payload.target.selectedText) lines.push(`**Selected text:** "${safeInline(payload.target.selectedText, 500)}"`)
    if (payload.nearby.length) lines.push('**Nearby context:**', ...payload.nearby.map((item) => `- ${safeInline(item, 200)}`))
    const styles = Object.entries(payload.target.styles).slice(0, 8)
    if (styles.length) lines.push('**Computed styles:**', ...styles.map(([key, value]) => `- ${key}: ${safeInline(value, 200)}`))
    lines.push(`**Feedback:** ${safeInline(annotation.comment, 2000)}`, '')
  })
  return lines.join('\n').trimEnd()
}

export function browserFrameUrl(frame: BrowserFrame): string {
  return `data:image/png;base64,${frame.png_base64}`
}

export async function copyBrowserRegion(frame: BrowserFrame, payload: BrowserElementPayload): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image clipboard access is unavailable.')
  const image = new Image()
  image.src = browserFrameUrl(frame)
  await image.decode()
  const viewportWidth = Math.max(1, payload.page.viewport.width)
  const viewportHeight = Math.max(1, payload.page.viewport.height)
  const scaleX = frame.width / viewportWidth
  const scaleY = frame.height / viewportHeight
  const source = payload.target.rect
  const x = Math.max(0, Math.round(source.x * scaleX))
  const y = Math.max(0, Math.round(source.y * scaleY))
  const width = Math.max(1, Math.min(frame.width - x, Math.round(source.width * scaleX)))
  const height = Math.max(1, Math.min(frame.height - y, Math.round(source.height * scaleY)))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The screenshot crop canvas is unavailable.')
  context.drawImage(image, x, y, width, height, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The selected element screenshot could not be created.')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}
