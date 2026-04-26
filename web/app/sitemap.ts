import type { MetadataRoute } from 'next'

const BASE = 'https://kairos-sf.dev'

const ROUTES: Array<{ path: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' }> = [
  { path: '/', priority: 1.0, changeFrequency: 'weekly' },
  { path: '/product', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/security', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/pricing', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/start', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/contact', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/app', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/about', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/changelog', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/status', priority: 0.5, changeFrequency: 'daily' },
  { path: '/docs', priority: 0.5, changeFrequency: 'weekly' },
  { path: '/blog', priority: 0.4, changeFrequency: 'weekly' },
  { path: '/research', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/community', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/careers', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/press', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/security/advisories', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/legal/terms', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/legal/privacy', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/legal/dpa', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/legal/sub-processors', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/legal/telemetry', priority: 0.3, changeFrequency: 'monthly' },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return ROUTES.map((r) => ({
    url: `${BASE}${r.path}`,
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }))
}
