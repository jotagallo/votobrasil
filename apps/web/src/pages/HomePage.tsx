import { Link } from 'wouter';
import { SYSTEMS } from '@votobr/shared';
import { ChamberExplorer } from '../components/ChamberExplorer';
import { HeroArc } from '../components/HeroArc';
import { Paragraphs, Rich } from '../components/Rich';
import { usePageMeta } from '../hooks';
import { useT } from '../i18n';
import { PATHS, housePath } from '../lib/routes';
import { useMeta } from '../meta';

const EXPLORER_ID = 'simulador';
const CHANGES = ['vote', 'chamber', 'government'] as const;

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="bullets">
      {items.map((item) => (
        <li key={item}>
          <Rich text={item} />
        </li>
      ))}
    </ul>
  );
}

function useHeadlineNumbers() {
  const meta = useMeta();
  const { f } = useT();
  const offices = meta.status === 'success' ? meta.data.offices : null;
  const show = (value: number | undefined) => (value === undefined ? '—' : f.int(value));
  return [
    { key: 'seats', value: show(offices?.federal.seats) },
    { key: 'states', value: show(offices?.federal.areas.length) },
    { key: 'cities', value: show(offices?.municipal.areas.length) },
    { key: 'systems', value: f.int(SYSTEMS.length) },
  ];
}

export default function HomePage() {
  const { t, tl } = useT();
  const numbers = useHeadlineNumbers();
  usePageMeta({
    title: t('meta.home.title'),
    description: t('meta.home.description'),
    path: PATHS.home,
  });

  const links: Array<{ href: string; key: string }> = [
    { href: housePath('state'), key: 'state' },
    { href: housePath('municipal'), key: 'municipal' },
    { href: PATHS.systems, key: 'systems' },
    { href: PATHS.methodology, key: 'methodology' },
    { href: PATHS.semipresidentialism, key: 'semi' },
  ];

  return (
    <>
      <section className="pec-intro" id="pec" aria-labelledby="pec-title">
        <div className="container pec-intro__inner">
          <p className="eyebrow eyebrow--pill">{t('home.intro.eyebrow')}</p>
          <h1 id="pec-title" className="pec-intro__title">
            {t('home.intro.title')}
          </h1>
          <p className="pec-intro__lede">{t('home.intro.lede')}</p>

          <h2 className="sr-only">{t('home.intro.changesTitle')}</h2>
          <ul className="change-cards">
            {CHANGES.map((key) => (
              <li key={key} className={`change-card change-card--${key}`}>
                <h3 className="change-card__title">{t(`home.intro.changes.${key}.title`)}</h3>
                <p className="change-card__text">{t(`home.intro.changes.${key}.text`)}</p>
              </li>
            ))}
          </ul>

          <div className="pec-intro__columns">
            <aside className="pec-alert" aria-labelledby="pec-alert-title">
              <h2 id="pec-alert-title" className="pec-alert__title">
                {t('home.intro.alert.title')}
              </h2>
              <Paragraphs items={tl('home.intro.alert.body')} />
            </aside>
            <div className="pec-act">
              <h2 className="pec-act__title">{t('home.intro.act.title')}</h2>
              <BulletList items={tl('home.intro.act.items')} />
            </div>
          </div>

          <div className="hero__actions pec-intro__actions">
            <a href={`#${EXPLORER_ID}`} className="btn btn--lg">
              {t('home.intro.cta.simulate')}
            </a>
            <Link href={`${PATHS.systems}#distrital-misto`} className="btn btn--lg btn--ghost">
              {t('home.intro.cta.mixed')}
            </Link>
          </div>
          <p className="pec-intro__neutral">{t('home.intro.neutral')}</p>
        </div>
      </section>

      <section className="hero hero--plain" aria-labelledby="hero-title">
        <div className="container hero__grid">
          <div className="hero__copy">
            <p className="eyebrow eyebrow--pill">{t('home.eyebrow')}</p>
            <h2 id="hero-title" className="hero__title">
              {t('home.title')}
            </h2>
            <p className="hero__lede">{t('home.lede')}</p>
            <div className="hero__actions">
              <a href={`#${EXPLORER_ID}`} className="btn btn--lg">
                {t('home.cta.explore')}
              </a>
              <Link href={PATHS.systems} className="btn btn--lg btn--ghost">
                {t('home.cta.systems')}
              </Link>
            </div>
            <ul className="trust-list" aria-label={t('home.trust.label')}>
              <li>{t('home.trust.data')}</li>
              <li>{t('home.trust.open')}</li>
              <li>{t('home.trust.privacy')}</li>
            </ul>
            <p className="hero__disclaimer">{t('home.disclaimer')}</p>
          </div>
          <figure className="hero__visual">
            <HeroArc />
            <figcaption className="hero__caption">{t('home.hero.caption')}</figcaption>
          </figure>
        </div>
      </section>

      <section className="stat-band" aria-label={t('home.stats.label')}>
        <ul className="container stat-band__grid">
          {numbers.map((item) => (
            <li key={item.key} className="big-number">
              <span className="big-number__value">{item.value}</span>
              <span className="big-number__label">{t(`home.stats.${item.key}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="section" aria-labelledby="how-title">
        <div className="container">
          <div className="section__head">
            <p className="eyebrow">{t('home.how.eyebrow')}</p>
            <h2 id="how-title" className="section-title">
              {t('home.how.title')}
            </h2>
            <p className="section-lede">{t('home.how.lede')}</p>
          </div>
          <ol className="steps">
            {[1, 2, 3].map((n) => (
              <li key={n} className="step">
                <span className="step__number" aria-hidden="true">
                  {n}
                </span>
                <h3 className="step__title">{t(`home.how.step${n}.title`)}</h3>
                <p className="step__text">{t(`home.how.step${n}.text`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id={EXPLORER_ID} className="section section--soft" aria-labelledby="explorer-title">
        <div className="container">
          <div className="section__head">
            <p className="eyebrow">{t('home.explorer.eyebrow')}</p>
            <h2 id="explorer-title" className="section-title">
              {t('explorer.federal.title')}
            </h2>
            <p className="section-lede">{t('explorer.federal.lede')}</p>
          </div>
          <ChamberExplorer office="federal" />
        </div>
      </section>

      <section className="section" id="debate" aria-labelledby="debate-title">
        <div className="container">
          <div className="section__head">
            <p className="eyebrow">{t('home.debate.eyebrow')}</p>
            <h2 id="debate-title" className="section-title">
              {t('home.debate.title')}
            </h2>
            <p className="section-lede">{t('home.debate.lede')}</p>
          </div>
          <div className="pros-cons">
            <div>
              <h3 className="subhead">{t('home.debate.prosTitle')}</h3>
              <BulletList items={tl('home.debate.pros')} />
            </div>
            <div>
              <h3 className="subhead">{t('home.debate.consTitle')}</h3>
              <BulletList items={tl('home.debate.cons')} />
            </div>
          </div>
          <div className="prose debate__opinion">
            <h3 className="subhead">{t('home.debate.opinionTitle')}</h3>
            <Paragraphs items={tl('home.debate.opinion')} />
            <div className="hero__actions">
              <Link href={PATHS.systems} className="btn btn--ghost">
                {t('home.debate.systems')}
              </Link>
              <Link href={PATHS.semipresidentialism} className="btn btn--ghost">
                {t('home.debate.semi')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="reading-title">
        <div className="container">
          <div className="section__head">
            <p className="eyebrow">{t('home.reading.eyebrow')}</p>
            <h2 id="reading-title" className="section-title">
              {t('home.reading.title')}
            </h2>
          </div>
          <div className="prose">
            <Paragraphs items={tl('home.reading.body')} />
          </div>
        </div>
      </section>

      <section className="section section--flush" aria-labelledby="more-title">
        <div className="container">
          <div className="section__head">
            <h2 id="more-title" className="section-title">
              {t('home.more.title')}
            </h2>
          </div>
          <ul className="link-list">
            {links.map((link) => (
              <li key={link.key}>
                <Link href={link.href} className="link-list__item">
                  <span className="link-list__title">{t(`home.more.${link.key}.title`)}</span>
                  <span className="link-list__text">{t(`home.more.${link.key}.text`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
