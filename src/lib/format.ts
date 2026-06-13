// Locale-aware number formatting. KT → MT conversion for the abatement axis.

export function fmt(value: number, locale: string, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU', opts).format(value);
}

export function fmtMac(value: number, locale: string): string {
  return fmt(value, locale, { maximumFractionDigits: 1 });
}

/** kt → Mt (chart x-axis & KPI). */
export function ktToMt(kt: number): number {
  return kt / 1000;
}

export function fmtMt(kt: number, locale: string): string {
  return fmt(ktToMt(kt), locale, { maximumFractionDigits: 1 });
}

export function fmtInt(value: number, locale: string): string {
  return fmt(Math.round(value), locale, { maximumFractionDigits: 0 });
}

export function fmtPct(fraction: number, locale: string): string {
  return fmt(fraction * 100, locale, { maximumFractionDigits: 1 }) + '%';
}
