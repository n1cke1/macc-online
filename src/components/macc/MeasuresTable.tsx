'use client';
import { useLocale, useTranslations } from 'next-intl';
import { sectorColor, sectorLabel, pick } from '@/lib/data';
import { fmtMac, fmtInt } from '@/lib/format';
import { useUi, useScenario } from '@/store';

export default function MeasuresTable() {
  const locale = useLocale() as 'ru' | 'en';
  const t = useTranslations('table');
  const { selectedId, select, hiddenSectors } = useUi();
  const projects = useScenario((s) => s.projects);

  const visible = projects.filter((p) => !hiddenSectors.has(p.sector));

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">{t('colName')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('colMac')}</th>
            <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">{t('colAbatement')}</th>
            <th className="hidden px-3 py-2 text-right font-medium md:table-cell">{t('colCapex')}</th>
            <th className="hidden px-3 py-2 text-right font-medium md:table-cell">{t('colDuration')}</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-muted">
                {locale === 'en' ? 'All sectors hidden' : 'Все секторы скрыты'}
              </td>
            </tr>
          )}
          {visible.map((p) => {
            const sel = selectedId === p.id;
            return (
              <tr
                key={p.id}
                onClick={() => select(sel ? null : p.id)}
                className={`cursor-pointer border-t border-line transition hover:bg-slate-50 ${
                  sel ? 'bg-sky-50' : ''
                }`}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded-sm"
                      style={{ background: sectorColor(p.sector) }}
                      title={sectorLabel(p.sector, locale)}
                    />
                    <span>{pick(p.name, locale)}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className={p.mac < 0 ? 'font-medium text-green-600' : ''}>
                    {fmtMac(p.mac, locale)}
                  </span>
                  {p.mac < 0 && (
                    <span className="ml-1 rounded bg-green-100 px-1 text-[10px] text-green-700">
                      {t('noRegretsBadge')}
                    </span>
                  )}
                </td>
                <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                  {fmtInt(p.abatementKt, locale)}
                </td>
                <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">
                  {fmtInt(p.capex, locale)}
                </td>
                <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">{p.durationYrs}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
