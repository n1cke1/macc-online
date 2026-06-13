import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: zero server runtime → hosts free on Cloudflare Pages / GitHub Pages / any static host.
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};

export default withNextIntl(nextConfig);
