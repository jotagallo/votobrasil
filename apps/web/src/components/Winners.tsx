import { useMemo, useState } from 'react';
import type { Winner } from '@votobr/shared';
import { useT } from '../i18n';
import { diffWinners } from '../lib/districts';
import { OTHERS_COLOR } from '../lib/parties';

const PREVIEW = 10;

function WinnerList({
  title,
  hint,
  winners,
  colors,
  tone,
}: {
  title: string;
  hint: string;
  winners: Winner[];
  colors: Record<string, string>;
  tone: 'gain' | 'loss';
}) {
  const { t, f } = useT();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? winners : winners.slice(0, PREVIEW);
  return (
    <section className={`winners winners--${tone}`}>
      <h4 className="winners__title">
        {title} <span className="winners__count">{f.int(winners.length)}</span>
      </h4>
      <p className="winners__hint">{hint}</p>
      {winners.length === 0 ? (
        <p className="muted">{t('winners.none')}</p>
      ) : (
        <ol className="winners__list">
          {visible.map((w, i) => (
            <li key={`${w.name}-${w.party}-${i}`} className="winners__item">
              <i
                className="swatch"
                style={{ background: colors[w.party] ?? OTHERS_COLOR }}
                aria-hidden="true"
              />
              <span className="winners__name">{w.name}</span>
              <span className="winners__party">{w.party}</span>
              <span className="winners__votes num">
                {t('winners.votes', { count: f.int(w.votes) })}
              </span>
              <span className="winners__tier">{t(`winners.tier.${w.tier}`)}</span>
            </li>
          ))}
        </ol>
      )}
      {winners.length > PREVIEW ? (
        <button
          type="button"
          className="link-button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded
            ? t('winners.showLess')
            : t('winners.showAll', { count: f.int(winners.length) })}
        </button>
      ) : null}
    </section>
  );
}

export function WinnersLosers({
  baseline,
  scenario,
  colors,
}: {
  baseline: Winner[];
  scenario: Winner[];
  colors: Record<string, string>;
}) {
  const { t, f } = useT();
  const diff = useMemo(() => diffWinners(baseline, scenario), [baseline, scenario]);
  return (
    <div className="winners-block">
      <h3 className="subhead">{t('winners.title')}</h3>
      <p className="winners-block__summary">
        {t('winners.summary', {
          kept: f.int(diff.kept),
          gained: f.int(diff.gained.length),
          lost: f.int(diff.lost.length),
        })}
      </p>
      <div className="winners-grid">
        <WinnerList
          title={t('winners.gainedTitle')}
          hint={t('winners.gainedHint')}
          winners={diff.gained}
          colors={colors}
          tone="gain"
        />
        <WinnerList
          title={t('winners.lostTitle')}
          hint={t('winners.lostHint')}
          winners={diff.lost}
          colors={colors}
          tone="loss"
        />
      </div>
    </div>
  );
}
