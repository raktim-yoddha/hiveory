/**
 * The skills and MCP stores (ADR 0041): skills.sh for Agent Skills, the official MCP Registry for
 * MCP servers. Both are searched from main; what they return is data, shown as plain text.
 */

/** One skill from skills.sh. `id` is "owner/repo/skill" for GitHub sources. */
export interface StoreSkill {
  id: string
  /** "owner/repo" on GitHub, or a domain for well-known sources. */
  source: string
  skillId: string
  name: string
  installs: number
  /** Only GitHub sources can be installed from Hiveory (their files come straight from the repository). */
  installable: boolean
}

/** A partner's security audit of a skill, as skills.sh reports it. */
export interface SkillAudit {
  provider: string
  status: 'pass' | 'warn' | 'fail'
  summary: string
  riskLevel?: string
}

/** A value a store MCP server needs: an environment variable, a header or an argument. */
export interface McpInput {
  name: string
  description?: string
  required: boolean
  secret: boolean
  default?: string
  /** Fixed choices, when the registry lists them. */
  choices?: string[]
}

/**
 * An argument of a registry package: a fixed value (which may hold {variables} the user fills in), or a
 * value the user gives. `name` makes it named (`--port 8080`, `-v x:y`); without it, positional.
 */
export interface McpArg {
  name?: string
  value?: string
  input?: McpInput
  vars?: McpInput[]
}

/** One way to run a registry server: a package run on this computer, or a hosted endpoint. */
export type McpOption =
  | {
      kind: 'package'
      /** npm (npx), pypi (uvx) or oci (docker). */
      registry: 'npm' | 'pypi' | 'oci'
      identifier: string
      version?: string
      env: McpInput[]
      /** Arguments to the runner (docker's -v, -e…); npx and uvx take their own. */
      runtimeArgs: McpArg[]
      /** Arguments after the package, in order. */
      args: McpArg[]
    }
  | { kind: 'remote'; transport: 'streamable-http' | 'sse'; url: string; headers: McpInput[] }

/** Every value an option asks the user for. */
export const optionInputs = (option: McpOption): McpInput[] => {
  if (option.kind === 'remote') return option.headers
  const fromArgs = [...option.runtimeArgs, ...option.args].flatMap((a) => [...(a.input ? [a.input] : []), ...(a.vars ?? [])])
  const seen = new Set<string>()
  return [...option.env, ...fromArgs].filter((i) => !seen.has(i.name) && seen.add(i.name))
}

/** One server from the official MCP Registry (its latest version). */
export interface StoreMcpServer {
  /** Reverse-DNS name, e.g. "io.github.acme/weather". */
  name: string
  title?: string
  description: string
  version: string
  repository?: string
  options: McpOption[]
}

export interface McpSearchResult {
  servers: StoreMcpServer[]
  /** Pass back for the next page. */
  next?: string
}

/** The fewest skills folders that reach every installed CLI: the shared folder first, then each CLI's own (ADR 0041). */
export const coveringRoots = (roots: Array<{ id: string; visibleTo: string[] }>, installed: Set<string>): string[] => {
  const chosen: string[] = []
  const reached = new Set<string>()
  const ordered = [...roots.filter((r) => r.id === 'agents'), ...roots.filter((r) => r.id !== 'agents')]
  for (const root of ordered) {
    const adds = root.visibleTo.filter((id) => installed.has(id) && !reached.has(id))
    if (!adds.length) continue
    chosen.push(root.id)
    adds.forEach((id) => reached.add(id))
  }
  return chosen.length ? chosen : ['agents']
}

/**
 * The connection Hiveory runs for a registry server option, with the user's values filled in. Packages
 * run through npx, uvx or docker; hosted ones connect over HTTP. Returns why not when a required value is missing.
 */
export const connectionFor = (
  server: Pick<StoreMcpServer, 'name' | 'title'>,
  option: McpOption,
  values: Record<string, string>
): { name: string; transport: 'stdio' | 'http'; command?: string; args?: string[]; url?: string; env: Record<string, string>; headers: Record<string, string> } | string => {
  const value = (input: McpInput): string | undefined => values[input.name]?.trim() || input.default
  const missing = optionInputs(option).find((i) => i.required && !value(i))
  if (missing) return `Fill in ${missing.name}.`
  const name = (server.title || server.name.split('/').at(-1) || server.name).slice(0, 40)
  if (option.kind === 'remote') {
    const headers = Object.fromEntries(option.headers.flatMap((h) => (value(h) ? [[h.name, value(h)!]] : [])))
    return { name, transport: 'http', url: option.url, env: {}, headers }
  }
  const render = (list: McpArg[]): string[] =>
    list.flatMap((a) => {
      const v = a.input ? value(a.input) : a.value?.replace(/\{(\w+)\}/g, (whole, key: string) => {
        const input = a.vars?.find((i) => i.name === key)
        return input ? (value(input) ?? '') : whole
      })
      // A named flag with no value at all (docker's -i): just the flag.
      if (a.name && !a.input && a.value === undefined) return [a.name]
      if (!v) return []
      return a.name ? [a.name, v] : [v]
    })
  const env = Object.fromEntries(option.env.flatMap((e) => (value(e) ? [[e.name, value(e)!]] : [])))
  const rest = render(option.args)
  if (option.registry === 'npm') return { name, transport: 'stdio', command: 'npx', args: ['-y', option.version ? `${option.identifier}@${option.version}` : option.identifier, ...rest], env, headers: {} }
  if (option.registry === 'pypi') return { name, transport: 'stdio', command: 'uvx', args: [option.version ? `${option.identifier}==${option.version}` : option.identifier, ...rest], env, headers: {} }
  // docker: stdin open and the container removed on exit, the env vars passed through by name.
  const runtime = render(option.runtimeArgs).filter((x) => x !== '-i' && x !== '--rm')
  const image = option.version && !option.identifier.includes(':') ? `${option.identifier}:${option.version}` : option.identifier
  return { name, transport: 'stdio', command: 'docker', args: ['run', '-i', '--rm', ...Object.keys(env).flatMap((k) => ['-e', k]), ...runtime, image, ...rest], env, headers: {} }
}
