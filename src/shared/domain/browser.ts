/** A browser identity: its own cookies, storage and logins (an Electron session partition). */
export interface BrowserProfile {
  id: string
  name: string
  createdAt: string
}

export const DEFAULT_BROWSER_PROFILE: BrowserProfile = { id: 'default', name: 'Default', createdAt: '1970-01-01T00:00:00.000Z' }

/** An emulated screen size in CSS pixels. */
export interface Viewport {
  name: string
  width: number
  height: number
}

/** Built-in viewport sizes; Settings adds custom ones. */
export const VIEWPORT_PRESETS: Viewport[] = [
  { name: 'Mobile S', width: 320, height: 568 },
  { name: 'Mobile M', width: 375, height: 667 },
  { name: 'Mobile L', width: 425, height: 812 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Laptop', width: 1024, height: 768 },
  { name: 'Laptop L', width: 1440, height: 900 },
  { name: 'Desktop', width: 1920, height: 1080 }
]

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
