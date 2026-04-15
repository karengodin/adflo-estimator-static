import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Enforce stricter React behavior in development (double-invokes effects to catch bugs)
  reactStrictMode: true,

  experimental: {
    // Enables compile-time type safety on href props (catches broken links at build time)
    typedRoutes: true,
  },
}

export default nextConfig
