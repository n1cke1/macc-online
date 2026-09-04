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

// RU→EN rendering of physical units. Two layers: an exact table for every unit the baked
// curve actually ships (checked by `npm run i18n-check`), and the old token pass as a fallback
// so a unit newly authored in Supabase degrades to a partial translation instead of raw
// Cyrillic. RU is shown verbatim. EN is machine-draft pending review.
const UNIT_EN_EXACT: Record<string, string> = {
  // already English in the data — listed so the exact table stays a complete census of `unit`
  '$/farm': '$/farm',
  '$/head': '$/head',
  '$/head·yr': '$/head·yr',
  '$/kW': '$/kW',
  '$/t': '$/t',
  '$/thousand m³': '$/thousand m³',
  COP: 'COP',
  MWh: 'MWh',
  fraction: 'fraction',
  'kt CO₂eq/(million m³)': 'kt CO₂eq/(million m³)',
  'kt CO₂eq/(thousand head·yr)': 'kt CO₂eq/(thousand head·yr)',
  'kt CO₂eq/yr': 'kt CO₂eq/yr',
  mUSD: 'mUSD',
  'mUSD/yr': 'mUSD/yr',
  'tC/t': 'tC/t',
  'tCO₂/MWh': 'tCO₂/MWh',
  'tCO₂/MWh (coal baseline)': 'tCO₂/MWh (coal baseline)',
  // money per physical thing
  '$/МВтч': '$/MWh',
  '$/авто': '$/vehicle',
  '$/га': '$/ha',
  '$/кВт': '$/kW',
  '$/кВт(т)': '$/kW(th)',
  '$/кВт(э)': '$/kW(e)',
  '$/кВт/год': '$/kW/yr',
  '$/м²': '$/m²',
  '$/т': '$/t',
  '$/т CO₂/год': '$/t CO₂/yr',
  '$/тыс. м³': '$/thousand m³',
  '$/тыс.м³': '$/thousand m³',
  '$/тыс.м³/год': '$/thousand m³/yr',
  'mUSD/завод': 'mUSD/plant',
  'mUSD/км': 'mUSD/km',
  'mUSD/полигон': 'mUSD/landfill',
  'mUSD/установку': 'mUSD/installation',
  'mUSD/шт': 'mUSD/unit',
  'тыс. $/объект': 'thousand $/site',
  'тыс. $/шт': 'thousand $/unit',
  // energy, power, emissions
  'kt CO₂eq/(млн м³)': 'kt CO₂eq/(million m³)',
  'kt CO₂eq/(тыс. голов·год)': 'kt CO₂eq/(thousand head·yr)',
  'tCO₂/Гкал': 'tCO₂/Gcal',
  'ГВт·ч/год': 'GWh/yr',
  'ГДж/т': 'GJ/t',
  'ГДж/тыс. м³': 'GJ/thousand m³',
  'МВт': 'MW',
  'МВт(т)': 'MW(th)',
  'МВт(э)': 'MW(e)',
  'МВт·ч/год': 'MWh/yr',
  'Мт CO₂eq/год': 'Mt CO₂eq/yr',
  'кВт': 'kW',
  'кг CO₂/ГДж': 'kg CO₂/GJ',
  'кгCO₂/л': 'kgCO₂/L',
  'тCO₂/(га·год)': 'tCO₂/(ha·yr)',
  'тCO₂/Гкал': 'tCO₂/Gcal',
  'тCO₂/МВтч': 'tCO₂/MWh',
  'тыс. Гкал': 'thousand Gcal',
  'тыс. Гкал/год': 'thousand Gcal/yr',
  'тыс. т CO₂/год': 'thousand t CO₂/yr',
  // shares of a CAPEX line
  'доля': 'fraction',
  'доля от CAPEX ГТЭС': 'fraction of gas-turbine plant CAPEX',
  'доля от CAPEX восстановления': 'fraction of restoration CAPEX',
  'доля от CAPEX дегазации': 'fraction of degasification CAPEX',
  'доля от CAPEX котла': 'fraction of boiler CAPEX',
  'доля от CAPEX улавливания': 'fraction of capture CAPEX',
  'доля от CAPEX установки': 'fraction of installation CAPEX',
  'доля от CAPEX/год': 'fraction of CAPEX/yr',
  'доля от основного CAPEX': 'fraction of core CAPEX',
  // counts, lengths, volumes, misc
  'голов': 'head',
  'км': 'km',
  'км/год': 'km/yr',
  'л/100км': 'L/100km',
  'лет': 'yr',
  'м': 'm',
  'млн м³': 'million m³',
  'млрд м³/год': 'bn m³/yr',
  'млрд ткм': 'bn t·km',
  'ткм': 't·km',
  'т': 't',
  'тыс. га': 'thousand ha',
  'тыс. голов': 'thousand head',
  'тыс. м³': 'thousand m³',
  'тыс. шт': 'thousand units',
  'усл. ед. (объём метана)': 'rel. units (methane volume)',
  'хозяйств': 'households',
  'шт': 'units',
  'эт': 'floors',
};

// Fallback for units the exact table has not seen yet. Order matters: longer/more-specific
// tokens first. `\b` is ASCII-only in JS, so the short RU tokens are fenced with an explicit
// Cyrillic-neighbour guard instead — a bare /га/ used to eat the "га" inside "дегазации".
const UNIT_EN_TOKENS: Array<[RegExp, string]> = [
  [/МВт\(т\)/g, 'MW(th)'],
  [/МВт\(э\)/g, 'MW(e)'],
  [/ГВтч|ГВт·ч/g, 'GWh'],
  [/МВтч|МВт·ч/g, 'MWh'],
  [/кВтч|кВт·ч/g, 'kWh'],
  [/ГВт/g, 'GW'],
  [/МВт/g, 'MW'],
  [/кВт/g, 'kW'],
  [/Гкал/g, 'Gcal'],
  [/тыс\.?/g, 'thousand'],
  [/млрд/g, 'bn'],
  [/млн/g, 'million'],
  [/(^|[^А-Яа-яЁё])га(?![А-Яа-яЁё])/g, '$1ha'],
  [/(^|[^А-Яа-яЁё])км(?![А-Яа-яЁё])/g, '$1km'],
  [/(^|[^А-Яа-яЁё])шт(?![А-Яа-яЁё])/g, '$1units'],
  [/(^|[^А-Яа-яЁё])голов(?![А-Яа-яЁё])/g, '$1head'],
  [/(^|[^А-Яа-яЁё])лет(?![А-Яа-яЁё])/g, '$1yr'],
  [/(^|[^А-Яа-яЁё])доля(?![А-Яа-яЁё])/g, '$1fraction'],
  [/м³|м3/g, 'm³'],
  [/м²|м2/g, 'm²'],
  [/\/год/g, '/yr'],
  [/·год/g, '·yr'],
  [/(^|\s)т(\b|\s|\/)/g, '$1t$2'], // standalone tonnes
];

export function formatUnit(unit: string, locale: string): string {
  if (locale !== 'en') return unit;
  const exact = UNIT_EN_EXACT[unit];
  if (exact !== undefined) return exact;
  return UNIT_EN_TOKENS.reduce((s, [re, rep]) => s.replace(re, rep), unit).replace(/\s+/g, ' ').trim();
}
