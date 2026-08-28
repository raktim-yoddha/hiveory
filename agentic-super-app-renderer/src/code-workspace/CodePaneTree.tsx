import React, { useRef } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { CodePaneLayout } from '../api/agentic-super-app-client'
import type { CodeWorkspaceController } from './state/use-code-workspace-controller'
import { CodePaneLeaf } from './CodePaneLeaf'

interface CodePaneTreeProps {
  nodeId: string
  layout: CodePaneLayout
  controller: CodeWorkspaceController
}

export const CodePaneTree: React.FC<CodePaneTreeProps> = ({
  nodeId,
  layout,
  controller,
}) => {
  const node = layout.nodes.find((n) => n.pane_id === nodeId)
  const resizeDebounceRef = useRef<number | null>(null)

  if (!node) {
    return <div className="code-pane-tree-error">Node {nodeId} not found</div>
  }

  // Leaf node
  if (node.children.length === 0) {
    return <CodePaneLeaf node={node} controller={controller} />
  }

  // Internal split node
  const orientation = node.orientation === 'vertical' ? 'vertical' : 'horizontal'
  const leftChildId = node.children[0]
  const rightChildId = node.children[1]
  const defaultRatio = node.ratio_percent ?? 50

  const handleLayoutChanged = (sizes: { [panelId: string]: number }) => {
    const leftSize = sizes[leftChildId]
    if (typeof leftSize === 'number') {
      const ratio = Math.round(leftSize)
      if (ratio >= 10 && ratio <= 90 && ratio !== node.ratio_percent) {
        if (resizeDebounceRef.current) clearTimeout(resizeDebounceRef.current)
        resizeDebounceRef.current = window.setTimeout(() => {
          void controller.resizeSplit(node.pane_id, ratio)
        }, 150)
      }
    }
  }

  return (
    <Group
      orientation={orientation}
      onLayoutChanged={handleLayoutChanged}
      className="code-pane-tree-group"
    >
      <Panel id={leftChildId} defaultSize={`${defaultRatio}%`} minSize="10%">
        <CodePaneTree nodeId={leftChildId} layout={layout} controller={controller} />
      </Panel>

      <Separator className="code-panel-resize-handle" />

      <Panel id={rightChildId} defaultSize={`${100 - defaultRatio}%`} minSize="10%">
        <CodePaneTree nodeId={rightChildId} layout={layout} controller={controller} />
      </Panel>
    </Group>
  )
}
