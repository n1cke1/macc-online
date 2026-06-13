'use client';
import { useLocale } from 'next-intl';
import { sectors, sectorLabel } from '@/lib/data';
import { useUi } from '@/store';

export default function SectorLegend() {
  const locale = useLocale() as 'ru' | 'en';
  const { hiddenSectors, toggleSector } = useUi();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
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
    </div>
  );
}
