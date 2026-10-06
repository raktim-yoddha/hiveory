/**
 * Plugins: apps every agent in Hiveory can use — terminal, chat and bots —
 * through the user's own Composio project, free or paid (ADR 0023). The user
 * pastes their Composio API key once; Connect then goes straight to each
 * app's own sign-in. Hiveory keeps no app keys and hosts nothing.
 */

export type PluginCategory = 'Work' | 'Code' | 'Data' | 'Business' | 'Search' | 'Media'

export interface PluginApp {
  /** Composio's toolkit slug. */
  id: string
  name: string
  category: PluginCategory
  description: string
}

export const COMPOSIO = {
  /** The plugin id of the Composio connection. */
  id: 'composio',
  name: 'Composio',
  /** Composio's REST API. */
  apiUrl: 'https://backend.composio.dev/api/v3.1',
  /** Where the user creates a Composio account and copies a project API key. */
  keyUrl: 'https://platform.composio.dev',
  /** Told to agents next to the connected apps. */
  agentHint:
    "the user's hub for 1,000+ apps: search its tools for the app, and when an app isn't connected yet, give the user the connect link it returns"
} as const

export const PLUGIN_APPS: PluginApp[] = [
  { id: 'gmail', name: 'Gmail', category: 'Work', description: 'Read, search, draft and send email.' },
  { id: 'googlecalendar', name: 'Google Calendar', category: 'Work', description: 'Events, availability and invites.' },
  { id: 'googledrive', name: 'Google Drive', category: 'Work', description: 'Find, read, upload and share files.' },
  { id: 'googledocs', name: 'Google Docs', category: 'Work', description: 'Create and edit documents.' },
  { id: 'googlesheets', name: 'Google Sheets', category: 'Work', description: 'Read and update spreadsheets.' },
  { id: 'outlook', name: 'Outlook', category: 'Work', description: 'Microsoft mail and calendar.' },
  { id: 'microsoft_teams', name: 'Microsoft Teams', category: 'Work', description: 'Chats, channels and meetings.' },
  { id: 'one_drive', name: 'OneDrive', category: 'Work', description: 'Microsoft files and folders.' },
  { id: 'slack', name: 'Slack', category: 'Work', description: 'Read channels and threads, post messages and reactions.' },
  { id: 'discord', name: 'Discord', category: 'Work', description: 'Servers, channels and messages.' },
  { id: 'notion', name: 'Notion', category: 'Work', description: 'Search, read and edit pages and databases.' },
  { id: 'linear', name: 'Linear', category: 'Work', description: 'Issues, projects, cycles and comments.' },
  { id: 'jira', name: 'Jira', category: 'Work', description: 'Issues, sprints and boards.' },
  { id: 'confluence', name: 'Confluence', category: 'Work', description: 'Spaces and pages.' },
  { id: 'asana', name: 'Asana', category: 'Work', description: 'Tasks, projects and teams.' },
  { id: 'trello', name: 'Trello', category: 'Work', description: 'Boards, lists and cards.' },
  { id: 'clickup', name: 'ClickUp', category: 'Work', description: 'Tasks, lists and docs.' },
  { id: 'todoist', name: 'Todoist', category: 'Work', description: 'Tasks, projects and due dates.' },
  { id: 'zoom', name: 'Zoom', category: 'Work', description: 'Meetings and recordings.' },
  { id: 'calendly', name: 'Calendly', category: 'Work', description: 'Scheduling links and booked events.' },
  { id: 'dropbox', name: 'Dropbox', category: 'Work', description: 'Files, folders and sharing.' },
  { id: 'resend', name: 'Resend', category: 'Work', description: 'Send email from your own domain.' },
  { id: 'github', name: 'GitHub', category: 'Code', description: 'Repositories, issues, pull requests, Actions and code search.' },
  { id: 'gitlab', name: 'GitLab', category: 'Code', description: 'Projects, merge requests, issues and pipelines.' },
  { id: 'bitbucket', name: 'Bitbucket', category: 'Code', description: 'Repositories and pull requests.' },
  { id: 'sentry', name: 'Sentry', category: 'Code', description: 'Errors, issues, releases and performance data.' },
  { id: 'vercel', name: 'Vercel', category: 'Code', description: 'Projects, deployments and logs.' },
  { id: 'figma', name: 'Figma', category: 'Code', description: 'Read designs, frames and comments.' },
  { id: 'circleci', name: 'CircleCI', category: 'Code', description: 'Pipelines, builds and test results.' },
  { id: 'supabase', name: 'Supabase', category: 'Data', description: 'Tables, SQL, migrations and edge functions.' },
  { id: 'neon', name: 'Neon', category: 'Data', description: 'Serverless Postgres: projects, branches and SQL.' },
  { id: 'airtable', name: 'Airtable', category: 'Data', description: 'Bases, tables and records.' },
  { id: 'hubspot', name: 'HubSpot', category: 'Business', description: 'Contacts, companies, deals and notes.' },
  { id: 'salesforce', name: 'Salesforce', category: 'Business', description: 'Accounts, leads, opportunities and reports.' },
  { id: 'stripe', name: 'Stripe', category: 'Business', description: 'Customers, payments, subscriptions and invoices.' },
  { id: 'shopify', name: 'Shopify', category: 'Business', description: 'Products, orders and customers.' },
  { id: 'intercom', name: 'Intercom', category: 'Business', description: 'Conversations, contacts and articles.' },
  { id: 'zendesk', name: 'Zendesk', category: 'Business', description: 'Tickets, users and help center.' },
  { id: 'posthog', name: 'PostHog', category: 'Business', description: 'Product analytics, insights and feature flags.' },
  { id: 'mailchimp', name: 'Mailchimp', category: 'Business', description: 'Audiences, campaigns and reports.' },
  { id: 'exa', name: 'Exa', category: 'Search', description: 'Neural web search for agents.' },
  { id: 'firecrawl', name: 'Firecrawl', category: 'Search', description: 'Scrape, crawl and extract structured data from any site.' },
  { id: 'perplexityai', name: 'Perplexity', category: 'Search', description: 'Answers with citations from the live web.' },
  { id: 'tavily', name: 'Tavily', category: 'Search', description: 'Web search and extraction built for agents.' },
  { id: 'serpapi', name: 'SerpApi', category: 'Search', description: 'Google and other search engine results.' },
  { id: 'youtube', name: 'YouTube', category: 'Media', description: 'Videos, channels, playlists and captions.' },
  { id: 'elevenlabs', name: 'ElevenLabs', category: 'Media', description: 'Text to speech and voices.' },
  { id: 'twitter', name: 'X (Twitter)', category: 'Media', description: 'Posts, timelines and search.' },
  { id: 'reddit', name: 'Reddit', category: 'Media', description: 'Posts, comments and subreddits.' },
  { id: 'linkedin', name: 'LinkedIn', category: 'Media', description: 'Profile and posts.' }
]

export const pluginAppById = (id: string): PluginApp | undefined => PLUGIN_APPS.find((a) => a.id === id)

/** The only external page the Plugins screen opens itself: where the Composio API key comes from. */
export const isPluginHelpUrl = (url: string): boolean => url === COMPOSIO.keyUrl

/** One account of an app, connected through Composio (several per app, told apart by label). */
export interface PluginAccount {
  /** Composio's connected account id (ca_…). */
  id: string
  /** The app's Composio toolkit slug. */
  appId: string
  label?: string
  /** active: agents can use it; pending: waiting for the user to approve it in the browser. */
  status: 'active' | 'pending' | 'failed' | 'expired'
}

export interface PluginStatus {
  /** A Composio API key is saved. */
  keySet: boolean
  accounts: PluginAccount[]
  /** Why Composio could not be reached, when it could not. */
  error?: string
}
