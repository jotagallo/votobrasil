import { Link } from 'wouter';
import { setConsent, type Consent } from '../analytics';
import { useT } from '../i18n';
import { PATHS } from '../lib/routes';

interface Props {
  onClose: () => void;
}

/** Aviso de privacidade (LGPD): as estatísticas de uso só são ativadas após o aceite. */
export function ConsentBanner({ onClose }: Props) {
  const { t } = useT();
  const choose = (consent: Consent) => {
    setConsent(consent);
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
          <button type="button" className="btn btn--ghost" onClick={() => choose('denied')}>
            {t('consent.reject')}
          </button>
          <button type="button" className="btn" onClick={() => choose('granted')}>
            {t('consent.accept')}
          </button>
        </div>
      </div>
    </section>
  );
}
