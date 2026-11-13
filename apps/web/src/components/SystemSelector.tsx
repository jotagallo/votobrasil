import { useId } from 'react';
import { Link } from 'wouter';
import type { SystemId } from '@votobr/shared';
import { useT } from '../i18n';
import { PATHS } from '../lib/routes';
import { Rich } from './Rich';

interface Props {
  systems: readonly SystemId[];
  system: SystemId;
  onSystem: (system: SystemId) => void;
}

export function SystemSelector({ systems, system, onSystem }: Props) {
  const { t } = useT();
  const name = useId();
  return (
    <section className="selector" aria-labelledby={`${name}-legend`}>
      <fieldset className="selector__fieldset">
        <legend id={`${name}-legend`} className="eyebrow">
          {t('selector.legend')}
        </legend>
        <div className="chips" role="radiogroup" aria-labelledby={`${name}-legend`}>
          {systems.map((id) => (
            <label key={id} className={id === system ? 'chip is-selected' : 'chip'}>
              <input
                type="radio"
                name={name}
                value={id}
                checked={id === system}
                onChange={() => onSystem(id)}
              />
              <span>{t(`systems.${id}.short`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="selector__detail" aria-live="polite">
        <p className="selector__summary">
          <strong>{t(`systems.${system}.name`)}.</strong>{' '}
          <Rich text={t(`systems.${system}.summary`)} />{' '}
          <Link href={`${PATHS.systems}#${system}`}>{t('selector.learnMore')}</Link>
        </p>
      </div>
    </section>
  );
}
