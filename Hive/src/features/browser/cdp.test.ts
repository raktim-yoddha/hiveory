import { describe, it, expect } from "vitest";
import { normalizeUrl } from "./cdp";

// The browser pane is for testing the app you're building, so input is biased
// to localhost and there is no web-search fallback.
describe("normalizeUrl", () => {
  it("treats a bare port as the local dev server", () => {
    expect(normalizeUrl("3000")).toBe("http://localhost:3000");
    expect(normalizeUrl("5173")).toBe("http://localhost:5173");
  });

  it("treats a bare path as a route on the default dev server", () => {
    expect(normalizeUrl("/dashboard")).toBe("http://localhost:3000/dashboard");
    expect(normalizeUrl("/a/b?c=1", 8080)).toBe("http://localhost:8080/a/b?c=1");
  });

  it("keeps localhost/loopback hosts on http", () => {
    expect(normalizeUrl("localhost:5173")).toBe("http://localhost:5173");
    expect(normalizeUrl("127.0.0.1:8080/x")).toBe("http://127.0.0.1:8080/x");
    expect(normalizeUrl("0.0.0.0:9000")).toBe("http://0.0.0.0:9000");
    expect(normalizeUrl("localhost")).toBe("http://localhost:3000");
  });

  it("passes explicit schemes through untouched", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
    expect(normalizeUrl("http://localhost:1234/x")).toBe("http://localhost:1234/x");
    expect(normalizeUrl("about:blank")).toBe("about:blank");
  });

  it("blanks empty input", () => {
    expect(normalizeUrl("")).toBe("about:blank");
    expect(normalizeUrl("   ")).toBe("about:blank");
  });

  it("still allows a LAN/staging host", () => {
    expect(normalizeUrl("dev.local:8080")).toBe("http://dev.local:8080");
    expect(normalizeUrl("192.168.1.50:3000")).toBe("http://192.168.1.50:3000");
  });

  it("throws on junk instead of silently opening a web search", () => {
    expect(() => normalizeUrl("how do i center a div")).toThrow(/Not a valid address/);
    expect(() => normalizeUrl("!!!")).toThrow();
  });
});
