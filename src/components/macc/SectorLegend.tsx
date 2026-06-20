'use client';
import { useLocale } from 'next-intl';
import { sectors, sectorLabel } from '@/lib/data';
import { useUi, useScenario } from '@/store';

export default function SectorLegend() {
  const locale = useLocale() as 'ru' | 'en';
  const { hiddenSectors, toggleSector, showDisplaced, toggleDisplaced } = useUi();
  const displacedCount = useScenario((s) => s.projects.filter((p) => p.displaced).length);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
      {Object.entries(sectors).map(([code, s]) => {
        const off = hiddenSectors.has(code);
        return (
          <button
            key={code}
            onClick={() => toggleSector(code)}
            className={`flex items-center gap-1.5 transition ${off ? 'opacity-40' : ''}`}
            title={sectorLabel(code, locale)}
          >
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: s.color }}
            />
            <span className="max-w-[180px] truncate">{sectorLabel(code, locale)}</span>
          </button>
        );
      })}
      {displacedCount > 0 && (
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-muted" title={locale === 'en'
          ? 'Measures whose pool share is crowded out by cheaper peers at current capacity'
          : 'Меры, чья доля в пуле вытеснена более дешёвыми при текущей ёмкости'}>
          <input type="checkbox" checked={showDisplaced} onChange={toggleDisplaced} className="h-3 w-3" />
          {locale === 'en' ? `Show ${displacedCount} displaced` : `Показать вытеснённые (${displacedCount})`}
        </label>
      )}
    </div>
  );
}
