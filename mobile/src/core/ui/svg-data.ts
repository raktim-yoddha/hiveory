/**
 * The SVG markup inside a `data:image/svg+xml` URI (base64 or percent-encoded), or null for any other
 * image. React Native's Image draws PNG and JPEG but not SVG on phones, so SVG marks are drawn as SVG.
 */
export const svgFromDataUri = (src: string): string | null => {
  // Parameters such as ;charset=utf-8 may come before ;base64.
  const match = /^data:image\/svg\+xml((?:;[^;,]+)*),(.*)$/s.exec(src)
  if (!match) return null
  try {
    return /;base64$/i.test(match[1]!) ? atob(match[2]!) : decodeURIComponent(match[2]!)
  } catch {
    return null
  }
}
