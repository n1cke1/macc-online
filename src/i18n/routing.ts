import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ru', 'en'],
  defaultLocale: 'ru', // RU is primary
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];

/** Canonical origin — needed for absolute hreflang/OG URLs in the static export. */
export const SITE_URL = 'https://macc-online.pages.dev';
