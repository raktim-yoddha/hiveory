import { Image, Text } from 'react-native'
import {
  Book,
  Bot,
  Box,
  Braces,
  Briefcase,
  Building2,
  Code,
  Cpu,
  Database,
  Folder,
  FlaskConical,
  Gauge,
  Globe,
  Layers,
  Package,
  Palette as PaletteIcon,
  Rocket,
  Server,
  Shapes,
  Smartphone,
  Sparkles,
  SquareTerminal,
  Wrench,
  type LucideIcon
} from 'lucide-react-native'
import { workspaceColor, type Project, type WorkspaceColor, type WorkspaceIcon } from '@shared/domain/project'
import { useTheme, type Palette } from '../theme'

const ICONS: Record<WorkspaceIcon, LucideIcon> = {
  folder: Folder,
  code: Code,
  terminal: SquareTerminal,
  bot: Bot,
  package: Package,
  database: Database,
  globe: Globe,
  server: Server,
  cpu: Cpu,
  layers: Layers,
  braces: Braces,
  rocket: Rocket,
  wrench: Wrench,
  briefcase: Briefcase,
  building: Building2,
  palette: PaletteIcon,
  gauge: Gauge,
  sparkles: Sparkles,
  shapes: Shapes,
  box: Box,
  flask: FlaskConical,
  book: Book,
  phone: Smartphone
}

/** The theme color for a Workspace color, as on the computer (its accent and terminal palette). */
const colorOf = (c: Palette, color: WorkspaceColor): string =>
  color === 'accent' ? c.accent : color === 'gray' ? c.textMuted : c.terminal[color]

/** A Workspace's avatar, or its icon in its color, set in its Settings on the computer (ADR 0038, 0039, 0042). */
export function WorkspaceMark({ project, size = 18 }: { project: Pick<Project, 'id' | 'settings'>; size?: number }) {
  const { colors } = useTheme()
  if (project.settings?.emoji) return <Text style={{ fontSize: size * 0.9, lineHeight: size }}>{project.settings.emoji}</Text>
  if (project.settings?.avatar) return <Image source={{ uri: project.settings.avatar }} style={{ width: size, height: size, borderRadius: 4 }} accessibilityIgnoresInvertColors />
  const Icon = ICONS[project.settings?.icon ?? 'folder']
  return <Icon size={size} color={project.settings?.customColor ?? colorOf(colors, workspaceColor(project))} />
}
