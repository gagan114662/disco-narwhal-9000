import type { Metadata, Viewport } from 'next'
import { Inter, Source_Serif_4, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const serif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAFAF7' },
    { media: '(prefers-color-scheme: dark)', color: '#121210' },
  ],
}

export const metadata: Metadata = {
  metadataBase: new URL('https://kairos-sf.dev'),
  title: {
    default: 'KAIROS-SF — Provable software, built by AI',
    template: '%s — KAIROS-SF',
  },
  description:
    'Plain-English specs become auditable, deployed apps. Two agents on every build, gated when they disagree. The audit chain is the receipt.',
  openGraph: {
    type: 'website',
    siteName: 'KAIROS-SF',
    title: 'KAIROS-SF — Provable software, built by AI',
    description:
      'Plain-English specs become auditable, deployed apps. Two agents on every build, gated when they disagree.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'KAIROS-SF',
    description:
      'Plain-English specs become auditable, deployed apps. Two agents on every build, gated when they disagree.',
  },
}

const themeBootstrap = `
(function() {
  try {
    var stored = localStorage.getItem('kairos-theme');
    var theme = stored === 'dark' || stored === 'light'
      ? stored
      : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    if (theme === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${serif.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
