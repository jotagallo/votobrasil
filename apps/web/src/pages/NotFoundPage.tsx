import { Link } from 'wouter';
import { PageHero } from '../components/PageHero';
import { usePageMeta } from '../hooks';
import { useLocation } from 'wouter';
import { useT } from '../i18n';
import { PATHS } from '../lib/routes';

export default function NotFoundPage() {
  const { t } = useT();
  const [path] = useLocation();
  usePageMeta({
    title: t('meta.notFound.title'),
    description: t('meta.notFound.description'),
    path,
    noindex: true,
  });
  return (
    <PageHero eyebrow="404" title={t('notFound.title')} lede={t('notFound.body')}>
      <div className="page-hero__actions">
        <Link href={PATHS.home} className="btn btn--lg btn--yellow">
          {t('notFound.cta')}
        </Link>
      </div>
    </PageHero>
  );
}
