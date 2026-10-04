/** A browser identity: its own cookies, storage and logins (an Electron session partition). */
export interface BrowserProfile {
  id: string
  name: string
  createdAt: string
}

export const DEFAULT_BROWSER_PROFILE: BrowserProfile = { id: 'default', name: 'Default', createdAt: '1970-01-01T00:00:00.000Z' }

/** An emulated screen in CSS pixels (Chrome DevTools' device mode). */
export interface Viewport {
  name: string
  width: number
  height: number
  /** Device pixel ratio; omitted = the screen's own. */
  scale?: number
  /** Touch, mobile layout (meta viewport) and a mobile user agent. Default: narrower than 768px. */
  mobile?: boolean
}

export type ViewportGroup = 'Phones' | 'Tablets' | 'Laptops & desktops'

/** Built-in devices (sizes and pixel ratios as in Chrome DevTools); Settings adds custom ones. */
export const VIEWPORT_PRESETS: Array<Viewport & { group: ViewportGroup }> = [
  { group: 'Phones', name: 'iPhone SE', width: 375, height: 667, scale: 2, mobile: true },
  { group: 'Phones', name: 'iPhone XR', width: 414, height: 896, scale: 2, mobile: true },
  { group: 'Phones', name: 'iPhone 12 Pro', width: 390, height: 844, scale: 3, mobile: true },
  { group: 'Phones', name: 'iPhone 14 Pro Max', width: 430, height: 932, scale: 3, mobile: true },
  { group: 'Phones', name: 'iPhone 15 Pro', width: 393, height: 852, scale: 3, mobile: true },
  { group: 'Phones', name: 'Pixel 7', width: 412, height: 915, scale: 2.625, mobile: true },
  { group: 'Phones', name: 'Samsung Galaxy S8+', width: 360, height: 740, scale: 4, mobile: true },
  { group: 'Phones', name: 'Samsung Galaxy S20 Ultra', width: 412, height: 915, scale: 3.5, mobile: true },
  { group: 'Phones', name: 'Galaxy Z Fold 5', width: 344, height: 882, scale: 2.625, mobile: true },
  { group: 'Phones', name: 'Mobile S', width: 320, height: 568, scale: 2, mobile: true },
  { group: 'Tablets', name: 'iPad Mini', width: 768, height: 1024, scale: 2, mobile: true },
  { group: 'Tablets', name: 'iPad Air', width: 820, height: 1180, scale: 2, mobile: true },
  { group: 'Tablets', name: 'iPad Pro', width: 1024, height: 1366, scale: 2, mobile: true },
  { group: 'Tablets', name: 'Surface Pro 7', width: 912, height: 1368, scale: 2, mobile: true },
  { group: 'Tablets', name: 'Surface Duo', width: 540, height: 720, scale: 2.5, mobile: true },
  { group: 'Tablets', name: 'Nest Hub', width: 1024, height: 600, scale: 2, mobile: true },
  { group: 'Tablets', name: 'Nest Hub Max', width: 1280, height: 800, scale: 2, mobile: true },
  { group: 'Laptops & desktops', name: 'Laptop', width: 1280, height: 800, scale: 1 },
  { group: 'Laptops & desktops', name: 'Laptop L', width: 1440, height: 900, scale: 1 },
  { group: 'Laptops & desktops', name: 'Desktop HD', width: 1920, height: 1080, scale: 1 },
  { group: 'Laptops & desktops', name: 'Desktop 2K', width: 2560, height: 1440, scale: 1 },
  { group: 'Laptops & desktops', name: '4K', width: 3840, height: 2160, scale: 1 }
]

export const isMobileViewport = (v: Viewport): boolean => v.mobile ?? v.width < 768

/** One page of the built-in browser. Pages live in main, so agents can drive them while the panel is closed. */
export interface BrowserPageView {
  id: string
  /** Side-panel scope: a workspace id (or a project id for pages opened on a project page). */
  scope: string
  profileId: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** Set when an agent opened the page. */
  ownerAgentId?: string
  ownerName?: string
  viewport: Viewport | null
  devToolsOpen: boolean
  /** An agent is acting on the page right now (or did a moment ago). */
  agentActive: boolean
}

/** An element the user picked in the page. */
export interface PickedElement {
  /** Snapshot ref agents can act on until the page navigates, e.g. "@12". */
  ref: string
  role: string
  name: string
  selector: string
  text: string
  html: string
}

/** A note the user pinned to an element, for agents to read. */
export interface BrowserAnnotation {
  id: string
  pageId: string
  url: string
  element: PickedElement
  note: string
  createdAt: string
}

export interface BrowserState {
  pages: BrowserPageView[]
  profiles: BrowserProfile[]
  annotations: BrowserAnnotation[]
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}
