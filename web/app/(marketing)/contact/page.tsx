import type { Metadata } from 'next'
import { PageShell } from '@/components/page-shell'
import { NotifyForm, type NotifyIntent } from '@/components/notify-form'

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Reach the right desk: sales and enterprise, engineering, security disclosures, press and analyst.',
}

type Route = {
  name: string
  body: string
  email: string
}

const ROUTES: Route[] = [
  {
    name: 'Sales & enterprise',
    body: 'For PoCs, on-prem deployments, BAA, and procurement reviews. Reply within one business day.',
    email: 'sales@kairos-sf.dev',
  },
  {
    name: 'Engineering',
    body: 'Technical questions, architecture deep-dives, integration scoping. Get the engineer who built the surface you’re asking about.',
    email: 'engineering@kairos-sf.dev',
  },
  {
    name: 'Security & responsible disclosure',
    body: 'Report a vulnerability privately. We acknowledge within 24 hours. Public advisory after coordinated fix.',
    email: 'security@kairos-sf.dev',
  },
  {
    name: 'Press & analyst',
    body: 'Briefings, embargoed previews, and analyst inquiries.',
    email: 'press@kairos-sf.dev',
  },
]

type Context = {
  banner: string
  emphasizedEmail: string
  subject: string
  body: string
  formIntent?: NotifyIntent
  formCta?: string
  formFields?: Array<'team-size' | 'deployment-model' | 'role'>
  formSuccess?: string
}

function resolveContext(intent?: string, tier?: string): Context | null {
  if (tier === 'local') {
    return {
      banner: 'You’re asking about Local — the OSS install. No account, no telemetry by default. The fastest answer is the install guide.',
      emphasizedEmail: 'engineering@kairos-sf.dev',
      subject: 'Local — question',
      body: 'Hello,\n\nI’m running Local and have a question about:\n\n— ',
    }
  }
  if (tier === 'enterprise') {
    return {
      banner: 'You’re requesting an Enterprise PoC. We’ll route this to the founder and a Customer Success Engineer.',
      emphasizedEmail: 'sales@kairos-sf.dev',
      subject: 'Enterprise PoC — request',
      body: 'Hello,\n\nI’d like to talk about an Enterprise PoC. Context on our environment, timeline, and regulatory posture:\n\n— ',
      formIntent: 'enterprise',
      formCta: 'Request PoC scoping',
      formFields: ['team-size', 'deployment-model', 'role'],
      formSuccess: 'Got it. A founder will reply within one business day.',
    }
  }
  if (tier === 'cloud-team') {
    return {
      banner: 'You’re asking about Cloud Team (26–200 seats). We’ll route this to sales for a scoping call.',
      emphasizedEmail: 'sales@kairos-sf.dev',
      subject: 'Cloud Team — scoping',
      body: 'Hello,\n\nI’d like to talk about Cloud Team. Team size, SSO requirements, and audit-export needs:\n\n— ',
    }
  }
  if (tier === 'cloud-pro' || intent === 'cloud-pro-access') {
    return {
      banner: 'You’re requesting Cloud Pro early access. We’ll send an invite as a slot opens.',
      emphasizedEmail: 'sales@kairos-sf.dev',
      subject: 'Cloud Pro — early access request',
      body: 'Hello,\n\nI’d like early access to Cloud Pro. Team size and primary use case:\n\n— ',
      formIntent: 'cloud-pro',
      formCta: 'Request access',
      formFields: ['team-size', 'deployment-model'],
      formSuccess: 'Thanks — you’re in the early-access queue.',
    }
  }
  if (intent === 'advisories-subscribe') {
    return {
      banner: 'You’re subscribing to security advisories. Reply with the address you want on the list.',
      emphasizedEmail: 'security@kairos-sf.dev',
      subject: 'Advisories — subscribe',
      body: 'Hello,\n\nPlease add me to the security advisories list. The address to use is:\n\n— ',
    }
  }
  if (intent === 'press') {
    return {
      banner: 'You’re reaching out as press or analyst. Briefings on request, embargoes honored.',
      emphasizedEmail: 'press@kairos-sf.dev',
      subject: 'Press — briefing request',
      body: 'Hello,\n\nI’m working on a story about [topic]. Outlet, deadline, and what you’re asking about:\n\n— ',
    }
  }
  if (intent === 'careers') {
    return {
      banner: 'You’re reaching out about careers. Hiring opens with M2; we’re keeping a short list until then.',
      emphasizedEmail: 'engineering@kairos-sf.dev',
      subject: 'Careers — interest',
      body: 'Hello,\n\nI’d like to be on your short list once hiring opens. A few lines about my background:\n\n— ',
    }
  }
  return null
}

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string; tier?: string }>
}) {
  const { intent, tier } = await searchParams
  const ctx = resolveContext(intent, tier)

  return (
    <PageShell
      eyebrow="Contact"
      title="Reach the right desk."
      lede="We don’t route through a generic inbox. Pick the desk you need and you’ll get someone who can answer."
    >
      {ctx && (
        <div className="mb-8 rounded-xl border border-accent/30 bg-accent/5 p-5 md:p-6">
          <div className="text-xs uppercase tracking-widest text-accent">Context picked up</div>
          <p className="mt-2 text-fg text-pretty">{ctx.banner}</p>

          {ctx.formIntent ? (
            <div className="mt-5 max-w-xl">
              <NotifyForm
                intent={ctx.formIntent}
                cta={ctx.formCta ?? 'Request'}
                fields={ctx.formFields}
                layout="stacked"
                hint={`Or email ${ctx.emphasizedEmail} directly.`}
                successMessage={ctx.formSuccess}
              />
            </div>
          ) : (
            <a
              href={`mailto:${ctx.emphasizedEmail}?subject=${encodeURIComponent(ctx.subject)}&body=${encodeURIComponent(ctx.body)}`}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-fg text-bg px-4 py-2 text-sm hover:opacity-90 transition-opacity"
            >
              Email {ctx.emphasizedEmail} →
            </a>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-px bg-border border border-border rounded-xl overflow-hidden">
        {ROUTES.map((r) => {
          const isEmphasized = ctx?.emphasizedEmail === r.email
          return (
            <div
              key={r.name}
              className={`bg-bg p-8 ${isEmphasized ? 'ring-1 ring-accent ring-inset' : ''}`}
            >
              <div className="font-serif text-2xl tracking-tight">{r.name}</div>
              <p className="mt-3 text-muted text-pretty max-w-readable">{r.body}</p>
              <a
                href={`mailto:${r.email}`}
                className="mt-6 inline-flex items-center gap-2 font-mono text-sm text-fg underline-offset-4 hover:underline"
              >
                {r.email}
              </a>
            </div>
          )
        })}
      </div>

      <p className="mt-12 text-sm text-subtle max-w-readable">
        Email addresses above are pre-launch. During preview, the founder address provided in your
        invite is the fastest route — every message there is read.
      </p>
    </PageShell>
  )
}
