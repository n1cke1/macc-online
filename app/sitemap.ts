import type { MetadataRoute } from 'next';
import { routing, SITE_URL } from '@/i18n/routing';

// `output: 'export'` needs the route pinned as static, otherwise the build refuses to
// collect it.
export const dynamic = 'force-static';

/** Static export emits this as /sitemap.xml at build time. */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ['', 'connect/'];
  return routing.locales.flatMap((locale) =>
    paths.map((path) => ({
      url: `${SITE_URL}/${locale}/${path}`,
      changeFrequency: 'monthly' as const,
      priority: path === '' ? 1 : 0.5,
      alternates: {
        languages: Object.fromEntries(
          routing.locales.map((l) => [l, `${SITE_URL}/${l}/${path}`]),
        ),
      },
    })),
  );
}
