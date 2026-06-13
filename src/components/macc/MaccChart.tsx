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
import { useUi, useScenario } from '@/store';
import { useLocale, useTranslations } from 'next-intl';

const MARGIN = { top: 16, right: 16, bottom: 48, left: 56 };

interface Bar {
  p: MaccPoint;
  startMt: number;
  endMt: number;
}

function ChartInner({ width, height }: { width: number; height: number }) {
  const locale = useLocale() as 'ru' | 'en';
  const t = useTranslations('chart');
  const { selectedId, select, hiddenSectors } = useUi();
  const projects = useScenario((s) => s.projects);
  const tip = useTooltip<MaccPoint>();

  const bars = useMemo<Bar[]>(() => {
    let cum = 0;
    const out: Bar[] = [];
    for (const p of projects) {
      if (hiddenSectors.has(p.sector)) continue;
      const startMt = ktToMt(cum);
      cum += p.abatementKt;
      out.push({ p, startMt, endMt: ktToMt(cum) });
    }
    return out;
  }, [projects, hiddenSectors]);

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
            const selected = selectedId === b.p.id;
            const dim = selectedId != null && !selected;
            return (
              <rect
                key={b.p.id}
                x={bx}
                y={top}
                width={bw}
                height={Math.max(0.5, bh)}
                fill={sectorColor(b.p.sector)}
                opacity={dim ? 0.35 : 0.9}
                stroke={selected ? '#0f172a' : '#ffffff'}
                strokeWidth={selected ? 1.5 : 0.5}
                cursor="pointer"
                onClick={() => select(selected ? null : b.p.id)}
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
