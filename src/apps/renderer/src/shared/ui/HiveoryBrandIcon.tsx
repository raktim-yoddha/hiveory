import { PlugZap } from 'lucide-react'
import { faSlack } from '@fortawesome/free-brands-svg-icons'
import { siCloudflare, siGithub, siGmail, siJira, siLinear, siNotion, siShopify, siStripe, siSupabase, siVercel, type SimpleIcon } from 'simple-icons'

type BrandDefinition = { icon?: SimpleIcon; path?: string; hex?: string; monochrome?: boolean }

const brands: Record<string, BrandDefinition> = {
  cloudflare: { icon: siCloudflare },
  github: { icon: siGithub, monochrome: true },
  gmail: { icon: siGmail },
  jira: { icon: siJira },
  linear: { icon: siLinear, monochrome: true },
  notion: { icon: siNotion, monochrome: true },
  shopify: { icon: siShopify },
  slack: { path: faSlack.icon[4] as string, hex: '4A154B' },
  stripe: { icon: siStripe },
  supabase: { icon: siSupabase },
  vercel: { icon: siVercel, monochrome: true },
}

export function HiveoryBrandIcon({ provider, size = 20, label }: { provider: string; size?: number; label?: string }) {
  const brand = brands[provider.trim().toLocaleLowerCase()]
  if (!brand) return <PlugZap size={size} aria-label={label} aria-hidden={label ? undefined : true} />
  return <svg className="hiveory-brand-icon" width={size} height={size} viewBox="0 0 24 24" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}><path d={brand.path ?? brand.icon?.path} fill={brand.monochrome ? 'currentColor' : `#${brand.hex ?? brand.icon?.hex}`} /></svg>
}

export function hasHiveoryBrandIcon(provider: string) { return provider.trim().toLocaleLowerCase() in brands }
