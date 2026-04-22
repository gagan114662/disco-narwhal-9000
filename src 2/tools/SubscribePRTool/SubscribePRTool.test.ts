import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parsePullRequestUrl, pollPullRequest } from './poller.js'
import {
  getPRSubscriptionByUrl,
  type PRSubscription,
  readPRSubscriptions,
  upsertPRSubscription,
} from './prStore.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  for (const dir of TEMP_DIRS.splice(0, TEMP_DIRS.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SubscribePRTool poller', () => {
  test('parses canonical GitHub PR URLs', () => {
    expect(
      parsePullRequestUrl('https://github.com/octo/repo/pull/123'),
    ).toEqual({
      owner: 'octo',
      repo: 'repo',
      number: 123,
      url: 'https://github.com/octo/repo/pull/123',
    })
    expect(parsePullRequestUrl('https://example.com/octo/repo/pull/123')).toBe(
      null,
    )
  })

  test('detects commit, comment, check, and state changes', async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = async input => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/repos/octo/repo/pulls/123')) {
        return jsonResponse({
          state: 'closed',
          merged_at: '2026-04-22T10:00:00.000Z',
          head: { sha: 'bbbbbbb2222222' },
          comments: 1,
          review_comments: 0,
        })
      }
      if (url.includes('/issues/123/comments?')) {
        return jsonResponse([
          {
            id: 42,
            body: 'testing the subscription',
            html_url: 'https://github.com/octo/repo/pull/123#issuecomment-42',
            created_at: '2026-04-22T10:00:00.000Z',
            user: { login: 'gagan114662' },
          },
        ])
      }
      if (url.includes('/pulls/123/comments?')) {
        return jsonResponse([])
      }
      if (url.endsWith('/commits/bbbbbbb2222222/status')) {
        return jsonResponse({
          state: 'success',
          statuses: [{ state: 'success' }],
        })
      }
      if (url.endsWith('/commits/bbbbbbb2222222/check-runs')) {
        return jsonResponse({
          check_runs: [{ status: 'completed', conclusion: 'success' }],
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }

    const subscription: Pick<
      PRSubscription,
      'events' | 'lastState' | 'number' | 'owner' | 'repo' | 'url'
    > = {
      owner: 'octo',
      repo: 'repo',
      number: 123,
      url: 'https://github.com/octo/repo/pull/123',
      events: ['commit', 'comment', 'check', 'state'],
      lastState: {
        state: 'open',
        headSha: 'aaaaaaa1111111',
        commentCount: 0,
        checkSummary: 'pending',
      },
    }

    const result = await pollPullRequest(subscription, {
      fetchImpl,
      getToken: async () => 'token',
    })

    expect(result.snapshot.state).toBe('merged')
    expect(result.snapshot.checkSummary).toBe('passed')
    expect(result.snapshot.commentCount).toBe(1)
    expect(result.changes.map(change => change.type)).toEqual([
      'state',
      'commit',
      'comment',
      'check',
    ])
    expect(result.changes.map(change => change.message)).toEqual([
      'PR #123 merged',
      'PR #123 — new commits (aaaaaaa -> bbbbbbb)',
      'PR #123 — new comment by @gagan114662: "testing the subscription"',
      'PR #123 — checks passed',
    ])
    expect(
      calls.some(url => url.endsWith('/repos/octo/repo/pulls/123')),
    ).toBeTrue()
  })
})

describe('SubscribePRTool store', () => {
  test('writes and reads subscriptions from the Claude config dir', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeTempDir('subscribe-pr-store-')

    const subscription: PRSubscription = {
      id: 'sub-1234',
      url: 'https://github.com/octo/repo/pull/123',
      owner: 'octo',
      repo: 'repo',
      number: 123,
      intervalSec: 60,
      events: ['commit', 'comment', 'check', 'state'],
      cron: '* * * * *',
      cronTaskId: 'cron-1234',
      createdAt: '2026-04-22T09:00:00.000Z',
      updatedAt: '2026-04-22T09:00:00.000Z',
      lastCheckedAt: '2026-04-22T09:00:00.000Z',
      lastState: {
        state: 'open',
        headSha: 'aaaaaaa1111111',
        commentCount: 0,
        checkSummary: 'pending',
      },
      consecutiveFailures: 0,
    }

    await upsertPRSubscription(subscription)

    expect(await readPRSubscriptions()).toEqual([subscription])
    expect(
      await getPRSubscriptionByUrl('https://github.com/octo/repo/pull/123'),
    ).toEqual(subscription)
  })
})
