import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ru', 'en'],
  defaultLocale: 'ru', // RU is primary
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];
