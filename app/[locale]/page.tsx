import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import VersionBadge from '@/components/VersionBadge';
import LocaleSwitch from '@/components/LocaleSwitch';
import MethodologyBanner from '@/components/macc/MethodologyBanner';
import HowToRead from '@/components/macc/HowToRead';
import KpiStrip from '@/components/macc/KpiStrip';
import SectorLegend from '@/components/macc/SectorLegend';
import MaccChart from '@/components/macc/MaccChart';
import MeasuresTable from '@/components/macc/MeasuresTable';
import ProjectDrilldown from '@/components/drilldown/ProjectDrilldown';
import AssumptionsPanel from '@/components/assumptions/AssumptionsPanel';
import GlobalAssumptionsPanel from '@/components/assumptions/GlobalAssumptionsPanel';
import ExportBar from '@/components/assumptions/ExportBar';
import ScenarioUrlSync from '@/components/assumptions/ScenarioUrlSync';
import CommunityLoader from '@/components/macc/CommunityLoader';
import AuthButtonGate from '@/components/collab/AuthButtonGate';
import AllComments from '@/components/collab/AllComments';
import MeasureDrilldownGate from '@/components/measure/MeasureDrilldownGate';
import McpConnectPanel from '@/components/measure/McpConnectPanel';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('app');

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t('title')}</h1>
          <p className="mt-0.5 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <VersionBadge />
          <AuthButtonGate />
          <LocaleSwitch />
        </div>
      </header>

      <ScenarioUrlSync />
      <CommunityLoader />

      <div className="space-y-4">
        <MethodologyBanner />
        <KpiStrip />
        <AssumptionsPanel />
        <GlobalAssumptionsPanel />
        <HowToRead />
        <McpConnectPanel />

        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectorLegend />
            <ExportBar />
          </div>
          {/* Chart: secondary on mobile (scroll to it); measures table is primary below. */}
          <div className="hidden sm:block">
            <MaccChart />
          </div>
        </section>

        <section>
          <MeasuresTable />
        </section>

        {/* Read-only measure drill-down (formulas + indicators by section; logged-in only,
            renders nothing unless the collab/Supabase layer is configured) */}
        <MeasureDrilldownGate />

        {/* Mobile: chart available below the list */}
        <section className="sm:hidden">
          <MaccChart />
        </section>

        {/* Global comments feed — every comment, tagged with its anchor (collab
            layer; renders nothing when backend off) */}
        <AllComments className="rounded-lg border border-line bg-white p-4" />
      </div>

      <ProjectDrilldown />
    </main>
  );
}
