import type { Side } from '../domain/layout'
import type { QueenAction, QueenContext, QueenLayout, QueenPaneSize, QueenParse } from './actions'
import { fold, hasWord, norm } from './words'

/**
 * Pane commands (ADR 0048): lay a worktree's panes out as a grid, columns, rows or around one
 * agent, swap two agents' panes, move one to a side or beside another, and make one bigger or
 * smaller. Agents are named by their pet names, in the current worktree only.
 */

const actions = (...list: QueenAction[]): QueenParse => ({ kind: 'actions', actions: list })
const ask = (text: string, choices?: Array<{ label: string; command: string }>): QueenParse => ({ kind: 'ask', question: { text, choices } })

const ARRANGE = /^(arrange|rearrange|tidy|tidy up|organi[sz]e|reorgani[sz]e|even out|equali[sz]e|line up|reset|clean up|put|lay out|layout|make|set|split|tile|stack|show|order|reorder|turn|change|switch)\b/
const PANES = /\b(panes?|panels?|agents?|windows?|terminals?|layout|them|everything|everyone)\b/
const COLUMNS = /\b(columns?|side by side|in a row|one row|left to right)\b/
const ROWS = /\b(rows?|stacked|on top of each other|one above (another|other)|top to bottom)\b/
const GRID = /\b(grid|tiles?|tiled|equal|equally|even|evenly|square)\b/
/** A whole command that is only a layout: "grid", "grid layout", "as columns". */
const LAYOUT_ONLY = /^(as |in )?(a )?(grid|columns|rows|tiles|tiled)( layout| view)?$/
const FOCUS = /\b(main|big|biggest|large|largest|center|centre|spotlight|front|focus layout|half)\b/
const SIZES: Array<[RegExp, QueenPaneSize]> = [
  [/\b(wider|broader)\b/, 'wider'],
  [/\b(narrower|thinner)\b/, 'narrower'],
  [/\b(taller|longer)\b/, 'taller'],
  [/\b(shorter)\b/, 'shorter'],
  [/\b(bigger|larger|grow|expand|enlarge|more (room|space))\b/, 'bigger'],
  [/\b(smaller|shrink|less (room|space))\b/, 'smaller']
]
const SWAP = /^(swap|switch|exchange|flip|trade)\b/
const MOVE = /^(move|put|place|dock|drag|shift)\b/
/** Resizing and the focus layout start with one of these, so "tell Bruno to make it bigger" stays a message. */
const SIZE_VERB = /^(make|give|let|grow|expand|enlarge|shrink|resize|widen|set|put|focus)\b/
/** Where a pane goes, beside another agent's pane ("left of Luna") or along the layout's edge ("to the left"). */
const SIDES: Array<[RegExp, Side]> = [
  [/\b(left|leftmost|first|start|beginning)\b/, 'left'],
  [/\b(right|rightmost|last|end|next to|beside|after)\b/, 'right'],
  [/\b(top|up|above|over)\b/, 'top'],
  [/\b(bottom|down|below|under|beneath)\b/, 'bottom']
]

/** Agents of the worktree named in the text, in the order they are said. */
const namedHere = (text: string, ctx: QueenContext): QueenContext['agents'] =>
  ctx.agents
    .filter((a) => a.workspaceId === ctx.workspaceId && hasWord(text, norm(a.petName)))
    .sort((a, b) => ` ${text} `.indexOf(` ${norm(a.petName)} `) - ` ${text} `.indexOf(` ${norm(b.petName)} `))

const layoutOf = (text: string): QueenLayout | null => (COLUMNS.test(text) ? 'columns' : ROWS.test(text) ? 'rows' : GRID.test(text) ? 'equal' : null)

/** Parses one pane command; null when it is not one. */
export function parsePaneCommand(raw: string, ctx: QueenContext): QueenParse | null {
  const text = fold(raw)
  if (!text) return null
  const named = namedHere(text, ctx)
  const here = ctx.agents.filter((a) => a.workspaceId === ctx.workspaceId)
  const choices = (verb: string) => here.slice(0, 4).map((a) => ({ label: a.petName, command: `${verb.replace('%', a.petName)}` }))

  // "swap Bruno and Luna".
  if (SWAP.test(text) && named.length === 2) return actions({ type: 'swap-panes', agentId: named[0]!.id, targetAgentId: named[1]!.id })

  // "move Bruno to the left", "put Bruno below Luna".
  if (MOVE.test(text) && named.length >= 1 && !layoutOf(text)) {
    const side = SIDES.find(([re]) => re.test(text))?.[1]
    if (side) {
      const target = named[1]
      return actions({ type: 'move-pane', agentId: named[0]!.id, side, ...(target ? { targetAgentId: target.id } : {}) })
    }
  }

  // "make Bruno bigger", "give Luna more room".
  const size = SIZES.find(([re]) => re.test(text))?.[1]
  if (size && named.length === 1 && SIZE_VERB.test(text)) return actions({ type: 'resize-pane', agentId: named[0]!.id, size })

  // "make Bruno the main pane", "focus layout on Luna", "give Bruno half the screen".
  if (FOCUS.test(text) && (named.length === 1 || /\bfocus layout\b/.test(text)) && SIZE_VERB.test(text)) {
    if (!ctx.workspaceId) return ask('Open a worktree first, then I can arrange its panes.')
    if (named.length !== 1) return ask('Which agent should take the main spot?', choices('make % the main pane'))
    return actions({ type: 'arrange', layout: 'focus', workspaceId: ctx.workspaceId, agentId: named[0]!.id })
  }

  // "arrange them in a grid", "put the panes in columns", "stack the agents", "grid", "tidy up".
  const layout = layoutOf(text)
  const isArrange =
    (layout && named.length === 0 && (ARRANGE.test(text) || LAYOUT_ONLY.test(text))) ||
    (/^(arrange|rearrange|tidy|tidy up|organi[sz]e|even out|equali[sz]e|line up|reset|clean up)\b/.test(text) && PANES.test(text)) ||
    /^(arrange|rearrange|tidy up)$/.test(text) ||
    (/^stack\b/.test(text) && named.length === 0)
  if (!isArrange) return null
  if (!ctx.workspaceId) return ask('Open a worktree first, then I can arrange its panes.')
  return actions({ type: 'arrange', layout: layout ?? (/^stack\b/.test(text) ? 'rows' : 'equal'), workspaceId: ctx.workspaceId })
}
