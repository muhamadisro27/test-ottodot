import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    const target = process.env.API_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${target}/api/:path*` }];
  },
};

export default nextConfig;
