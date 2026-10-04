/** electron-vite `?asset` imports resolve to an absolute file path at runtime. */
declare module '*?asset' {
  const path: string
  export default path
}
