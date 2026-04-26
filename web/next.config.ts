import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: '/terms', destination: '/legal/terms', permanent: true },
      { source: '/privacy', destination: '/legal/privacy', permanent: true },
      { source: '/dpa', destination: '/legal/dpa', permanent: true },
      { source: '/sub-processors', destination: '/legal/sub-processors', permanent: true },
      { source: '/telemetry', destination: '/legal/telemetry', permanent: true },
      { source: '/advisories', destination: '/security/advisories', permanent: true },
      { source: '/research-notes', destination: '/research', permanent: true },
      { source: '/sign-in', destination: '/signin', permanent: true },
      { source: '/login', destination: '/signin', permanent: true },
    ]
  },
}

export default nextConfig
