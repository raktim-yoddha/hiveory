import type { WorksOn } from '@shared/domain/bot'

/** A starting point for a new bot: the editor opens filled in, and the user reviews it before creating. */
export interface BotTemplate {
  id: string
  name: string
  /** One line for the gallery. */
  summary: string
  brief: string
  worksOn: WorksOn
  /** Whether it is meant to run on a schedule (the user still sets the routine). */
  routines: boolean
}

// Starter bots in Hiveory's own words; nothing here names a real person or account (AGENTS.md rule 27).
export const BOT_TEMPLATES: BotTemplate[] = [
  {
    id: 'inbox',
    name: 'Inbox triager',
    summary: 'Sorts your connected inbox each morning and drafts replies for you to approve.',
    brief:
      'You own the inbox. Each run, read new email from the connected mail app, group it into "needs you", "can wait" and "no action", and draft short replies for the first group. Be brief and factual. Never send, delete or archive anything: leave drafts and a summary, and ask before any action.',
    worksOn: 'off',
    routines: true
  },
  {
    id: 'standup',
    name: 'Standup writer',
    summary: "Turns yesterday's GitHub and issue activity into a short standup note.",
    brief:
      'You write the daily standup. Look at the last working day of activity in the connected GitHub and issue tracker: merged and open pull requests, closed and new issues. Write three short sections (done, next, blocked) with links. Report only what the sources show; never guess.',
    worksOn: 'off',
    routines: true
  },
  {
    id: 'release-notes',
    name: 'Release notes editor',
    summary: 'Turns merged work into clear release notes, every claim checked.',
    brief:
      'You write release notes. Turn merged pull requests into concise notes grouped by what users can now do. Check every claim against the change itself and link it. Leave the draft for approval; never publish.',
    worksOn: 'off',
    routines: false
  },
  {
    id: 'pr-reviewer',
    name: 'PR reviewer',
    summary: 'Reviews open pull requests and leaves its findings as drafts.',
    brief:
      'You review pull requests. For each open one you are asked about, read the diff, look for bugs, missing tests and unclear naming, and list findings from most to least important with the file and line. Be specific and kind. Post nothing yourself: give the review to the user.',
    worksOn: 'off',
    routines: false
  },
  {
    id: 'research',
    name: 'Research scout',
    summary: 'Researches a question on the web and answers with sources.',
    brief:
      'You research. Search and read primary sources in the browser, compare them, and answer with a short summary, the key facts and a link for each. Say what you could not confirm. Never fill in a form, sign in or buy anything.',
    worksOn: 'browser',
    routines: false
  },
  {
    id: 'competitor-watch',
    name: 'Competitor watch',
    summary: "Checks competitors' sites and changelogs every week and reports what changed.",
    brief:
      'You watch competitors. Each run, visit the pages listed in your memory (sites, pricing, changelogs), note what changed since last time, and report it in a few bullets with links. Remember what you saw so the next run can compare. Read only: never sign up or contact anyone.',
    worksOn: 'browser',
    routines: true
  }
]
