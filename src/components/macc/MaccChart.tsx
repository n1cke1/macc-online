'use client';
import { useMemo } from 'react';
import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { ParentSize } from '@visx/responsive';
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip';
import { localPoint } from '@visx/event';
import type { MaccPoint } from '@/lib/data';
import { sectorColor, sectorLabel, pick } from '@/lib/data';
import { ktToMt, fmtMac, fmtMt, fmtInt } from '@/lib/format';
import { useUi, useScenario, useDraftOverlay } from '@/store';
import { authoringEnabled } from '@/lib/config';
import { useLocale, useTranslations } from 'next-intl';

const MARGIN = { top: 16, right: 16, bottom: 48, left: 56 };

/** Sentinel id for the authoring draft bar (never collides with real measure ids). */
const DRAFT_ID = -999;

interface Bar {
  p: MaccPoint;
  startMt: number;
  endMt: number;
}

function ChartInner({ width, height }: { width: number; height: number }) {
  const locale = useLocale() as 'ru' | 'en';
  const t = useTranslations('chart');
  const { selectedId, select, hiddenSectors, showDisplaced } = useUi();
  const projects = useScenario((s) => s.projects);
  // Lightweight overlay bridge — null unless the authoring layer pushed a draft AND
  // the editor is expanded (a collapsed editor leaves the curve untouched).
  const draftBar = useDraftOverlay((s) => s.bar);
  const editorOpen = useDraftOverlay((s) => s.editorOpen);
  const draft = editorOpen ? draftBar : null;
  const tip = useTooltip<MaccPoint>();

  const bars = useMemo<Bar[]>(() => {
    // Build the point list; when an authoring draft is active, drop the measure it
    // edits (so it isn't double-plotted), splice the draft in, and re-sort by MAC
    // so it lands in its true merit-order position.
    // Displaced measures (pool share clipped by cheaper peers) are kept off the curve
    // unless the user opts in — they aren't part of the trusted merit order at capacity.
    let points: MaccPoint[] = showDisplaced ? projects : projects.filter((p) => !p.displaced);
    const overlay = authoringEnabled && draft;
    if (overlay) {
      const synthetic = {
        ...(projects[0] ?? ({} as MaccPoint)),
        id: DRAFT_ID,
        sector: draft.sector as MaccPoint['sector'],
        name: draft.name,
        mac: draft.mac,
        abatementKt: draft.abatementKt,
      } as MaccPoint;
      points = [...projects.filter((p) => p.id !== draft.linkedId), synthetic].sort((a, b) => a.mac - b.mac);
    }
    let cum = 0;
    const out: Bar[] = [];
    for (const p of points) {
      if (hiddenSectors.has(p.sector)) continue;
      const startMt = ktToMt(cum);
      cum += p.abatementKt;
      out.push({ p, startMt, endMt: ktToMt(cum) });
    }
    return out;
  }, [projects, hiddenSectors, draft, showDisplaced]);

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const maxMt = bars.length ? bars[bars.length - 1].endMt : 1;
  const macs = bars.map((b) => b.p.mac);
  const minMac = Math.min(0, ...macs);
  const maxMac = Math.max(0, ...macs);
  const pad = (maxMac - minMac) * 0.05 || 10;

  const x = scaleLinear({ domain: [0, maxMt], range: [0, innerW] });
  const y = scaleLinear({ domain: [minMac - pad, maxMac + pad], range: [innerH, 0] });
  const zeroY = y(0);

  if (!bars.length) {
    return <div className="grid h-full place-items-center text-muted">{t('empty')}</div>;
  }

  return (
    <div className="relative">
      <svg width={width} height={height} data-macc-chart="">
        <rect width={width} height={height} fill="#ffffff" />
        <Group left={MARGIN.left} top={MARGIN.top}>
          {/* gridline at zero (prominent) */}
          <line x1={0} x2={innerW} y1={zeroY} y2={zeroY} stroke="#0f172a" strokeWidth={1.5} />
          {bars.map((b) => {
            const bx = x(b.startMt);
            const bw = Math.max(0.5, x(b.endMt) - x(b.startMt));
            const top = b.p.mac >= 0 ? y(b.p.mac) : zeroY;
            const bh = Math.abs(zeroY - y(b.p.mac));
            const isDraft = b.p.id === DRAFT_ID;
            const selected = selectedId === b.p.id;
            const dim = selectedId != null && !selected && !isDraft;
            return (
              <rect
                key={b.p.id}
                x={bx}
                y={top}
                width={bw}
                height={Math.max(0.5, bh)}
                fill={sectorColor(b.p.sector)}
                opacity={isDraft ? 0.55 : dim ? 0.35 : 0.9}
                stroke={isDraft ? (draft?.warn ? '#d97706' : '#0f172a') : selected ? '#0f172a' : '#ffffff'}
                strokeWidth={isDraft ? 2 : selected ? 1.5 : 0.5}
                strokeDasharray={isDraft ? '4 2' : undefined}
                cursor={isDraft ? 'default' : 'pointer'}
                onClick={() => { if (!isDraft) select(selected ? null : b.p.id); }}
                onMouseMove={(e) => {
                  const pt = localPoint(e) ?? { x: bx, y: top };
                  tip.showTooltip({ tooltipData: b.p, tooltipLeft: pt.x, tooltipTop: pt.y });
                }}
                onMouseLeave={() => tip.hideTooltip()}
              />
            );
          })}
          <AxisBottom
            top={innerH}
            scale={x}
            numTicks={6}
            stroke="#94a3b8"
            tickStroke="#94a3b8"
            tickLabelProps={() => ({ fill: '#64748b', fontSize: 11, textAnchor: 'middle' })}
            label={t('xAxis')}
            labelProps={{ fill: '#475569', fontSize: 12, textAnchor: 'middle' }}
          />
          <AxisLeft
            scale={y}
            numTicks={6}
            stroke="#94a3b8"
            tickStroke="#94a3b8"
            tickLabelProps={() => ({ fill: '#64748b', fontSize: 11, textAnchor: 'end', dx: -4, dy: 3 })}
            label={t('yAxis')}
            labelProps={{ fill: '#475569', fontSize: 12, textAnchor: 'middle' }}
          />
        </Group>
      </svg>

      {tip.tooltipOpen && tip.tooltipData && (
        <TooltipWithBounds
          top={tip.tooltipTop}
          left={tip.tooltipLeft}
          style={{ ...defaultStyles, maxWidth: 280, fontSize: 12, lineHeight: 1.4 }}
        >
          <strong>{pick(tip.tooltipData.name, locale)}</strong>
          <div className="mt-1 text-muted">{sectorLabel(tip.tooltipData.sector, locale)}</div>
          <div className="mt-1">
            MAC: <b style={{ color: tip.tooltipData.mac < 0 ? '#16a34a' : '#0f172a' }}>
              {fmtMac(tip.tooltipData.mac, locale)} {locale === 'en' ? 'USD/t' : 'USD/т'}
            </b>
          </div>
          <div>
            {locale === 'en' ? 'Abatement' : 'Снижение'}: {fmtMt(tip.tooltipData.abatementKt, locale)} Mt/
            {locale === 'en' ? 'yr' : 'год'} ({fmtInt(tip.tooltipData.abatementKt, locale)} kt)
          </div>
        </TooltipWithBounds>
      )}
    </div>
  );
}

export default function MaccChart() {
  return (
    <div className="h-[460px] w-full rounded-lg border border-line bg-white p-2">
      <ParentSize>{({ width, height }) => <ChartInner width={width} height={height} />}</ParentSize>
    </div>
  );
}
