import { Link } from 'wouter';
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
    <div className="container page">
      <p className="eyebrow">404</p>
      <h1 className="page-title">{t('notFound.title')}</h1>
      <p className="prose">{t('notFound.body')}</p>
      <p>
        <Link href={PATHS.home} className="btn">
          {t('notFound.cta')}
        </Link>
      </p>
    </div>
  );
}
