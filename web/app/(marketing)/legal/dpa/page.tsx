import type { Metadata } from 'next'
import { PageShell } from '@/components/page-shell'

export const metadata: Metadata = {
  title: 'Data Processing Agreement',
  description: 'How we process customer personal data on your behalf — DPA summary.',
}

export default function DPAPage() {
  return (
    <PageShell
      eyebrow="Legal · Data Processing Agreement"
      title="Data Processing Agreement"
      lede="A DPA governs how we process customer personal data on your behalf. The signed version is incorporated into your Customer Agreement; this page summarizes the substantive terms."
    >
      <article className="space-y-8 max-w-prose text-pretty">
        <Block title="Roles">
          You are the controller of personal data you submit to the service. We are a processor,
          acting on your documented instructions, and a sub-processor only where Customer
          Agreements require it.
        </Block>
        <Block title="Sub-processors">
          A current list is published at{' '}
          <a href="/legal/sub-processors" className="underline underline-offset-4">
            /legal/sub-processors
          </a>
          . Material changes are announced at least 30 days before they take effect, with an
          objection window for Cloud Team and Enterprise customers.
        </Block>
        <Block title="Security measures">
          Encryption at rest and in transit. Cross-tenant isolation enforced and chaos-tested.
          Customer-managed keys available on Enterprise. Access controlled by least-privilege RBAC
          with quarterly reviews. Annual third-party pentest.
        </Block>
        <Block title="Sub-processor flow-down">
          Sub-processors are bound by terms substantially equivalent to those you have with us.
          Where required, EU Standard Contractual Clauses are incorporated by reference.
        </Block>
        <Block title="Incident notification">
          We notify affected customers without undue delay after confirmation of a personal data
          breach, with the specifics required under applicable law. Sev1 incident handling is
          governed by the runbook in the security pack.
        </Block>
        <Block title="Data subject requests">
          Access, rectification, erasure, portability, and restriction requests are honored in-app
          and via API. PII is tombstoned in audit chains so erasure does not break chain integrity.
        </Block>
        <Block title="Audit rights">
          Annual third-party pentest reports are shareable under NDA. Right-to-audit clauses are
          honored under NDA per the Customer Agreement; insider-access procedure is documented in
          the security pack.
        </Block>
        <Block title="Return or deletion">
          On termination, data export is available via{' '}
          <code>kairos export tenant</code>. Deletion follows the retention schedule in the
          Customer Agreement; audit logs are preserved per the regulatory window applicable to the
          tenant.
        </Block>
        <p className="text-xs text-subtle">
          v0.1 · Last updated 2026-04-25 · Counsel review in progress; the substantive terms above
          are stable but the signed DPA on your Customer Agreement supersedes this preview copy.
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
