import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    const rawTarget = process.env.API_URL ?? 'http://localhost:4000';
    const target = rawTarget.replace(/\/+$/, '');
    return [{ source: '/api/:path*', destination: `${target}/api/:path*` }];
  },
};

export default nextConfig;
