'use client';
// Resolves a comment anchor (target_type, target_id) into a human-readable label
// for the global comments feed, so every comment shows which element it was left
// on. Pure client-side: reads the published dataset + i18n catalogs.
import { useLocale, useTranslations } from 'next-intl';
import { projects, assumptions, sectorLabel, pick, itemAnchorKey } from '@/lib/data';
import type { CommentTarget } from '@/lib/supabase/types';

const KPI_KEYS = ['totalAbatement', 'noRegrets', 'weightedMac', 'projects'];
const DRILL_KEYS = ['sector', 'abatement', 'shareNational', 'mac', 'capex', 'opex', 'duration', 'npv'];

export function useAnchorLabel(): (type: CommentTarget, id: string) => string {
  const locale = useLocale() as 'ru' | 'en';
  const tKpi = useTranslations('kpi');
  const tDrill = useTranslations('drilldown');
  const tCollab = useTranslations('collab');

  const projectName = (pid: string): string => {
    const p = projects.find((x) => String(x.id) === pid);
    return p ? pick(p.name, locale) : `#${pid}`;
  };
  const itemLabel = (pid: string, key: string): string => {
    const p = projects.find((x) => String(x.id) === pid);
    if (!p) return key;
    const all = [
      ...(p.capexItems ?? []),
      ...(p.opexItems ?? []),
      ...(p.physicalItems ?? []),
      ...(p.localInputs ?? []),
    ];
    const it = all.find((x) => itemAnchorKey(x.label) === key);
    return it ? pick(it.label, locale) : key;
  };

  return (type, id) => {
    switch (type) {
      case 'curve':
        return tCollab('anchorCurve');
      case 'scenario':
        return `${tCollab('anchorScenario')}: ${id}`;
      case 'assumption': {
        const a = assumptions.find((x) => x.key === id);
        return `${tCollab('anchorAssumption')}: ${a ? pick(a.label, locale) : id}`;
      }
      case 'project':
        return projectName(id);
      case 'object': {
        const parts = id.split(':');
        if (parts[0] === 'kpi') {
          const k = parts[1];
          return KPI_KEYS.includes(k) ? tKpi(k) : k;
        }
        if (parts[0] === 'project') {
          const pname = projectName(parts[1]);
          if (parts[2] === 'item') return `${pname} · ${itemLabel(parts[1], parts.slice(3).join(':'))}`;
          const field = parts[2];
          return `${pname} · ${DRILL_KEYS.includes(field) ? tDrill(field) : field}`;
        }
        return id;
      }
      default:
        return `${type}:${id}`;
    }
  };
}
