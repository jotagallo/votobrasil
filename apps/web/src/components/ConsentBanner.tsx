import { Link } from 'wouter';
import { acknowledgeCookies } from '../analytics';
import { useT } from '../i18n';
import { PATHS } from '../lib/routes';

interface Props {
  onClose: () => void;
}

/** Aviso de cookies (LGPD): as estatísticas de uso só começam depois do "Entendi". */
export function ConsentBanner({ onClose }: Props) {
  const { t } = useT();
  const acknowledge = () => {
    acknowledgeCookies();
    onClose();
  };
  return (
    <section className="consent" role="region" aria-label={t('consent.label')}>
      <div className="container consent__row">
        <p className="consent__text">
          {t('consent.text')}{' '}
          <Link href={`${PATHS.about}#privacy`} onClick={onClose}>
            {t('consent.more')}
          </Link>
        </p>
        <div className="consent__actions">
          <button type="button" className="btn" onClick={acknowledge}>
            {t('consent.accept')}
          </button>
        </div>
      </div>
    </section>
  );
}
