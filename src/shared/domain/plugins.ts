/**
 * Plugins: apps every agent in Hiveory can use, set up locally with the
 * user's own keys — no OAuth, no Hiveory account, nothing hosted (ADR 0017).
 * Each plugin is a template for an MCP server: a local `npx`/`uvx` command
 * fed by environment variables, or a vendor's remote endpoint with a bearer
 * key. Only apps whose server works with a key the user can create
 * themselves are listed.
 */

export type PluginCategory = 'Code' | 'Work' | 'Data' | 'Business' | 'Search' | 'Automation' | 'Media'

export interface PluginField {
  key: string
  label: string
  /** Stored encrypted and never sent back to the renderer. */
  secret?: boolean
  optional?: boolean
  placeholder?: string
  /** Used when the field is left empty. */
  defaultValue?: string
}

/**
 * `{key}` in any string is replaced by that field's value. An argument,
 * env var, header or query parameter whose field is empty is left out.
 */
export type PluginServer =
  | { transport: 'stdio'; command: 'npx' | 'uvx'; args: string[]; env?: Record<string, string> }
  | { transport: 'http'; url: string; query?: Record<string, string>; headers?: Record<string, string> }

export interface PluginDefinition {
  id: string
  name: string
  category: PluginCategory
  description: string
  /** Where the user creates the key. */
  keyUrl: string
  fields: PluginField[]
  server: PluginServer
}

const token = (label: string, placeholder?: string): PluginField => ({ key: 'token', label, secret: true, placeholder })
const bearer = { Authorization: 'Bearer {token}' }
const npx = (pkg: string, env: Record<string, string>, extra: string[] = []): PluginServer => ({
  transport: 'stdio',
  command: 'npx',
  args: ['-y', pkg, ...extra],
  env
})
const uvx = (pkg: string, env: Record<string, string>, extra: string[] = []): PluginServer => ({
  transport: 'stdio',
  command: 'uvx',
  args: [pkg, ...extra],
  env
})

export const PLUGINS: PluginDefinition[] = [
  {
    id: 'github',
    name: 'GitHub',
    category: 'Code',
    description: 'Repositories, issues, pull requests, Actions and code search.',
    keyUrl: 'https://github.com/settings/personal-access-tokens/new',
    fields: [token('Personal access token', 'github_pat_…')],
    server: { transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: bearer }
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    category: 'Code',
    description: 'Projects, merge requests, issues and pipelines — gitlab.com or self-hosted.',
    keyUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens',
    fields: [
      token('Personal access token', 'glpat-…'),
      { key: 'url', label: 'API URL', optional: true, placeholder: 'https://gitlab.com/api/v4', defaultValue: 'https://gitlab.com/api/v4' }
    ],
    server: npx('@zereight/mcp-gitlab', { GITLAB_PERSONAL_ACCESS_TOKEN: '{token}', GITLAB_API_URL: '{url}' })
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'Code',
    description: 'Errors, issues, releases and performance data from your projects.',
    keyUrl: 'https://sentry.io/settings/account/api/auth-tokens/',
    fields: [token('User auth token', 'sntryu_…'), { key: 'host', label: 'Self-hosted host', optional: true, placeholder: 'sentry.example.com' }],
    server: npx('@sentry/mcp-server@latest', { SENTRY_ACCESS_TOKEN: '{token}' }, ['--host={host}'])
  },
  {
    id: 'circleci',
    name: 'CircleCI',
    category: 'Code',
    description: 'Build failures, flaky tests and pipeline status.',
    keyUrl: 'https://app.circleci.com/settings/user/tokens',
    fields: [token('Personal API token')],
    server: npx('@circleci/mcp-server-circleci', { CIRCLECI_TOKEN: '{token}' })
  },
  {
    id: 'heroku',
    name: 'Heroku',
    category: 'Code',
    description: 'Apps, dynos, add-ons, logs and deploys.',
    keyUrl: 'https://dashboard.heroku.com/account/applications',
    fields: [token('API key')],
    server: npx('@heroku/mcp-server', { HEROKU_API_KEY: '{token}' })
  },
  {
    id: 'figma',
    name: 'Figma',
    category: 'Code',
    description: 'Read designs, frames and layout data to build UI from them.',
    keyUrl: 'https://www.figma.com/developers/api#access-tokens',
    fields: [token('Personal access token', 'figd_…')],
    server: npx('figma-developer-mcp', { FIGMA_API_KEY: '{token}' }, ['--stdio'])
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'Work',
    description: 'Issues, projects, cycles and comments.',
    keyUrl: 'https://linear.app/settings/account/security',
    fields: [token('Personal API key', 'lin_api_…')],
    server: { transport: 'http', url: 'https://mcp.linear.app/mcp', headers: bearer }
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'Work',
    description: 'Search, read and edit pages and databases shared with your integration.',
    keyUrl: 'https://www.notion.so/profile/integrations',
    fields: [token('Internal integration secret', 'ntn_…')],
    server: npx('@notionhq/notion-mcp-server', { NOTION_TOKEN: '{token}' })
  },
  {
    id: 'jira',
    name: 'Jira & Confluence',
    category: 'Work',
    description: 'Atlassian Cloud or Server: issues, sprints and Confluence pages.',
    keyUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    fields: [
      { key: 'site', label: 'Site URL', placeholder: 'https://your-team.atlassian.net' },
      { key: 'email', label: 'Account email', placeholder: 'you@company.com' },
      token('API token')
    ],
    server: uvx('mcp-atlassian', {
      JIRA_URL: '{site}',
      JIRA_USERNAME: '{email}',
      JIRA_API_TOKEN: '{token}',
      CONFLUENCE_URL: '{site}/wiki',
      CONFLUENCE_USERNAME: '{email}',
      CONFLUENCE_API_TOKEN: '{token}'
    })
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'Work',
    description: 'Read channels and threads, post messages and reactions with your own Slack app.',
    keyUrl: 'https://api.slack.com/apps',
    fields: [token('Bot token', 'xoxb-…'), { key: 'team', label: 'Workspace (team) ID', placeholder: 'T01234567' }],
    server: npx('@modelcontextprotocol/server-slack', { SLACK_BOT_TOKEN: '{token}', SLACK_TEAM_ID: '{team}' })
  },
  {
    id: 'resend',
    name: 'Email (Resend)',
    category: 'Work',
    description: 'Send email from your own domain, with HTML, attachments and scheduling.',
    keyUrl: 'https://resend.com/api-keys',
    fields: [token('API key', 're_…')],
    server: npx('resend-mcp', { RESEND_API_KEY: '{token}' })
  },
  {
    id: 'trello',
    name: 'Trello',
    category: 'Work',
    description: 'Boards, lists and cards.',
    keyUrl: 'https://trello.com/power-ups/admin',
    fields: [{ key: 'key', label: 'API key', secret: true }, token('Token')],
    server: npx('@delorenj/mcp-server-trello', { TRELLO_API_KEY: '{key}', TRELLO_TOKEN: '{token}' })
  },
  {
    id: 'todoist',
    name: 'Todoist',
    category: 'Work',
    description: 'Tasks, projects and due dates.',
    keyUrl: 'https://app.todoist.com/app/settings/integrations/developer',
    fields: [token('API token')],
    server: npx('@doist/todoist-mcp', { TODOIST_API_KEY: '{token}' })
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    category: 'Work',
    description: 'Your local vault through the Local REST API community plugin.',
    keyUrl: 'https://github.com/coddingtonbear/obsidian-local-rest-api',
    fields: [token('Local REST API key'), { key: 'host', label: 'Host', optional: true, placeholder: '127.0.0.1', defaultValue: '127.0.0.1' }],
    server: uvx('mcp-obsidian', { OBSIDIAN_API_KEY: '{token}', OBSIDIAN_HOST: '{host}' })
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'Data',
    description: 'Tables, SQL, migrations, edge functions and logs.',
    keyUrl: 'https://supabase.com/dashboard/account/tokens',
    fields: [token('Personal access token', 'sbp_…'), { key: 'project', label: 'Project ref', optional: true, placeholder: 'abcdefghijklmnop' }],
    server: { transport: 'http', url: 'https://mcp.supabase.com/mcp', query: { project_ref: '{project}' }, headers: bearer }
  },
  {
    id: 'neon',
    name: 'Neon',
    category: 'Data',
    description: 'Serverless Postgres: projects, branches and SQL.',
    keyUrl: 'https://console.neon.tech/app/settings/api-keys',
    fields: [token('API key', 'napi_…')],
    server: { transport: 'http', url: 'https://mcp.neon.tech/mcp', headers: bearer }
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    category: 'Data',
    description: 'Any Postgres database: schema, read-only queries, index and health advice.',
    keyUrl: 'https://github.com/crystaldba/postgres-mcp',
    fields: [{ key: 'uri', label: 'Connection string', secret: true, placeholder: 'postgresql://user:pass@host:5432/db' }],
    server: uvx('postgres-mcp', { DATABASE_URI: '{uri}' }, ['--access-mode=restricted'])
  },
  {
    id: 'mongodb',
    name: 'MongoDB',
    category: 'Data',
    description: 'Collections, queries and aggregations on Atlas or your own cluster.',
    keyUrl: 'https://www.mongodb.com/docs/manual/reference/connection-string/',
    fields: [{ key: 'uri', label: 'Connection string', secret: true, placeholder: 'mongodb+srv://…' }],
    server: npx('mongodb-mcp-server', { MDB_MCP_CONNECTION_STRING: '{uri}' })
  },
  {
    id: 'airtable',
    name: 'Airtable',
    category: 'Data',
    description: 'Bases, tables and records.',
    keyUrl: 'https://airtable.com/create/tokens/new',
    fields: [token('Personal access token', 'pat…')],
    server: npx('airtable-mcp-server', { AIRTABLE_API_KEY: '{token}' })
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'Business',
    description: 'Customers, payments, subscriptions and invoices.',
    keyUrl: 'https://dashboard.stripe.com/apikeys',
    fields: [token('Agent API key')],
    server: { transport: 'http', url: 'https://mcp.stripe.com', headers: bearer }
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'Business',
    description: 'Contacts, companies, deals and notes.',
    keyUrl: 'https://developers.hubspot.com/docs/api/private-apps',
    fields: [token('Private app access token', 'pat-…')],
    server: npx('@hubspot/mcp-server', { PRIVATE_APP_ACCESS_TOKEN: '{token}' })
  },
  {
    id: 'posthog',
    name: 'PostHog',
    category: 'Business',
    description: 'Product analytics, insights, feature flags and errors.',
    keyUrl: 'https://app.posthog.com/settings/user-api-keys',
    fields: [token('Personal API key', 'phx_…')],
    server: { transport: 'http', url: 'https://mcp.posthog.com/mcp', headers: bearer }
  },
  {
    id: 'brave',
    name: 'Brave Search',
    category: 'Search',
    description: 'Independent web, news, image and video search.',
    keyUrl: 'https://api-dashboard.search.brave.com/app/keys',
    fields: [token('API key')],
    server: npx('@brave/brave-search-mcp-server', { BRAVE_API_KEY: '{token}' })
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    category: 'Search',
    description: 'Answers with citations, deep research and reasoning over the live web.',
    keyUrl: 'https://www.perplexity.ai/account/api/keys',
    fields: [token('API key', 'pplx-…')],
    server: npx('@perplexity-ai/mcp-server', { PERPLEXITY_API_KEY: '{token}' })
  },
  {
    id: 'exa',
    name: 'Exa',
    category: 'Search',
    description: 'Neural web search and code context for agents.',
    keyUrl: 'https://dashboard.exa.ai/api-keys',
    fields: [token('API key')],
    server: { transport: 'http', url: 'https://mcp.exa.ai/mcp', headers: bearer }
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    category: 'Search',
    description: 'Scrape, crawl and extract structured data from any site.',
    keyUrl: 'https://www.firecrawl.dev/app/api-keys',
    fields: [token('API key', 'fc-…')],
    server: npx('firecrawl-mcp', { FIRECRAWL_API_KEY: '{token}' })
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    category: 'Media',
    description: 'Models, datasets, papers and Spaces.',
    keyUrl: 'https://huggingface.co/settings/tokens',
    fields: [token('Access token', 'hf_…')],
    server: { transport: 'http', url: 'https://huggingface.co/mcp', headers: bearer }
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    category: 'Media',
    description: 'Text to speech, voice cloning, transcription and sound effects.',
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    fields: [token('API key', 'sk_…')],
    server: uvx('elevenlabs-mcp', { ELEVENLABS_API_KEY: '{token}' })
  },
  {
    id: 'n8n',
    name: 'n8n',
    category: 'Automation',
    description: 'Run workflows on your own n8n instance through its MCP server.',
    keyUrl: 'https://docs.n8n.io/advanced-ai/accessing-n8n-mcp-server/',
    fields: [{ key: 'url', label: 'MCP server URL', placeholder: 'https://n8n.example.com/mcp-server/http' }, token('Access token')],
    server: { transport: 'http', url: '{url}', headers: bearer }
  },
  {
    id: 'zapier',
    name: 'Zapier',
    category: 'Automation',
    description: 'Thousands of apps through the actions you enable in Zapier MCP.',
    keyUrl: 'https://mcp.zapier.com/',
    fields: [{ key: 'url', label: 'Server URL', secret: true, placeholder: 'https://mcp.zapier.com/api/mcp/s/…/mcp' }],
    server: { transport: 'http', url: '{url}' }
  }
]

export const pluginById = (id: string): PluginDefinition | undefined => PLUGINS.find((p) => p.id === id)

/** Where to install the runners local plugins use. */
export const RUNNER_INSTALL_URLS = { npx: 'https://nodejs.org/en/download', uvx: 'https://docs.astral.sh/uv/getting-started/installation/' }

/** The only external pages the Plugins screen may open: each plugin's key page and the runner installers. */
export const isPluginHelpUrl = (url: string): boolean =>
  PLUGINS.some((p) => p.keyUrl === url) || Object.values(RUNNER_INSTALL_URLS).includes(url)

/** Fills a plugin's template. Returns null and the missing labels when a required field is empty. */
export const resolvePluginServer = (
  plugin: PluginDefinition,
  values: Record<string, string>
): { server: PluginServer; missing: string[] } => {
  const value = (key: string): string => {
    const field = plugin.fields.find((f) => f.key === key)
    return (values[key] ?? '').trim() || field?.defaultValue || ''
  }
  const missing = plugin.fields.filter((f) => !f.optional && !value(f.key)).map((f) => f.label)
  const keys = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string)
  /** null when the string mentions an empty field. */
  const fill = (text: string): string | null => (keys(text).some((k) => !value(k)) ? null : text.replace(/\{(\w+)\}/g, (_m, k: string) => value(k)))
  const fillRecord = (record: Record<string, string> = {}): Record<string, string> =>
    Object.fromEntries(Object.entries(record).flatMap(([k, v]) => { const filled = fill(v); return filled === null ? [] : [[k, filled]] }))
  const s = plugin.server
  if (s.transport === 'stdio') {
    return {
      server: { ...s, args: s.args.map(fill).filter((a): a is string => a !== null), env: fillRecord(s.env) },
      missing
    }
  }
  const url = fill(s.url) ?? ''
  const query = new URLSearchParams(fillRecord(s.query)).toString()
  return { server: { transport: 'http', url: query ? `${url}${url.includes('?') ? '&' : '?'}${query}` : url, headers: fillRecord(s.headers) }, missing }
}
