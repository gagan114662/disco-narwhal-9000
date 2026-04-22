export const SUBSCRIBE_PR_TOOL_NAME = 'SubscribePR'

export const DESCRIPTION =
  'Watch a GitHub pull request and notify the user when its state changes'

export const SUBSCRIBE_PR_TOOL_PROMPT = `Subscribe to a GitHub pull request so Claude can keep watching it in the background.

Use this when the user asks you to watch, monitor, or subscribe to a PR.

\`url\` must be a full GitHub pull request URL like \`https://github.com/owner/repo/pull/123\`.
\`intervalSec\` defaults to 60, has a minimum of 30, and a maximum of 3600.
\`events\` defaults to all supported changes: commits, comments, checks, and state transitions.

The subscription is durable, creates a recurring cron wake-up, and survives CLI restarts.`
