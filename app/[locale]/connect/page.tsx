import { setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import ConnectClient from '@/components/connect/ConnectClient';

// The OAuth login bridge page for the hosted MCP Worker (docs/oauth-mcp-cloudflare.md).
// Static-exported per locale; the actual sign-in + hand-back logic is client-side.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function ConnectPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ConnectClient />;
}
