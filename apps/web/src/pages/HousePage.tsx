import { Link, useParams } from 'wouter';
import type { OfficeId } from '@votobr/shared';
import { AreaList } from '../components/AreaList';
import { ChamberExplorer } from '../components/ChamberExplorer';
import { UfPicker } from '../components/UfPicker';
import { Paragraphs } from '../components/Rich';
import { ErrorState, Skeleton } from '../components/states';
import { useSystemControls } from '../hooks';
import { usePageMeta } from '../hooks';
import { useT } from '../i18n';
import { PATHS, housePath, isOffice } from '../lib/routes';
import { useMeta } from '../meta';
import NotFoundPage from './NotFoundPage';

export default function HousePage() {
  const params = useParams<{ office: string }>();
  if (!isOffice(params.office)) return <NotFoundPage />;
  return <HouseView office={params.office} />;
}

function HouseView({ office }: { office: OfficeId }) {
  const { t, tl } = useT();
  const meta = useMeta();
  const controls = useSystemControls(office);
  usePageMeta({
    title: t(`meta.house.${office}.title`),
    description: t(`meta.house.${office}.description`),
    path: housePath(office),
  });

  return (
    <div className="container page">
      <nav className="breadcrumb" aria-label={t('common.breadcrumb')}>
        <Link href={PATHS.home}>{t('nav.home')}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{t(`houses.${office}.short`)}</span>
      </nav>
      <h1 className="page-title">{t(`houses.${office}.name`)}</h1>
      <div className="prose">
        <Paragraphs items={tl(`house.${office}.intro`)} />
      </div>

      {office === 'federal' ? <ChamberExplorer office={office} showAreas /> : null}
      {office === 'state' ? (
        <>
          {meta.status === 'error' ? <ErrorState onRetry={meta.reload} /> : null}
          {meta.status === 'loading' ? <Skeleton height={320} /> : null}
          {meta.status === 'success' ? (
            <UfPicker
              office={office}
              areas={meta.data.offices.state.areas}
              query={controls.query}
            />
          ) : null}
        </>
      ) : null}
      {office === 'municipal' ? (
        <section className="explorer__areas" aria-labelledby="areas-title">
          <h2 id="areas-title" className="section-title">
            {t(`house.${office}.areasTitle`)}
          </h2>
          {meta.status === 'error' ? <ErrorState onRetry={meta.reload} /> : null}
          {meta.status === 'loading' ? <Skeleton height={240} /> : null}
          {meta.status === 'success' ? (
            <AreaList
              office={office}
              areas={meta.data.offices[office].areas}
              query={controls.query}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
