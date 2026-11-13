import { useEffect, useMemo } from 'react';
import { SYSTEMS } from '@votobr/shared';
import { Paragraphs, Rich } from '../components/Rich';
import { usePageMeta } from '../hooks';
import { useT } from '../i18n';
import { mixedExample, proportionalExample } from '../lib/examples';
import { PATHS } from '../lib/routes';

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="bullets">
      {items.map((item, i) => (
        <li key={i}>
          <Rich text={item} />
        </li>
      ))}
    </ul>
  );
}

function ProportionalExampleTable() {
  const { t, f } = useT();
  const ex = useMemo(() => proportionalExample(), []);
  const extra = ex.final.map((n, i) => n - (ex.direct[i] ?? 0));
  return (
    <>
      <p>
        <Rich
          text={t('systems.examples.proportional.intro', {
            seats: f.int(ex.seats),
            total: f.int(ex.totalVotes),
            quotient: f.int(ex.quotient),
            leftover: f.int(ex.leftover),
          })}
        />
      </p>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label={t('systems.examples.proportional.title')}
      >
        <table className="data-table">
          <caption className="sr-only">{t('systems.examples.proportional.title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('systems.examples.party')}</th>
              <th scope="col" className="num">
                {t('systems.examples.votes')}
              </th>
              <th scope="col" className="num">
                {t('systems.examples.votesOverQuotient')}
              </th>
              <th scope="col" className="num">
                {t('systems.examples.direct')}
              </th>
              <th scope="col" className="num">
                {t('systems.examples.leftoverSeats')}
              </th>
              <th scope="col" className="num">
                {t('systems.examples.total')}
              </th>
            </tr>
          </thead>
          <tbody>
            {ex.parties.map((party, i) => (
              <tr key={party}>
                <th scope="row">{party}</th>
                <td className="num">{f.int(ex.votes[i] ?? 0)}</td>
                <td className="num">{f.dec((ex.votes[i] ?? 0) / ex.quotient, 2)}</td>
                <td className="num">{f.int(ex.direct[i] ?? 0)}</td>
                <td className="num">{f.int(extra[i] ?? 0)}</td>
                <td className="num num--strong">{f.int(ex.final[i] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        <Rich text={t('systems.examples.proportional.note')} />
      </p>
    </>
  );
}

function MixedExampleTable() {
  const { t, f } = useT();
  const ex = useMemo(() => mixedExample(), []);
  const over = useMemo(() => mixedExample([5, 0, 0]), []);
  return (
    <>
      <p>
        <Rich
          text={t('systems.examples.mixed.intro', {
            seats: f.int(ex.seats),
            district: f.int(ex.districtSeats),
            list: f.int(ex.seats - ex.districtSeats),
          })}
        />
      </p>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label={t('systems.examples.mixed.title')}
      >
        <table className="data-table">
          <caption className="sr-only">{t('systems.examples.mixed.title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('systems.examples.party')}</th>
              <th scope="col" className="num">
                {t('systems.examples.districtWins')}
              </th>
              <th scope="col" className="num">
                {t('systems.examples.listVotes')}
              </th>
              <th scope="col" className="num">
                {t('systems.examples.entitled')}
              </th>
              <th scope="col" className="num">
                {t('systems.examples.fromList')}
              </th>
              <th scope="col" className="num">
                {t('systems.examples.total')}
              </th>
            </tr>
          </thead>
          <tbody>
            {ex.parties.map((party, i) => (
              <tr key={party}>
                <th scope="row">{party}</th>
                <td className="num">{f.int(ex.districtWins[i] ?? 0)}</td>
                <td className="num">{f.int(ex.listVotes[i] ?? 0)}%</td>
                <td className="num">{f.int(ex.entitled[i] ?? 0)}</td>
                <td className="num">{f.int(ex.fromList[i] ?? 0)}</td>
                <td className="num num--strong">{f.int(ex.final[i] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        <Rich text={t('systems.examples.mixed.note')} />
      </p>
      <p className="muted">
        <Rich
          text={t('systems.examples.mixed.overhang', {
            party: over.parties[0] ?? '',
            wins: f.int(over.districtWins[0] ?? 0),
            entitled: f.int(over.entitled[0] ?? 0),
            total: f.int(over.seats + over.overhang),
          })}
        />
      </p>
    </>
  );
}

export default function SystemsPage() {
  const { t, tl } = useT();
  usePageMeta({
    title: t('meta.systems.title'),
    description: t('meta.systems.description'),
    path: PATHS.systems,
  });

  // Âncoras (`/sistemas#distritao`): a página é carregada sob demanda, então o salto é feito aqui.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="container page">
      <p className="eyebrow">{t('nav.systems')}</p>
      <h1 className="page-title">{t('systems.title')}</h1>
      <p className="section-lede">{t('systems.lede')}</p>
      <div className="prose">
        <Paragraphs items={tl('systems.intro')} />
      </div>

      <section className="prose-section" aria-labelledby="compare-title">
        <h2 id="compare-title" className="section-title">
          {t('systems.compare.title')}
        </h2>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label={t('systems.compare.title')}
        >
          <table className="data-table">
            <caption className="sr-only">{t('systems.compare.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('systems.compare.system')}</th>
                <th scope="col">{t('systems.compare.districts')}</th>
                <th scope="col">{t('systems.compare.lists')}</th>
                <th scope="col">{t('systems.compare.proportionality')}</th>
              </tr>
            </thead>
            <tbody>
              {SYSTEMS.map((system) => (
                <tr key={system.id}>
                  <th scope="row">
                    <a href={`#${system.id}`}>{t(`systems.${system.id}.name`)}</a>
                  </th>
                  <td>{system.usesDistricts ? t('common.yes') : t('common.no')}</td>
                  <td>{system.usesLists ? t('common.yes') : t('common.no')}</td>
                  <td>{t(`systems.${system.id}.proportionality`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {SYSTEMS.map((system) => (
        <article
          key={system.id}
          id={system.id}
          className="prose-section system-article"
          aria-labelledby={`${system.id}-title`}
        >
          <h2 id={`${system.id}-title`} className="section-title">
            {t(`systems.${system.id}.name`)}
          </h2>
          <div className="prose">
            <h3 className="subhead">{t('systems.how')}</h3>
            <Paragraphs items={tl(`systems.${system.id}.how`)} />
            <div className="pros-cons">
              <div>
                <h3 className="subhead">{t('systems.pros')}</h3>
                <BulletList items={tl(`systems.${system.id}.pros`)} />
              </div>
              <div>
                <h3 className="subhead">{t('systems.cons')}</h3>
                <BulletList items={tl(`systems.${system.id}.cons`)} />
              </div>
            </div>
            <h3 className="subhead">{t('systems.inSimulation')}</h3>
            <Paragraphs items={tl(`systems.${system.id}.sim`)} />
          </div>
        </article>
      ))}

      <section className="prose-section" aria-labelledby="examples-title">
        <h2 id="examples-title" className="section-title">
          {t('systems.examples.title')}
        </h2>
        <div className="prose">
          <p>{t('systems.examples.lede')}</p>
          <h3 className="subhead">{t('systems.examples.proportional.title')}</h3>
          <ProportionalExampleTable />
          <h3 className="subhead">{t('systems.examples.mixed.title')}</h3>
          <MixedExampleTable />
        </div>
      </section>

      <section className="prose-section" id="pec" aria-labelledby="pec-title">
        <h2 id="pec-title" className="section-title">
          {t('systems.pec.title')}
        </h2>
        <div className="prose">
          <Paragraphs items={tl('systems.pec.body')} />
          <p className="notice">{t('systems.pec.caveat')}</p>
        </div>
      </section>
    </div>
  );
}
