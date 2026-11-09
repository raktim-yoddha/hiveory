import type { CheckState, PullRequestCheck, PullRequestDetail } from '@shared/domain/github'

/*
 * One branch's review, read from `gh pr view --json` or `glab mr view --output json` (ADR 0064).
 * Pure parsing, so each host's shape is tested without the CLIs.
 */

/** The fields `gh pr view` is asked for. */
export const GH_PR_FIELDS = 'number,title,url,state,isDraft,author,reviewDecision,headRefName,baseRefName,mergeable,updatedAt,statusCheckRollup'

const seconds = (start?: unknown, end?: unknown): number | undefined => {
  const a = typeof start === 'string' ? Date.parse(start) : NaN
  const b = typeof end === 'string' ? Date.parse(end) : NaN
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 1000) : undefined
}

const ghCheckState = (status: string, conclusion: string): CheckState => {
  if (status && status !== 'COMPLETED') return 'pending'
  if (conclusion === 'SUCCESS') return 'success'
  if (conclusion === 'SKIPPED') return 'skipped'
  if (conclusion === 'NEUTRAL' || conclusion === 'STALE') return 'neutral'
  return conclusion ? 'failure' : 'pending'
}

const ghStatusState = (state: string): CheckState =>
  state === 'SUCCESS' ? 'success' : state === 'PENDING' || state === 'EXPECTED' ? 'pending' : 'failure'

export function parseGithubPullRequest(json: string): PullRequestDetail {
  const p = JSON.parse(json) as Record<string, unknown>
  const rollup = (Array.isArray(p.statusCheckRollup) ? p.statusCheckRollup : []) as Array<Record<string, unknown>>
  const checks: PullRequestCheck[] = rollup.map((c) =>
    c.__typename === 'StatusContext'
      ? { name: String(c.context ?? 'status'), state: ghStatusState(String(c.state ?? '')), ...(c.targetUrl ? { url: String(c.targetUrl) } : {}) }
      : {
          name: String(c.name ?? 'check'),
          ...(c.workflowName ? { group: String(c.workflowName) } : {}),
          state: ghCheckState(String(c.status ?? ''), String(c.conclusion ?? '')),
          ...(seconds(c.startedAt, c.completedAt) !== undefined ? { seconds: seconds(c.startedAt, c.completedAt) } : {}),
          ...(c.detailsUrl ? { url: String(c.detailsUrl) } : {})
        }
  )
  const state = String(p.state ?? 'OPEN')
  return {
    number: Number(p.number),
    title: String(p.title ?? ''),
    url: String(p.url ?? ''),
    branch: String(p.headRefName ?? ''),
    baseBranch: p.baseRefName ? String(p.baseRefName) : undefined,
    draft: Boolean(p.isDraft),
    updatedAt: String(p.updatedAt ?? ''),
    author: (p.author as { login?: string } | null)?.login ?? '',
    reviewDecision: (p.reviewDecision as string) || undefined,
    state: state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : 'open',
    mergeable: p.mergeable === 'MERGEABLE' ? true : p.mergeable === 'CONFLICTING' ? false : undefined,
    checks
  }
}

const glPipelineState = (status: string): CheckState =>
  status === 'success'
    ? 'success'
    : status === 'skipped'
      ? 'skipped'
      : status === 'canceled' || status === 'manual'
        ? 'neutral'
        : status === 'failed'
          ? 'failure'
          : 'pending'

export function parseGitlabMergeRequest(json: string): PullRequestDetail {
  const m = JSON.parse(json) as Record<string, unknown>
  const pipeline = (m.head_pipeline ?? m.pipeline) as Record<string, unknown> | null | undefined
  const state = String(m.state ?? 'opened')
  const merge = String(m.detailed_merge_status ?? m.merge_status ?? '')
  return {
    number: Number(m.iid),
    title: String(m.title ?? ''),
    url: String(m.web_url ?? ''),
    branch: String(m.source_branch ?? ''),
    baseBranch: m.target_branch ? String(m.target_branch) : undefined,
    draft: Boolean(m.draft ?? m.work_in_progress),
    updatedAt: String(m.updated_at ?? ''),
    author: (m.author as { username?: string } | null)?.username ?? '',
    state: state === 'merged' ? 'merged' : state === 'closed' ? 'closed' : 'open',
    mergeable: merge === 'mergeable' || merge === 'can_be_merged' ? true : merge === 'broken_status' || merge === 'conflict' || merge === 'cannot_be_merged' ? false : undefined,
    checks: pipeline
      ? [
          {
            name: `Pipeline #${String(pipeline.id ?? '')}`.trim(),
            state: glPipelineState(String(pipeline.status ?? '')),
            ...(seconds(pipeline.started_at, pipeline.finished_at) !== undefined ? { seconds: seconds(pipeline.started_at, pipeline.finished_at) } : {}),
            ...(pipeline.web_url ? { url: String(pipeline.web_url) } : {})
          }
        ]
      : []
  }
}

/** The CLIs say "no pull requests found" / "no open merge request" when a branch has none. */
export const isNoReview = (detail: string): boolean => /no (?:open )?(?:pull|merge) requests? (?:found|available)|no open merge request|could not find any pull request/i.test(detail)
