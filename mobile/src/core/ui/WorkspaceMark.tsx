import { Book, Bot, Box, Code, Database, Folder, FlaskConical, Globe, Palette as PaletteIcon, Rocket, Server, Smartphone, type LucideIcon } from 'lucide-react-native'
import { workspaceColor, type Project, type WorkspaceColor, type WorkspaceIcon } from '@shared/domain/project'
import { useTheme, type Palette } from '../theme'

const ICONS: Record<WorkspaceIcon, LucideIcon> = {
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
  palette: PaletteIcon,
  bot: Bot
}

/** The theme color for a Workspace color, as on the computer (its accent and terminal palette). */
const colorOf = (c: Palette, color: WorkspaceColor): string =>
  color === 'accent' ? c.accent : color === 'gray' ? c.textMuted : c.terminal[color]

/** A Workspace's icon in its color, set in its Settings on the computer (ADR 0038, 0039). */
export function WorkspaceMark({ project, size = 18 }: { project: Pick<Project, 'id' | 'settings'>; size?: number }) {
  const { colors } = useTheme()
  const Icon = ICONS[project.settings?.icon ?? 'folder']
  return <Icon size={size} color={colorOf(colors, workspaceColor(project))} />
}
