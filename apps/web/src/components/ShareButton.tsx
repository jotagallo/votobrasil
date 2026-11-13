import { useEffect, useRef, useState } from 'react';
import { useSearch } from 'wouter';
import { trackEvent } from '../analytics';
import { useT } from '../i18n';
import { shareLink } from '../lib/share';

type Status = 'idle' | 'copied' | 'shared' | 'failed';

export function ShareButton({ title, text }: { title: string; text: string }) {
  const { t } = useT();
  const search = useSearch();
  const [status, setStatus] = useState<Status>('idle');
  const timer = useRef<number>(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => setStatus('idle'), [search]);

  async function onClick() {
    const outcome = await shareLink({ title, text, url: window.location.href });
    if (outcome === 'cancelled') return;
    trackEvent('share_click', { method: outcome === 'shared' ? 'native' : 'copy' });
    setStatus(outcome === 'failed' ? 'failed' : outcome);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus('idle'), 4000);
  }

  return (
    <div className="share">
      <button type="button" className="btn btn--ghost" onClick={onClick}>
        {t('common.share')}
      </button>
      <span className="share__status" role="status" aria-live="polite">
        {status === 'copied' ? t('common.shareCopied') : null}
        {status === 'shared' ? t('common.shareDone') : null}
        {status === 'failed' ? t('common.shareFailed') : null}
      </span>
    </div>
  );
}
