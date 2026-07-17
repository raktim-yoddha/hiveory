// Minimal Chrome DevTools Protocol client.
//
// The Tauri webview offers no capture API, so the browser pane drives a real
// headless Chromium over CDP: we get a live screencast, input dispatch, and —
// the point of the exercise — real screenshots QueenBee/WorkerBees can read.

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export interface ScreencastFrameMeta {
  offsetTop: number;
  pageScaleFactor: number;
  deviceWidth: number;
  deviceHeight: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
}

export class CdpClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Map<string, Set<(params: any) => void>>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.onmessage = (ev) => this.handle(ev.data);
  }

  static connect(wsUrl: string, timeoutMs = 10_000): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("CDP connection timed out"));
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(new CdpClient(ws));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("CDP connection failed"));
      };
    });
  }

  private handle(raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"));
      else p.resolve(msg.result);
      return;
    }

    // Events are keyed by method; session-scoped events carry a sessionId but
    // one pane owns exactly one session, so method alone is enough to route.
    if (msg.method) {
      this.listeners.get(msg.method)?.forEach((cb) => cb(msg.params));
    }
  }

  send<T = any>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    if (this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("CDP socket is not open"));
    }
    const id = this.nextId++;
    const payload: any = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  /** Subscribe to a CDP event. Returns an unsubscribe function. */
  on(event: string, cb: (params: any) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  close() {
    this.pending.forEach((p) => p.reject(new Error("CDP client closed")));
    this.pending.clear();
    this.listeners.clear();
    try { this.ws.close(); } catch {}
  }
}

// NOTE: resolving the endpoint is done in Rust (`cdp_ws_url`), not here.
// Chromium's DevTools HTTP endpoint sends no CORS headers, so fetching
// http://127.0.0.1:9222/json/version from the renderer is blocked by the
// browser. Rust has no origin, so it just works. The ws:// upgrade below is
// exempt from CORS, so connecting from the renderer is fine.

/**
 * Normalize what a user typed into a navigable URL.
 *
 * This pane exists to test the app you're developing, so input is biased to
 * localhost: a bare port or path means your dev server. There's deliberately no
 * web-search fallback — a typo should fail loudly, not silently open the web.
 */
export function normalizeUrl(input: string, defaultPort = 3000): string {
  const v = input.trim();
  if (!v) return "about:blank";
  if (/^[a-z]+:\/\//i.test(v) || v.startsWith("about:")) return v;

  // "3000" -> localhost:3000
  if (/^\d+$/.test(v)) return `http://localhost:${v}`;
  // "/dashboard" -> a path on the default dev server
  if (v.startsWith("/")) return `http://localhost:${defaultPort}${v}`;
  // Loopback hosts, with or without an explicit port: "localhost",
  // "localhost:5173/path", "127.0.0.1:8080". A missing port means the dev server.
  const loopback = v.match(/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/.*)?$/i);
  if (loopback) {
    const [, host, port, path] = loopback;
    return `http://${host}${port ?? `:${defaultPort}`}${path ?? ""}`;
  }
  // Anything else that looks like a host still works (LAN device, staging box).
  if (/^[\w.-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(v) || /^[\w-]+:\d+(\/|$)/.test(v)) {
    return `http://${v}`;
  }
  // Not a URL — surface it instead of guessing.
  throw new Error(`Not a valid address: "${input}". Try 3000, localhost:5173, or /path`);
}
