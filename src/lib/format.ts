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

// Best-effort RU→EN transliteration of physical units (e.g. "тыс. МВтч/год" →
// "k MWh/yr"). EN labels are machine-draft pending review; RU is shown verbatim.
// Order matters: longer/more-specific tokens first.
const UNIT_EN: Array<[RegExp, string]> = [
  [/МВт\(т\)/g, 'MW(th)'],
  [/МВт\(э\)/g, 'MW(e)'],
  [/ГВтч/g, 'GWh'],
  [/МВтч/g, 'MWh'],
  [/кВтч/g, 'kWh'],
  [/ГВт/g, 'GW'],
  [/МВт/g, 'MW'],
  [/кВт/g, 'kW'],
  [/Гкал/g, 'Gcal'],
  [/тыс\.?/g, 'k'],
  [/млрд/g, 'bn'],
  [/млн/g, 'M'],
  [/га/g, 'ha'],
  [/км/g, 'km'],
  [/шт/g, 'units'],
  [/голов/g, 'head'],
  [/м³|м3/g, 'm³'],
  [/м²|м2/g, 'm²'],
  [/\/год/g, '/yr'],
  [/(^|\s)т(\b|\s|\/)/g, '$1t$2'], // standalone tonnes
];

export function formatUnit(unit: string, locale: string): string {
  if (locale !== 'en') return unit;
  return UNIT_EN.reduce((s, [re, rep]) => s.replace(re, rep), unit).replace(/\s+/g, ' ').trim();
}
