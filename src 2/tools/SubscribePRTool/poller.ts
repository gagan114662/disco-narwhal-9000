import { execa } from 'execa'
import type {
  PRCheckSummary,
  PRCommentSnapshot,
  PRSnapshot,
  PRSubscription,
  SubscribePREvent,
} from './prStore.js'

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'
const GH_TOKEN_ARGS = ['auth', 'token'] as const
const MAX_COMMENT_PREVIEW = 80
const RATE_LIMIT_STATUSES = new Set([403, 429])

let cachedGitHubToken: string | null = null

type PullResponse = {
  state: 'open' | 'closed'
  merged_at: string | null
  head: { sha: string }
  comments?: number
  review_comments?: number
}

type CombinedStatusResponse = {
  state?: string
  statuses?: Array<{ state?: string | null }>
}

type CheckRunsResponse = {
  check_runs?: Array<{
    status?: string | null
    conclusion?: string | null
  }>
}

type CommentResponse = {
  id: number
  body?: string | null
  html_url?: string | null
  created_at?: string | null
  user?: { login?: string | null } | null
}

export type ParsedPullRequestUrl = {
  owner: string
  repo: string
  number: number
  url: string
}

export type PullRequestChange = {
  type: SubscribePREvent
  message: string
}

export type PollerResult = {
  snapshot: PRSnapshot
  changes: PullRequestChange[]
}

export type GitHubPollerDeps = {
  fetchImpl?: typeof fetch
  getToken?: () => Promise<string>
}

export class GitHubRateLimitError extends Error {
  retryAfterMs: number

  constructor(message: string, retryAfterMs: number) {
    super(message)
    this.name = 'GitHubRateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

function truncateCommentBody(body: string): string {
  const singleLine = body.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= MAX_COMMENT_PREVIEW) {
    return singleLine
  }
  return `${singleLine.slice(0, MAX_COMMENT_PREVIEW - 1)}...`
}

function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

function defaultRetryAfterMs(headers: Headers): number {
  const retryAfter = headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10)
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000
    }
  }

  const rateLimitReset = headers.get('x-ratelimit-reset')
  if (rateLimitReset) {
    const resetSeconds = Number.parseInt(rateLimitReset, 10)
    if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
      return Math.max(30_000, resetSeconds * 1000 - Date.now())
    }
  }

  return 5 * 60 * 1000
}

async function defaultGetToken(): Promise<string> {
  if (cachedGitHubToken) {
    return cachedGitHubToken
  }
  const { stdout } = await execa('gh', [...GH_TOKEN_ARGS], {
    reject: false,
  })
  const token = stdout.trim()
  if (!token) {
    throw new Error('`gh auth token` returned an empty token.')
  }
  cachedGitHubToken = token
  return token
}

async function githubApiRequest<T>(
  path: string,
  deps: GitHubPollerDeps = {},
): Promise<T> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const token = await (deps.getToken ?? defaultGetToken)()
  const response = await fetchImpl(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'claude-code-subscribe-pr',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
  })

  if (RATE_LIMIT_STATUSES.has(response.status)) {
    throw new GitHubRateLimitError(
      'GitHub rate limit hit while polling this PR.',
      defaultRetryAfterMs(response.headers),
    )
  }

  if (!response.ok) {
    if (response.status === 401) {
      cachedGitHubToken = null
    }
    throw new Error(
      `GitHub API request failed: ${response.status} ${response.statusText}`,
    )
  }

  return (await response.json()) as T
}

async function fetchLatestComment(
  owner: string,
  repo: string,
  number: number,
  deps: GitHubPollerDeps,
): Promise<PRCommentSnapshot | undefined> {
  const [issueComments, reviewComments] = await Promise.all([
    githubApiRequest<CommentResponse[]>(
      `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`,
      deps,
    ),
    githubApiRequest<CommentResponse[]>(
      `/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`,
      deps,
    ),
  ])

  const latest = [...issueComments, ...reviewComments].sort((a, b) =>
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')),
  )[
    [...issueComments, ...reviewComments].length - 1
  ]

  if (!latest) {
    return undefined
  }

  return {
    id: latest.id,
    author: latest.user?.login ?? 'unknown',
    body: truncateCommentBody(latest.body ?? ''),
    url: latest.html_url ?? '',
    createdAt: latest.created_at ?? new Date().toISOString(),
  }
}

function summarizeChecks(
  combinedStatus: CombinedStatusResponse,
  checkRuns: CheckRunsResponse,
): PRCheckSummary {
  const statuses = combinedStatus.statuses ?? []
  const runs = checkRuns.check_runs ?? []
  const hasChecks =
    Boolean(combinedStatus.state) || statuses.length > 0 || runs.length > 0

  if (!hasChecks) {
    return 'none'
  }

  const hasPendingStatus = statuses.some(status => status.state === 'pending')
  const hasPendingRun = runs.some(
    run => run.status !== 'completed' || run.conclusion == null,
  )
  if (combinedStatus.state === 'pending' || hasPendingStatus || hasPendingRun) {
    return 'pending'
  }

  const hasFailedStatus = statuses.some(status =>
    ['error', 'failure'].includes(status.state ?? ''),
  )
  const hasFailedRun = runs.some(run =>
    [
      'action_required',
      'cancelled',
      'failure',
      'stale',
      'startup_failure',
      'timed_out',
    ].includes(run.conclusion ?? ''),
  )
  if (
    combinedStatus.state === 'failure' ||
    combinedStatus.state === 'error' ||
    hasFailedStatus ||
    hasFailedRun
  ) {
    return 'failed'
  }

  return 'passed'
}

export function parsePullRequestUrl(input: string): ParsedPullRequestUrl | null {
  const match = input
    .trim()
    .match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?(?:[?#].*)?$/i)
  if (!match?.[1] || !match[2] || !match[3]) {
    return null
  }
  const owner = match[1]
  const repo = match[2]
  const number = Number.parseInt(match[3], 10)
  if (!owner || !repo || !Number.isFinite(number)) {
    return null
  }
  return {
    owner,
    repo,
    number,
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
  }
}

export async function fetchPullRequestSnapshot(
  parsed: ParsedPullRequestUrl,
  previousCommentCount?: number,
  deps: GitHubPollerDeps = {},
): Promise<PRSnapshot> {
  const pull = await githubApiRequest<PullResponse>(
    `/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
    deps,
  )
  const [combinedStatus, checkRuns] = await Promise.all([
    githubApiRequest<CombinedStatusResponse>(
      `/repos/${parsed.owner}/${parsed.repo}/commits/${pull.head.sha}/status`,
      deps,
    ),
    githubApiRequest<CheckRunsResponse>(
      `/repos/${parsed.owner}/${parsed.repo}/commits/${pull.head.sha}/check-runs`,
      deps,
    ),
  ])
  const commentCount = (pull.comments ?? 0) + (pull.review_comments ?? 0)
  const latestComment =
    commentCount > (previousCommentCount ?? 0)
      ? await fetchLatestComment(parsed.owner, parsed.repo, parsed.number, deps)
      : undefined

  return {
    state: pull.merged_at ? 'merged' : pull.state,
    headSha: pull.head.sha,
    commentCount,
    checkSummary: summarizeChecks(combinedStatus, checkRuns),
    ...(latestComment ? { latestComment } : {}),
  }
}

export async function pollPullRequest(
  subscription: Pick<
    PRSubscription,
    'events' | 'lastState' | 'number' | 'owner' | 'repo' | 'url'
  >,
  deps: GitHubPollerDeps = {},
): Promise<PollerResult> {
  const parsed = parsePullRequestUrl(subscription.url)
  if (!parsed) {
    throw new Error(`Invalid GitHub PR URL: ${subscription.url}`)
  }

  const snapshot = await fetchPullRequestSnapshot(
    parsed,
    subscription.lastState?.commentCount,
    deps,
  )

  const changes: PullRequestChange[] = []
  const previous = subscription.lastState

  if (!previous) {
    return { snapshot, changes }
  }

  if (
    subscription.events.includes('state') &&
    previous.state !== snapshot.state
  ) {
    const stateMessage =
      snapshot.state === 'merged'
        ? `PR #${parsed.number} merged`
        : snapshot.state === 'closed'
          ? `PR #${parsed.number} closed`
          : `PR #${parsed.number} reopened`
    changes.push({ type: 'state', message: stateMessage })
  }

  if (
    subscription.events.includes('commit') &&
    previous.headSha !== snapshot.headSha
  ) {
    changes.push({
      type: 'commit',
      message: `PR #${parsed.number} — new commits (${shortSha(previous.headSha)} -> ${shortSha(snapshot.headSha)})`,
    })
  }

  if (
    subscription.events.includes('comment') &&
    snapshot.commentCount > previous.commentCount
  ) {
    const author = snapshot.latestComment?.author ?? 'unknown'
    const body = snapshot.latestComment?.body
      ? `: "${snapshot.latestComment.body}"`
      : ''
    changes.push({
      type: 'comment',
      message: `PR #${parsed.number} — new comment by @${author}${body}`,
    })
  }

  if (
    subscription.events.includes('check') &&
    previous.checkSummary !== snapshot.checkSummary
  ) {
    changes.push({
      type: 'check',
      message: `PR #${parsed.number} — checks ${snapshot.checkSummary}`,
    })
  }

  return { snapshot, changes }
}
