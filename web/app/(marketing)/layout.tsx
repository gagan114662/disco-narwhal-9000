import { Nav } from '@/components/nav'
import { Footer } from '@/components/footer'
import { ConsentBanner } from '@/components/consent-banner'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main>{children}</main>
      <Footer />
      <ConsentBanner />
    </>
  )
}
