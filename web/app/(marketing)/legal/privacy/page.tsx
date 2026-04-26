import type { Metadata } from 'next'
import { PageShell } from '@/components/page-shell'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What we collect, what we don’t, and the choices you have.',
}

export default function PrivacyPage() {
  return (
    <PageShell
      eyebrow="Legal · Privacy Policy"
      title="Privacy Policy"
      lede="This page summarizes the data we process and the choices you have. The full counsel-reviewed text replaces this draft before public Cloud Pro launch."
    >
      <article className="space-y-8 max-w-prose text-pretty">
        <Block title="What we collect">
          Account data (name, email, organization). Usage telemetry where opted in. The contents of
          specs and audit chains you create on the hosted service. Operational logs needed to run
          the service.
        </Block>
        <Block title="What we do not collect">
          The contents of code generated on a Local install. The contents of audit chains stored in
          a self-hosted or air-gapped deployment. Model prompts and completions in air-gap mode —
          those go directly between you and your LLM provider.
        </Block>
        <Block title="How we use it">
          To operate the service, bill you, respond to your support requests, and improve the
          product in aggregate. We do not sell your data. We do not train foundation models on
          customer data without written consent.
        </Block>
        <Block title="Sub-processors">
          The current list is at{' '}
          <a href="/legal/sub-processors" className="underline underline-offset-4">
            /legal/sub-processors
          </a>
          . We notify customers in advance of additions.
        </Block>
        <Block title="Data residency">
          US by default. EU region launches with Cloud Team. Enterprise customers can pin residency
          via on-prem or single-tenant deployment.
        </Block>
        <Block title="Your rights">
          Access, export, correction, and deletion are available in-app and via API. GDPR data
          subject requests are processed within statutory windows; the runbook is in the DPA.
        </Block>
        <Block title="Telemetry posture">
          OSS self-host: opt-in. Cloud: collected and disclosed in-app at{' '}
          <a href="/legal/telemetry" className="underline underline-offset-4">
            /legal/telemetry
          </a>
          .
        </Block>
        <p className="text-xs text-subtle">
          v0.1 · Last updated 2026-04-25 · Counsel review in progress; the substantive terms above
          are stable but the binding text on your contract supersedes this preview copy.
        </p>
      </article>
    </PageShell>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-serif text-xl tracking-tight">{title}</h2>
      <p className="mt-2 text-muted">{children}</p>
    </section>
  )
}
