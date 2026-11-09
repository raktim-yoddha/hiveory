import { describe, expect, it } from 'vitest'
import { isNoReview, parseGithubPullRequest, parseGitlabMergeRequest } from './pull-request-detail'

describe('a branch’s review and its checks (ADR 0064)', () => {
  it('reads gh pr view: state, mergeable and every kind of check', () => {
    const pr = parseGithubPullRequest(
      JSON.stringify({
        number: 42,
        title: 'Add login',
        url: 'https://github.com/acme/app/pull/42',
        state: 'OPEN',
        isDraft: false,
        author: { login: 'alex' },
        reviewDecision: 'APPROVED',
        headRefName: 'feature/login',
        baseRefName: 'main',
        mergeable: 'MERGEABLE',
        updatedAt: '2026-11-09T10:00:00Z',
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'lint', workflowName: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-11-09T10:00:00Z', completedAt: '2026-11-09T10:01:43Z', detailsUrl: 'https://ci/1' },
          { __typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: '' },
          { __typename: 'CheckRun', name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
          { __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' },
          { __typename: 'StatusContext', context: 'deploy/preview', state: 'SUCCESS', targetUrl: 'https://preview' }
        ]
      })
    )
    expect(pr).toMatchObject({ number: 42, state: 'open', mergeable: true, branch: 'feature/login', baseBranch: 'main', author: 'alex', reviewDecision: 'APPROVED' })
    expect(pr.checks.map((c) => [c.name, c.state])).toEqual([
      ['lint', 'success'],
      ['build', 'pending'],
      ['docs', 'skipped'],
      ['tests', 'failure'],
      ['deploy/preview', 'success']
    ])
    expect(pr.checks[0]).toMatchObject({ group: 'CI', seconds: 103, url: 'https://ci/1' })
  })

  it('reads a merged one with conflicts unknown and no checks', () => {
    const pr = parseGithubPullRequest(JSON.stringify({ number: 7, title: 't', url: 'u', state: 'MERGED', mergeable: 'UNKNOWN', statusCheckRollup: null }))
    expect(pr).toMatchObject({ state: 'merged', checks: [] })
    expect(pr.mergeable).toBeUndefined()
  })

  it('reads glab mr view with its pipeline as the check', () => {
    const mr = parseGitlabMergeRequest(
      JSON.stringify({
        iid: 9,
        title: 'Fix it',
        web_url: 'https://gitlab.com/acme/app/-/merge_requests/9',
        state: 'opened',
        draft: true,
        author: { username: 'alex' },
        source_branch: 'fix',
        target_branch: 'main',
        detailed_merge_status: 'mergeable',
        head_pipeline: { id: 77, status: 'failed', web_url: 'https://gitlab.com/p/77', started_at: '2026-11-09T10:00:00Z', finished_at: '2026-11-09T10:00:30Z' }
      })
    )
    expect(mr).toMatchObject({ number: 9, state: 'open', draft: true, mergeable: true, branch: 'fix' })
    expect(mr.checks).toEqual([{ name: 'Pipeline #77', state: 'failure', seconds: 30, url: 'https://gitlab.com/p/77' }])
  })

  it('tells "no review for this branch" apart from a real error', () => {
    expect(isNoReview('no pull requests found for branch "fix"')).toBe(true)
    expect(isNoReview('no open merge request available for "fix"')).toBe(true)
    expect(isNoReview('HTTP 401: Bad credentials')).toBe(false)
  })
})
