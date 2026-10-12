import type { ComponentType, ReactNode, SVGProps } from 'react'
import {
  Blocks,
  Bot,
  CalendarClock,
  Compass,
  GitBranch,
  GitPullRequest,
  Globe,
  Keyboard,
  KanbanSquare,
  LayoutGrid,
  LifeBuoy,
  MessagesSquare,
  Palette,
  Smartphone
} from 'lucide-react'
import { AgentIcon } from '../../../components/brand/AgentIcon'
import { QueenIcon } from '../../../components/brand/QueenIcon'

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
  icon: ComponentType<SVGProps<SVGSVGElement>>
  sections: GuideSection[]
}

const K = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>

/**
 * The field guide (Settings › Guide, ADR 0044): one short chapter per part of the app, in the words the
 * app uses. Kept in step with APP_GUIDE (src/shared/hiveory/guide.ts), which agents and Queen Bee read.
 */
export const GUIDE: GuideChapter[] = [
  {
    id: 'start',
    title: 'Getting started',
    summary: 'Add a workspace, open a worktree, start your first agents.',
    icon: Compass,
    sections: [
      {
        heading: 'Add a workspace',
        body: (
          <p>
            A workspace is a folder or repository. Click <b>Add workspace</b> (the folder icon in the sidebar): pick a local folder,
            create or clone a repository, choose a folder on an SSH host, or restore one you removed with its worktrees and agents.
          </p>
        )
      },
      {
        heading: 'Worktrees',
        body: (
          <p>
            Each workspace opens on its <b>Primary</b> worktree: the folder itself. Press <b>+</b> beside the workspace for another
            worktree, an isolated copy on its own branch, so agents working on different things never collide.
          </p>
        )
      },
      {
        heading: 'Open agents',
        body: (
          <p>
            In an empty worktree use <b>Open agent</b> (or <b>Load preset</b>); in a busy one, a pane&rsquo;s <b>+</b>. Every installed CLI
            is found by itself. Each agent gets its own name, terminal or chat view, and status.
          </p>
        ),
        keywords: 'cli claude codex gemini pet name'
      },
      {
        heading: 'Your first choices',
        body: (
          <p>
            The welcome asks how panes share a worktree (<b>Tiles</b> side by side, or <b>Tabs</b> like Orca) and whether surfaces have
            air between them (<b>Spaced</b>) or meet edge to edge (<b>Attached</b>). Both change any time in Settings › Appearance › Panes.
          </p>
        ),
        keywords: 'tiles tabs spaced attached welcome onboarding'
      }
    ]
  },
  {
    id: 'git',
    title: 'Worktrees & Git',
    summary: 'Isolation, branches, the Primary, reviews and cleanup.',
    icon: GitBranch,
    sections: [
      {
        heading: 'New worktrees',
        body: (
          <p>
            A new worktree is its own folder sharing your repository, on its own branch (<code>hiveory/&lt;name&gt;</code> by default) from
            the base you choose. Turn on <b>Use existing branch</b> to check out one you have, or pick a remote branch. Hiveory runs the Git
            commands; you never manage worktrees by hand.
          </p>
        ),
        keywords: 'branch base isolated'
      },
      {
        heading: 'No Git yet?',
        body: <p>Worktrees need a repository with one commit. The create dialog offers to initialize Git and make that first commit.</p>,
        keywords: 'init initialize repository commit'
      },
      {
        heading: 'Reviews and issues',
        body: (
          <p>
            The Dashboard&rsquo;s <b>Worktrees</b> tab shows each branch&rsquo;s changes, ahead/behind and its pull request (merge request on
            GitLab); <b>Create PR</b> pushes the branch and opens one. The <b>Issues</b> tab lists issues from GitHub, GitLab, Jira or Linear;{' '}
            <b>Start worktree</b> names a worktree after an issue, shows it on the card and tells its agents.
          </p>
        ),
        keywords: 'github gitlab pr merge request issue'
      },
      {
        heading: 'Delete and repair',
        body: (
          <p>
            Deleting a worktree removes its folder; a branch with unmerged commits is always kept. A missing folder can be repaired from its
            branch. The Primary is never deleted, only removed from Hiveory.
          </p>
        ),
        keywords: 'delete remove repair cleanup'
      }
    ]
  },
  {
    id: 'panes',
    title: 'Agents & panes',
    summary: 'The pane header, status, terminals, presets and memory.',
    icon: AgentIcon,
    sections: [
      {
        heading: 'Pane header',
        body: (
          <p>
            The logo is the CLI, the name is the agent: right-click it for Rename, Restart, Move and Close (right-click twice renames). The{' '}
            <b>+</b> opens an agent, terminal or browser beside it; double-click the header to maximize.
          </p>
        )
      },
      {
        heading: 'Status',
        body: (
          <p>
            Grey is idle, green is working, amber is waiting for you (a permission, question or confirmation) — the pane gets an amber edge
            too. Hover the dot for the reason. Terminals are not agents: they have no status and no Kanban card.
          </p>
        ),
        keywords: 'idle working waiting colour color dot'
      },
      {
        heading: 'Terminal or chat',
        body: (
          <p>
            An agent runs in its own terminal, or in a chat view for CLIs that have one (each workspace picks a default in its settings).
            Click anywhere in a chat to type.
          </p>
        ),
        keywords: 'chat ui view'
      },
      {
        heading: 'Presets',
        body: <p>A preset remembers which CLIs, how many of each, auto-approve and chat view — never the layout. Load one into any empty worktree.</p>,
        keywords: 'preset save load'
      },
      {
        heading: 'Memory',
        body: (
          <p>
            Agents keep working with the window closed (Hiveory stays in the tray). After a quit, a reboot or removing and restoring a
            workspace, every agent comes back and resumes its own conversation; terminals show what they printed last time.
          </p>
        ),
        keywords: 'resume restart reopen tray background scrollback'
      }
    ]
  },
  {
    id: 'layout',
    title: 'Arranging panes',
    summary: 'Tiles or tabs, dock, swap, resize and one-drop layouts.',
    icon: LayoutGrid,
    sections: [
      {
        heading: 'Drag to dock',
        body: <p>Drag a pane by its header (or a tab) onto the edge of another pane or of the whole area. A preview shows where it lands.</p>
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
        heading: 'Tabs',
        body: (
          <p>
            In the Tabs style each area holds several panes as tabs; <b>+</b> after the last tab opens one there. Drag a tab along its strip to
            reorder, onto another strip to move it, into an area to add it, or to an edge to split it out. Middle-click closes.
          </p>
        ),
        keywords: 'tabs strip reorder split'
      },
      {
        heading: 'One-drop layouts and resizing',
        body: (
          <p>
            Drag a pane to the top edge: <b>Equal</b>, <b>Focus</b> (half for it, the rest stacked) or <b>Columns</b>. Drag the line between
            panes to resize, or focus it and use the arrow keys.
          </p>
        ),
        keywords: 'equal focus columns arrange resize'
      }
    ]
  },
  {
    id: 'kanban',
    title: 'The Kanban & Dashboard',
    summary: 'Every agent by what it is really doing, and the side panel.',
    icon: KanbanSquare,
    sections: [
      {
        heading: 'Three columns, no manual moves',
        body: (
          <p>
            The Dashboard&rsquo;s <b>Tasks</b> tab sorts the workspace&rsquo;s agents into Idle, Working and Waiting for you by their real state.
            Cards move by themselves; click one to jump to its pane.
          </p>
        )
      },
      {
        heading: 'The side panel',
        body: (
          <p>
            Inside a worktree the side panel holds the Dashboard, Sessions (every CLI conversation, resumable), the Explorer, Schedules and the
            workspace&rsquo;s Settings. Drag a tab into its lower half to see two at once; maximize it over the main area with its corner
            button.
          </p>
        ),
        keywords: 'sessions explorer side panel dashboard'
      },
      {
        heading: 'Files',
        body: <p>Double-click a file in the Explorer to edit it as a pane (Ctrl+S saves). It reloads when an agent changes it on disk.</p>,
        keywords: 'explorer editor file'
      }
    ]
  },
  {
    id: 'browser',
    title: 'Built-in browser',
    summary: 'A real browser your agents can drive, beside them.',
    icon: Globe,
    sections: [
      {
        heading: 'Pages are panes',
        body: (
          <p>
            Open a page from a pane&rsquo;s <b>+</b> › Browser. A page an agent opens appears beside that agent (a tab in its area in the Tabs
            style), named after it, with its cursor visible while it works. A page steps aside while a menu or dialog is open over it.
          </p>
        ),
        keywords: 'page pane agent cursor'
      },
      {
        heading: 'Notes for agents',
        body: (
          <p>
            <b>Annotate</b> picks elements one after another and writes a note for each in a card on the page — a change or a question — then
            sends them to an agent. <b>Pick element</b> copies one element for pasting to an agent.
          </p>
        ),
        keywords: 'annotate pick element note'
      },
      {
        heading: 'Profiles and devices',
        body: (
          <p>
            Profiles keep separate cookies and logins (import, export or clear them from the menu). The device toolbar emulates phones,
            tablets and desktops. Settings › Browser turns agent browsing on or off and sets the home page and sizes.
          </p>
        ),
        keywords: 'profile cookies device viewport mobile'
      }
    ]
  },
  {
    id: 'queen',
    title: 'Queen Bee',
    summary: 'Run the app by voice or text.',
    icon: QueenIcon,
    sections: [
      {
        heading: 'Call her',
        body: (
          <p>
            Tap her shortcut (<K>Win</K> <K>Alt</K> by default, <K>⌘</K> <K>⌥</K> on a Mac) to type, hold it to talk. She opens, closes,
            restarts and finds agents, messages them (&ldquo;tell Bruno to run the tests&rdquo;), reports who is waiting, switches pages and
            changes a few settings. She asks before closing or guessing.
          </p>
        ),
        keywords: 'shortcut voice talk command'
      },
      {
        heading: 'Where she sits',
        body: (
          <p>
            Docked under the main area, floating over it, or put away in the title bar: only her mark stays there and her bar drops down
            when you click it or press her shortcut. Change it in her <b>⋯</b> menu or Settings › Queen Bee › Bar &amp; shortcut.
          </p>
        ),
        keywords: 'docked floating title bar hide disable'
      },
      {
        heading: 'Voice, models and notes',
        body: (
          <p>
            Speech packs download on request and run on this computer. A model (your key, a local server, or your Codex or Claude plan) is
            optional: it only handles what her rules don&rsquo;t understand. &ldquo;Remember that…&rdquo; saves a note; notes stay on this
            computer.
          </p>
        ),
        keywords: 'provider model voice notes memory'
      }
    ]
  },
  {
    id: 'bots',
    title: 'Bots',
    summary: 'Teammates with a brief, memory and their own threads.',
    icon: Bot,
    sections: [
      {
        heading: 'A bot',
        body: (
          <p>
            Each bot has a name, a brief, an engine and model, and a memory it carries into every new thread. Threads keep running while you
            are elsewhere. Bots are grouped into teams; each team&rsquo;s <b>Chief of Staff</b> hands work to its bots and gets the results back.
          </p>
        ),
        keywords: 'team chief thread memory brief'
      },
      {
        heading: 'Asking before acting',
        body: (
          <p>
            A bot asks before it sends or changes things in your apps (per bot). The request waits in its thread and on the work board for
            Allow or Decline. A bot may also work in its own sandboxed Linux computer, which you can take over from its panel.
          </p>
        ),
        keywords: 'approval allow decline computer docker'
      },
      {
        heading: 'Schedules and triggers',
        body: (
          <p>
            A bot can run instructions at set times (schedules) or when something happens in a connected app (triggers, read-only). The work
            board lists what the team owes: Working, Didn&rsquo;t finish or Done.
          </p>
        ),
        keywords: 'schedule routine trigger work board'
      }
    ]
  },
  {
    id: 'chat',
    title: 'Chat',
    summary: 'A clean chat over any CLI.',
    icon: MessagesSquare,
    sections: [
      {
        heading: 'Pick, then talk',
        body: (
          <p>
            Choose a CLI, a model (searchable) and, when the model has one, an effort level; the CLI locks after the first message. While it
            answers you can type the next message — it waits and goes in when the reply ends. The bookmark in the box holds saved prompts.
          </p>
        ),
        keywords: 'model effort thinking saved prompts queue'
      }
    ]
  },
  {
    id: 'routines',
    title: 'Schedules',
    summary: 'Scheduled agents, chats and bot runs.',
    icon: CalendarClock,
    sections: [
      {
        heading: 'Three kinds',
        body: (
          <p>
            A Work schedule starts an agent in a worktree (its card moves on the Kanban like any agent); make one in the side panel&rsquo;s Schedules
            tab. A chat schedule starts a new chat. A bot schedule runs in a fresh thread of that bot.
          </p>
        ),
        keywords: 'schedule routine cron calendar'
      },
      {
        heading: 'When they run',
        body: (
          <p>
            Once, every few minutes, or on a calendar rule in a timezone — while Hiveory (or your Hiveory server) runs. A run missed by under
            12 hours still happens when it is back, and every run is kept in a log.
          </p>
        ),
        keywords: 'missed log timezone'
      }
    ]
  },
  {
    id: 'extensions',
    title: 'Skills, MCPs & Apps',
    summary: 'Give every agent skills, MCP servers and apps.',
    icon: Blocks,
    sections: [
      {
        heading: 'Skills',
        body: (
          <p>
            Settings › Skills, MCPs &amp; Apps › Skills lists every skill and the CLIs that load it. Light a folder to copy a skill there, create
            or import one, or find more on <b>skills.sh</b> and install it for every CLI.
          </p>
        ),
        keywords: 'skill skills.sh install'
      },
      {
        heading: 'MCP servers and apps',
        body: (
          <p>
            Servers you add (or find in the MCP Registry) and apps you connect are served by Hiveory to every agent — terminal, chat and bots —
            without touching any CLI&rsquo;s config. Apps run through your own Composio key, kept encrypted on this computer.
          </p>
        ),
        keywords: 'mcp registry composio apps'
      }
    ]
  },
  {
    id: 'integrations',
    title: 'Integrations',
    summary: 'GitHub, GitLab, Jira and Linear.',
    icon: GitPullRequest,
    sections: [
      {
        heading: 'Code hosts',
        body: (
          <p>
            GitHub and GitLab work through their own CLIs (<code>gh</code>, <code>glab</code>) you are signed in to; Hiveory keeps no token.
            Settings › Integrations shows who you are signed in as.
          </p>
        ),
        keywords: 'gh glab github gitlab sign in'
      },
      {
        heading: 'Issue trackers',
        body: (
          <p>
            Jira (site, email and API token) and Linear (API key) connect in Settings › Integrations; keys stay encrypted here. Each
            workspace&rsquo;s settings pick its code host, where its issues come from, and its Jira project or Linear team.
          </p>
        ),
        keywords: 'jira linear issues tracker project team'
      },
      {
        heading: 'Workspace look',
        body: <p>A workspace&rsquo;s settings give it an icon in any color, an emoji, your own image, or its GitHub or GitLab avatar.</p>,
        keywords: 'avatar icon emoji color'
      }
    ]
  },
  {
    id: 'remote',
    title: 'Remote, server & phone',
    summary: 'Workspaces on other machines, and Hiveory from anywhere.',
    icon: Smartphone,
    sections: [
      {
        heading: 'Workspaces over SSH',
        body: (
          <p>
            Add workspace › Remote picks a host (from Tailscale or <code>~/.ssh/config</code>) and a folder. Files, Git, worktrees and agents stay
            on that machine. If the link drops, its agents keep running and Hiveory reconnects for five minutes.
          </p>
        ),
        keywords: 'ssh remote host tailscale'
      },
      {
        heading: 'A Hiveory server',
        body: (
          <p>
            Run <code>hiveory --serve 7788</code> on an always-on machine so agents work while this computer is off; Settings › Remote pairs
            this window with it using the code it prints.
          </p>
        ),
        keywords: 'server serve headless pair'
      },
      {
        heading: 'Your devices and phone',
        body: (
          <p>
            With Tailscale, Settings › Remote › Share this computer lets your other devices and the Hiveory phone app connect — one tap on the
            same Tailscale account, a pairing code otherwise. Remove a device to cut it off at once.
          </p>
        ),
        keywords: 'phone mobile tailscale share devices'
      }
    ]
  },
  {
    id: 'keys',
    title: 'Keyboard & clipboard',
    summary: 'App shortcuts, and copy, paste and newlines in terminals.',
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
              <K>Ctrl</K> <K>V</K> pastes text; an image on the clipboard reaches the agent as its own paste.
            </li>
            <li>
              <K>Shift</K> <K>Enter</K> inserts a newline instead of sending.
            </li>
            <li>
              <K>Alt</K> shortcuts reach the agent untouched. Right-click copies or pastes.
            </li>
            <li>Dictation tools that paste (such as Wispr Flow) work like a normal paste.</li>
          </ul>
        ),
        keywords: 'shortcut copy paste wispr voice dictation'
      },
      {
        heading: 'App shortcuts',
        body: (
          <p>
            Settings › Keyboard lists every shortcut with your system&rsquo;s standard keys: <K>Ctrl</K> on Windows and Linux, <K>⌘</K> on a
            Mac. Queen Bee is <K>Ctrl</K> <K>Shift</K> <K>Space</K> (<K>⌥</K> <K>Space</K> on a Mac), Settings <K>Ctrl</K> <K>,</K>, Work, Bots
            and Chat <K>Ctrl</K> <K>1</K> <K>2</K> <K>3</K>. Click Change and press new keys to make any of them yours.
          </p>
        ),
        keywords: 'keyboard shortcuts key bindings hotkeys change'
      }
    ]
  },
  {
    id: 'appearance',
    title: 'Appearance',
    summary: 'Themes, panes, wallpaper and the terminal font.',
    icon: Palette,
    sections: [
      {
        heading: 'Make it yours',
        body: (
          <p>
            Settings › Appearance: <b>Theme</b> (Dark, Bronze, Silver, or any VS Code theme from Open VSX), <b>Panes</b> (Tiles or Tabs, Spaced
            or Attached), <b>Background</b> (your own image, with transparency, blur and dim) and <b>Terminal font</b>.
          </p>
        ),
        keywords: 'theme vs code wallpaper font tiles tabs attached'
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
        body: <p>Settings › Updates checks for new versions on its own or on demand, and installs on your click.</p>,
        keywords: 'update version release'
      },
      {
        heading: 'An agent shows "Not running"',
        body: (
          <p>
            Its process ended (it exited, or the CLI failed to start). Use Restart in the pane&rsquo;s menu; if the CLI no longer has the
            conversation, it starts a new one.
          </p>
        ),
        keywords: 'not running stopped crashed restart'
      },
      {
        heading: 'A CLI is missing',
        body: <p>Install it so its command is on your PATH, then refresh the list in the agent menu or the create dialog.</p>,
        keywords: 'install path detect'
      },
      {
        heading: 'Ask an agent or Queen Bee',
        body: <p>Every agent and Queen Bee know this app: ask them where something is or how to do it.</p>,
        keywords: 'help where how'
      }
    ]
  }
]
