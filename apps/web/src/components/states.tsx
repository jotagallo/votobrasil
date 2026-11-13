import { useT } from '../i18n';

export function Skeleton({ height = 160, label }: { height?: number; label?: string }) {
  const { t } = useT();
  return (
    <div
      className="skeleton"
      role="status"
      aria-live="polite"
      aria-label={label ?? t('common.loading')}
      style={{ minHeight: height }}
    />
  );
}

export function ErrorState({ onRetry, detail }: { onRetry?: () => void; detail?: string }) {
  const { t } = useT();
  return (
    <div className="state state--error" role="alert">
      <h3 className="state__title">{t('errors.title')}</h3>
      <p>{t('errors.body')}</p>
      {detail ? <p className="state__detail">{detail}</p> : null}
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="state">
      <h3 className="state__title">{title}</h3>
      {body ? <p>{body}</p> : null}
    </div>
  );
}
