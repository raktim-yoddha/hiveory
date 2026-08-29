import type { CodePanePreset } from '../api/agentic-super-app-client'

export interface CodePanePresetMeta {
  id: CodePanePreset
  label: string
  description: string
  maxPanes: number
  thumbnailType: 'vertical' | 'horizontal' | 'two_rows' | 'three_rows' | 'four_rows' | 'focus'
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
    id: 'two_rows',
    label: '2 Rows',
    description: 'Up to 4 columns, max 2 rows each (up to 8 panes)',
    maxPanes: 8,
    thumbnailType: 'two_rows',
  },
  {
    id: 'three_rows',
    label: '3 Rows',
    description: 'Up to 4 columns, max 3 rows each (up to 12 panes)',
    maxPanes: 12,
    thumbnailType: 'three_rows',
  },
  {
    id: 'four_rows',
    label: '4 Rows',
    description: 'Up to 4 columns, max 4 rows each (up to 16 panes)',
    maxPanes: 16,
    thumbnailType: 'four_rows',
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
