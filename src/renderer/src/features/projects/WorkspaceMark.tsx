import type { CSSProperties } from 'react'
import { Book, Bot, Box, Code, Database, FlaskConical, Folder, Globe, Palette, Rocket, Server, Smartphone, type LucideIcon } from 'lucide-react'
import { workspaceColor, type Project, type WorkspaceColor, type WorkspaceIcon } from '@shared/domain'

export const WORKSPACE_ICON: Record<WorkspaceIcon, LucideIcon> = {
  folder: Folder,
  code: Code,
  globe: Globe,
  box: Box,
  rocket: Rocket,
  flask: FlaskConical,
  book: Book,
  server: Server,
  phone: Smartphone,
  database: Database,
  palette: Palette,
  bot: Bot
}

/** Workspace colors come from the theme's own tokens, so every theme (VS Code ones too) keeps them readable. */
export const WORKSPACE_COLOR: Record<WorkspaceColor, string> = {
  accent: 'var(--color-accent)',
  blue: 'var(--term-blue)',
  cyan: 'var(--term-cyan)',
  green: 'var(--term-green)',
  yellow: 'var(--term-yellow)',
  red: 'var(--term-red)',
  magenta: 'var(--term-magenta)',
  gray: 'var(--color-text-muted)'
}

/** A Workspace's color as CSS: the one the user picked, else a theme color (ADR 0038, 0042). */
export const markColor = (project: Pick<Project, 'id' | 'settings'>): string => project.settings?.customColor ?? WORKSPACE_COLOR[workspaceColor(project)]

/** A Workspace's avatar, or its icon in its color (Settings › Icon and color, ADR 0038, 0042). Decorative: the name beside it labels it. */
export function WorkspaceMark({ project, className }: { project: Pick<Project, 'id' | 'settings'>; className?: string }) {
  if (project.settings?.avatar) return <img className={className} src={project.settings.avatar} alt="" draggable={false} style={{ borderRadius: 'var(--radius-xs)', objectFit: 'cover' }} />
  const Icon = WORKSPACE_ICON[project.settings?.icon ?? 'folder']
  return <Icon className={className} style={{ color: markColor(project) } as CSSProperties} aria-hidden />
}
