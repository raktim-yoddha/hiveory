import type { ReactNode } from 'react'
import {
  Blocks,
  Bot,
  Compass,
  GitBranch,
  Keyboard,
  KanbanSquare,
  Layers,
  LayoutGrid,
  LifeBuoy,
  MessagesSquare,
  SquareTerminal,
  Workflow
} from 'lucide-react'

export interface GuideSection {
  heading: string
  body: ReactNode
  /** Extra words to match in search. */
  keywords?: string
}

export interface GuideChapter {
  id: string
  title: string
  summary: string
  icon: typeof Compass
  sections: GuideSection[]
}

const K = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>

export const GUIDE: GuideChapter[] = [
  {
    id: 'start',
    title: 'Getting started',
    summary: 'Open a project, create a workspace, start your first agents.',
    icon: Compass,
    sections: [
      {
        heading: 'Open a project',
        body: (
          <p>
            Click <b>Open project</b> (or the folder icon in the sidebar) and pick any local folder. Opening a project creates nothing —
            no workspace, branch or agent — until you ask for it.
          </p>
        )
      },
      {
        heading: 'Create a workspace',
        body: (
          <p>
            Press <b>+</b> next to the project name. Choose <b>Project folder</b> to work directly in the folder (one per project), or{' '}
            <b>New branch</b> for an isolated copy on its own Git branch so agents never collide.
          </p>
        )
      },
      {
        heading: 'Open agents',
        body: (
          <p>
            Pick CLIs and counts while creating the workspace, or use <b>Open agent</b> in an empty workspace. Every installed CLI is
            detected automatically; each instance gets its own pet name, terminal and status.
          </p>
        )
      }
    ]
  },
  {
    id: 'git',
    title: 'Workspaces & branches',
    summary: 'How isolation works, base branches, existing branches and cleanup.',
    icon: GitBranch,
    sections: [
      {
        heading: 'Isolated workspaces',
        body: (
          <p>
            A <b>New branch</b> workspace is a Git worktree: a separate folder that shares your repository but has its own branch and
            files. Hiveory creates the folder and branch for you (default <code>hiveory/&lt;name&gt;</code>) from the base branch you
            choose.
          </p>
        ),
        keywords: 'worktree isolation folder'
      },
      {
        heading: 'Use an existing branch',
        body: <p>Turn on “Use existing branch” to check out a branch you already have into a new isolated workspace.</p>
      },
      {
        heading: 'No Git yet?',
        body: <p>Isolation needs a Git repository with one commit. The create dialog offers to initialize Git and make that first commit.</p>,
        keywords: 'init initialize repository commit'
      },
      {
        heading: 'Status, pull requests and cleanup',
        body: (
          <p>
            The Workspaces tab shows each branch's changes and ahead/behind counts. With the GitHub CLI signed in, the Pull Requests tab
            lists PRs and can open one from a workspace branch. Deleting a workspace removes its folder; branches with unmerged commits
            are always kept. A missing folder can be repaired from the branch.
          </p>
        ),
        keywords: 'delete repair github gh pr'
      }
    ]
  },
  {
    id: 'panes',
    title: 'Agents & panes',
    summary: 'Pane controls, status colors, restart and maximize.',
    icon: Bot,
    sections: [
      {
        heading: 'Pane header',
        body: (
          <p>
            The logo is the CLI, the name is the agent. <b>+</b> opens another agent beside it (right or below), the expand icon maximizes
            (or double-click the header), <b>⋯</b> has restart, move and close. Narrow panes hide extras but always keep close.
          </p>
        )
      },
      {
        heading: 'Status colors',
        body: (
          <p>
            Grey = idle, green = working, amber = waiting for you (a permission, question or confirmation). A pane waiting for you also
            gets an amber edge. Hover the dot for the reason.
          </p>
        ),
        keywords: 'idle working waiting colour color'
      }
    ]
  },
  {
    id: 'layout',
    title: 'Arranging panes',
    summary: 'Dock, swap, resize and one-drop layouts.',
    icon: LayoutGrid,
    sections: [
      {
        heading: 'Drag to dock',
        body: <p>Drag a pane by its header onto the edge of another pane (or of the whole area). A preview shows where it lands.</p>
      },
      {
        heading: 'Swap',
        body: (
          <p>
            Hold <K>Space</K> while dragging and release over another pane to swap the two.
          </p>
        )
      },
      {
        heading: 'One-drop layouts',
        body: (
          <p>
            Drag a pane to the top edge: <b>Equal</b> divides the space evenly, <b>Focus</b> gives the dragged pane half and stacks the
            rest, <b>Columns</b> puts everything side by side.
          </p>
        ),
        keywords: 'equal focus columns arrange grid'
      },
      {
        heading: 'Resize',
        body: (
          <p>
            Drag the gap between panes, or focus it and use the arrow keys. Panes never shrink below a usable size; <b>⋯ → Move</b> rearranges
            from the keyboard.
          </p>
        )
      }
    ]
  },
  {
    id: 'kanban',
    title: 'The Kanban',
    summary: 'Idle, Working, Waiting for You — driven by real agent state.',
    icon: KanbanSquare,
    sections: [
      {
        heading: 'Three columns, no manual moves',
        body: (
          <p>
            The project's Tasks tab shows every agent sorted by what it is actually doing. Cards move by themselves; click one to jump to
            its pane.
          </p>
        )
      }
    ]
  },
  {
    id: 'presets',
    title: 'Presets',
    summary: 'Reusable sets of CLIs and counts.',
    icon: Layers,
    sections: [
      {
        heading: 'Save and load',
        body: <p>A preset remembers which CLIs, how many of each and the auto-approve setting — never the layout. Load one into any empty workspace.</p>
      }
    ]
  },
  {
    id: 'terminal',
    title: 'Terminal & side panel',
    summary: 'A real shell for each workspace.',
    icon: SquareTerminal,
    sections: [
      {
        heading: 'Side panel',
        body: <p>The right-panel button in the title bar opens a shell in the current workspace's folder. Agents can use it too, through their tools.</p>
      }
    ]
  },
  {
    id: 'tools',
    title: 'Agent tools',
    summary: 'Let agents see, message and coordinate each other.',
    icon: Workflow,
    sections: [
      {
        heading: 'What agents can do',
        body: (
          <p>
            Supported agents get a local MCP server named <code>hiveory</code>: list agents and their status, read another agent's screen,
            send it a message, wait for it, open or close agents, arrange panes and run terminal commands. Try asking an agent: “open a
            Codex agent next to you and ask it to review your last change.”
          </p>
        ),
        keywords: 'mcp coordinate orchestrate message'
      }
    ]
  },
  {
    id: 'chat',
    title: 'Chat',
    summary: 'A clean chat over any detected CLI.',
    icon: MessagesSquare,
    sections: [
      {
        heading: 'Pick, then talk',
        body: (
          <p>
            Choose a CLI, a model (search helps with long lists) and, when the model supports it, an effort level. The CLI locks once the
            chat starts. Chats keep running while you work elsewhere.
          </p>
        ),
        keywords: 'model effort thinking'
      }
    ]
  },
  {
    id: 'keys',
    title: 'Keyboard & clipboard',
    summary: 'Copy, paste, newlines and dictation in terminals.',
    icon: Keyboard,
    sections: [
      {
        heading: 'In agent terminals',
        body: (
          <ul>
            <li>
              <K>Ctrl</K> <K>C</K> copies a selection; with nothing selected it interrupts the agent.
            </li>
            <li>
              <K>Ctrl</K> <K>V</K> pastes text; if the clipboard holds an image, the agent receives it as its own paste.
            </li>
            <li>
              <K>Shift</K> <K>Enter</K> inserts a newline instead of sending.
            </li>
            <li>
              <K>Alt</K> shortcuts (e.g. <K>Alt</K> <K>V</K>) reach the agent untouched. Right-click copies or pastes.
            </li>
            <li>Dictation tools that paste (such as Wispr Flow) work like a normal paste.</li>
          </ul>
        ),
        keywords: 'shortcut copy paste wispr voice dictation'
      }
    ]
  },
  {
    id: 'extensions',
    title: 'Skills & MCP',
    summary: 'See what every agent can load.',
    icon: Blocks,
    sections: [
      {
        heading: 'Inventory',
        body: (
          <p>
            Settings → Skills &amp; MCP lists skills from the standard folders and MCP servers from each CLI's config, with which agents
            see them. Share a skill to <code>~/.agents/skills</code> to make it available to every standards-following agent.
          </p>
        )
      }
    ]
  },
  {
    id: 'help',
    title: 'Updates & troubleshooting',
    summary: 'Staying current and fixing common issues.',
    icon: LifeBuoy,
    sections: [
      {
        heading: 'Updates',
        body: <p>Settings → Updates checks GitHub releases on demand or automatically. Nothing downloads without your click.</p>
      },
      {
        heading: 'An agent shows "Not running"',
        body: <p>Agents are never relaunched automatically after a restart. Use Start (or Resume for Claude sessions) in the pane.</p>
      },
      {
        heading: 'A CLI is missing',
        body: <p>Install it so its command is on your PATH, then use “Detect CLIs again” in the create dialog.</p>
      }
    ]
  }
]
