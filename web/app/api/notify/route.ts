import { NextResponse } from 'next/server'

const VALID_INTENTS = new Set([
  'cloud-pro',
  'enterprise',
  'updates',
  'docs',
  'community',
  'careers',
  'research',
  'changelog',
  'blog',
  'press',
  'general',
])

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }

  const payload = body as Record<string, unknown>
  const email = typeof payload.email === 'string' ? payload.email.trim() : ''
  const intent = typeof payload.intent === 'string' ? payload.intent : 'general'

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 })
  }

  if (!VALID_INTENTS.has(intent)) {
    return NextResponse.json({ ok: false, error: 'invalid_intent' }, { status: 400 })
  }

  // Stub: in production this forwards to Resend / Postmark / a CRM webhook.
  // For preview we just acknowledge.
  console.log('[notify]', JSON.stringify({ intent, email, payload }))

  return NextResponse.json({ ok: true })
}
