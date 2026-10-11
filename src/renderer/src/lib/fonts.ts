import { FONT_FAMILY } from '@shared/domain'

type LocalFont = { family: string }

/**
 * Installed monospaced font families, by name (Local Font Access). A family counts as monospaced
 * when narrow and wide letters measure the same. [] when the platform doesn't share its fonts.
 */
export const monospaceFamilies = async (): Promise<string[]> => {
  const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts
  if (!query) return []
  const fonts = await query.call(window).catch((): LocalFont[] => [])
  const ctx = document.createElement('canvas').getContext('2d')
  const families = [...new Set(fonts.map((f) => f.family))].filter((f) => FONT_FAMILY.test(f)).sort((a, b) => a.localeCompare(b))
  if (!ctx) return families
  return families.filter((family) => {
    ctx.font = `16px "${family}", serif`
    return Math.abs(ctx.measureText('iiiiiiii').width - ctx.measureText('WWWWWWWW').width) < 0.5
  })
}
