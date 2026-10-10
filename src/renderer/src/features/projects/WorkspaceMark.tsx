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

/** A Workspace's icon in its color (Settings › Icon and color, ADR 0038). Decorative: the name beside it labels it. */
export function WorkspaceMark({ project, className }: { project: Pick<Project, 'id' | 'settings'>; className?: string }) {
  const Icon = WORKSPACE_ICON[project.settings?.icon ?? 'folder']
  return <Icon className={className} style={{ color: WORKSPACE_COLOR[workspaceColor(project)] } as CSSProperties} aria-hidden />
}
