import type { Metadata } from 'next'
import { Hero } from '@/components/sections/hero'

export const metadata: Metadata = {
  title: { absolute: 'KAIROS-SF — Provable software, built by AI' },
  description:
    'AI is shipping your code. Can you prove what shipped? Two agents on every build, gated when they disagree. The audit chain is the receipt.',
}
import { Problem } from '@/components/sections/problem'
import { Proofs } from '@/components/sections/proofs'
import { HowItWorks } from '@/components/sections/how-it-works'
import { Industries } from '@/components/sections/industries'
import { SecurityBand } from '@/components/sections/security-band'
import { PricingTeaser } from '@/components/sections/pricing-teaser'
import { CTA } from '@/components/sections/cta'

export default function HomePage() {
  return (
    <>
      <Hero />
      <Problem />
      <Proofs />
      <HowItWorks />
      <Industries />
      <SecurityBand />
      <PricingTeaser />
      <CTA />
    </>
  )
}
