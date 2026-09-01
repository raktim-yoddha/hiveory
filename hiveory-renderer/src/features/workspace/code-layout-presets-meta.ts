import type { CodePanePreset } from '../../shared/api/hiveory-client'

export interface CodePanePresetMeta {
  id: CodePanePreset
  label: string
  description: string
  maxPanes: number
  thumbnailType: 'vertical' | 'horizontal' | 'equal' | 'focus' | 'two_rows' | 'three_rows' | 'four_rows'
}

export const PRIMARY_PRESETS: CodePanePresetMeta[] = [
  {
    id: 'vertical',
    label: 'Vertical',
    description: 'Equal side-by-side columns (up to 4 panes)',
    maxPanes: 4,
    thumbnailType: 'vertical',
  },
  {
    id: 'horizontal',
    label: 'Horizontal',
    description: 'Equal stacked rows (up to 4 panes)',
    maxPanes: 4,
    thumbnailType: 'horizontal',
  },
  {
    id: 'equal',
    label: 'Equal',
    description: 'Equal balanced grid across all panes (up to 16 panes)',
    maxPanes: 16,
    thumbnailType: 'equal',
  },
  {
    id: 'focus',
    label: 'Focus',
    description: '60% primary focus pane with supporting stack (up to 17 panes)',
    maxPanes: 17,
    thumbnailType: 'focus',
  },
]

export function getPresetMeta(id: CodePanePreset): CodePanePresetMeta | undefined {
  return PRIMARY_PRESETS.find((p) => p.id === id)
}

export function isPresetCompatible(presetId: CodePanePreset, paneCount: number): boolean {
  const meta = getPresetMeta(presetId)
  if (!meta) return true
  return paneCount <= meta.maxPanes
}
