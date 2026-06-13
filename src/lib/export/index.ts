// Export helpers for the static core: a scenario is fully reproducible from its
// JSON (model version + levers), and the curve/measures are downloadable as CSV
// or SVG. All pure string builders + a browser download helper; no backend.
import type { MaccPoint, DatasetTotals, Levers } from '@data/schema';
import { pick } from '@/lib/data';

export interface ScenarioExport {
  schema: 'macc-scenario';
  schemaVersion: 1;
  modelVersion: string;
  exportedFrom: string; // URL the scenario can be reopened at
  levers: Levers;
  totals: DatasetTotals;
  curve: Array<{
    id: number;
    sector: string;
    name: string;
    mac: number;
    abatementKt: number;
    capex: number;
    opex: number;
    npv: number;
    durationYrs: number;
    cumAbatementStartKt: number;
    cumAbatementEndKt: number;
  }>;
}

export function buildScenarioJson(args: {
  modelVersion: string;
  levers: Levers;
  totals: DatasetTotals;
  projects: MaccPoint[];
  locale: 'ru' | 'en';
  url: string;
}): ScenarioExport {
  const { modelVersion, levers, totals, projects, locale, url } = args;
  return {
    schema: 'macc-scenario',
    schemaVersion: 1,
    modelVersion,
    exportedFrom: url,
    levers,
    totals,
    curve: projects.map((p) => ({
      id: p.id,
      sector: p.sector,
      name: pick(p.name, locale),
      mac: p.mac,
      abatementKt: p.abatementKt,
      capex: p.capex,
      opex: p.opex,
      npv: p.npv,
      durationYrs: p.durationYrs,
      cumAbatementStartKt: p.cumAbatementStartKt,
      cumAbatementEndKt: p.cumAbatementEndKt,
    })),
  };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** One row per measure, in curve order. */
export function buildMeasuresCsv(projects: MaccPoint[], locale: 'ru' | 'en'): string {
  const header = [
    'id',
    'sector',
    'name',
    'mac_usd_per_t',
    'abatement_kt_per_yr',
    'capex_musd',
    'opex_musd_per_yr',
    'duration_yr',
    'npv_musd',
    'disc_co2_kt',
  ];
  const rows = projects.map((p) => [
    p.id,
    p.sector,
    pick(p.name, locale),
    p.mac,
    p.abatementKt,
    p.capex,
    p.opex,
    p.durationYrs,
    p.npv,
    p.discCo2Kt,
  ]);
  return toCsv([header, ...rows]);
}

/** Step coordinates of the curve (cumulative abatement vs MAC) for plotting. */
export function buildCurveCsv(projects: MaccPoint[], locale: 'ru' | 'en'): string {
  const header = ['order', 'id', 'name', 'cum_start_kt', 'cum_end_kt', 'mac_usd_per_t'];
  const rows = projects.map((p, i) => [
    i + 1,
    p.id,
    pick(p.name, locale),
    p.cumAbatementStartKt,
    p.cumAbatementEndKt,
    p.mac,
  ]);
  return toCsv([header, ...rows]);
}

/** Serialize a rendered chart <svg> into a standalone, styled SVG document. */
export function serializeChartSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!clone.getAttribute('width')) clone.setAttribute('width', '900');
  if (!clone.getAttribute('height')) clone.setAttribute('height', '460');
  // White background so the exported file isn't transparent.
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

/** Trigger a client-side file download from a string payload. */
export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
