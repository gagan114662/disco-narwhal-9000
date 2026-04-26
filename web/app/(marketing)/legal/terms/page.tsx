import type { Metadata } from 'next'
import { PageShell } from '@/components/page-shell'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms governing use of KAIROS-SF software, hosted services, and APIs.',
}

export default function TermsPage() {
  return (
    <PageShell
      eyebrow="Legal · Terms of Service"
      title="Terms of Service"
      lede="These terms govern your use of KAIROS-SF software, hosted services, and APIs. The current text is in late draft; the live version below will be replaced with counsel-reviewed terms before public Cloud Pro launch."
    >
      <article className="prose-styles space-y-8 max-w-prose text-pretty">
        <Block title="1. Acceptance">
          By installing the software or accessing the hosted service, you agree to these terms on
          behalf of yourself and the entity you represent. If you do not agree, do not install or
          access the service.
        </Block>
        <Block title="2. Software license">
          The OSS core is licensed under Apache 2.0. The full license text ships with the binary at{' '}
          <code>LICENSE</code>. Commercial features are licensed separately under a commercial
          agreement, available on request.
        </Block>
        <Block title="3. Customer data and IP">
          You retain all rights to your specs, code, and the apps generated through the platform.
          We claim no ownership over your output. We do not train models on your customer data
          without explicit written consent.
        </Block>
        <Block title="4. Acceptable use">
          You will not use the platform to generate or operate software that violates law, infringes
          third-party rights, or targets critical infrastructure without authorization. Full policy
          ships with the production terms.
        </Block>
        <Block title="5. Service levels">
          Hosted service levels are governed by the Customer Agreement and the SLO catalog. The
          public SLO catalog lives in the documentation site; the binding service levels live in
          your contract.
        </Block>
        <Block title="6. Termination">
          Either party may terminate for material breach with 30 days’ notice. On termination you
          may export your tenant data using <code>kairos export tenant</code>. We retain audit logs
          per the retention schedule documented in the DPA.
        </Block>
        <Block title="7. Limitation of liability">
          To the extent permitted by law, our aggregate liability is capped at fees paid in the
          preceding twelve months. The full clause is in the Customer Agreement.
        </Block>
        <Block title="8. Updates">
          We will provide at least 30 days’ notice of material changes via email and the changelog.
          The “last updated” date below reflects the current revision.
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
