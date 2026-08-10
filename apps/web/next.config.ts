import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    let target = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    target = target.trim().replace(/\/+$/, '');
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = `https://${target}`;
    }
    console.log('[next.config.ts] Proxying /api/* ->', `${target}/api/:path*`);
    return [{ source: '/api/:path*', destination: `${target}/api/:path*` }];
  },
};

export default nextConfig;
