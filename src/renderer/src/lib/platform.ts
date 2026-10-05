import { useApp } from '../stores/data'

/** The OS Hiveory runs on: from main once loaded, from the user agent before that. */
export function usePlatform(): 'win32' | 'darwin' | 'linux' {
  const platform = useApp((s) => s.info?.platform)
  if (platform) return platform
  const ua = navigator.userAgent
  return ua.includes('Mac OS') ? 'darwin' : ua.includes('Windows') ? 'win32' : 'linux'
}
