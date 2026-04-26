import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/app/projects/'],
      },
    ],
    sitemap: 'https://kairos-sf.dev/sitemap.xml',
    host: 'https://kairos-sf.dev',
  }
}
