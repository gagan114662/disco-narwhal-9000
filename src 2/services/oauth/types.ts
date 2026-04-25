/**
 * Shared OAuth types for the Claude.ai / Console authentication flow.
 *
 * Re-derived from consumer usage after the original `services/oauth/types.ts`
 * went missing. Cross-referenced against:
 *   - services/oauth/client.ts          (formatTokens, fetchProfileInfo, OAuthTokens fields)
 *   - services/oauth/index.ts           (OAuthService.formatTokens, type imports)
 *   - services/oauth/getOauthProfile.ts (axios.get<OAuthProfileResponse> response shape)
 *   - cli/handlers/auth.ts              (installOAuthTokens consumer)
 *   - utils/auth.ts, utils/config.ts    (storage + AccountInfo bridges)
 *   - dist/cli.js                       (sanity check on the compiled fields)
 *
 * If a more authoritative source surfaces (git history of the original file,
 * a sibling worktree, etc.) prefer that — these shapes are correct for the
 * call sites I could find but are intentionally permissive on string unions
 * to avoid narrowing past evidence.
 */

/** Subscription tier surfaced from the org's `organization_type`. */
export type SubscriptionType = 'max' | 'pro' | 'enterprise' | 'team'

/**
 * Rate-limit tier carried on `organization.rate_limit_tier`. Backend-defined
 * string; kept open until we have an exhaustive list.
 */
export type RateLimitTier = string

/**
 * Billing model carried on `organization.billing_type`. Backend-defined
 * string; kept open until we have an exhaustive list.
 */
export type BillingType = string

/**
 * Raw `/api/oauth/profile` (or `/api/claude_cli_profile`) response.
 * Field names mirror the wire format (snake_case) — do not rename.
 */
export type OAuthProfileResponse = {
  account: {
    uuid: string
    email: string
    display_name?: string | null
    created_at?: string
    has_claude_max?: boolean
    has_claude_pro?: boolean
  }
  organization: {
    uuid: string
    organization_type?: string
    rate_limit_tier?: RateLimitTier | null
    has_extra_usage_enabled?: boolean | null
    billing_type?: BillingType | null
    subscription_created_at?: string | null
  }
}

/**
 * Raw `/oauth/token` response. The token endpoint also embeds account info
 * for the post-exchange redirect, used as a fallback when the profile call
 * fails.
 */
export type OAuthTokenExchangeResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  account?: {
    uuid: string
    email_address: string
  }
  organization?: {
    uuid: string
  }
}

/**
 * In-memory representation of a successful auth flow. This is what the rest
 * of the code (auth.ts, secureStorage, MCP/teamMemory clients) actually
 * consumes — already camelCased and enriched with profile-derived fields.
 */
export type OAuthTokens = {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  scopes: string[]
  subscriptionType: SubscriptionType | null
  rateLimitTier: RateLimitTier | null
  profile?: OAuthProfileResponse
  tokenAccount?: {
    uuid: string
    emailAddress: string
    organizationUuid?: string
  }
}

/** Response from `/api/v1/oauth/user_roles` — used to populate AccountInfo. */
export type UserRolesResponse = {
  organization_role: string
  workspace_role: string
  organization_name: string
}
