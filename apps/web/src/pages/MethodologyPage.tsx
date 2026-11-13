import type { ValidationReport } from '@votobr/shared';
import { Paragraphs, Rich } from '../components/Rich';
import { ErrorState, Skeleton } from '../components/states';
import { usePageMeta } from '../hooks';
import { useT } from '../i18n';
import { apiUrls } from '../lib/api';
import { PATHS } from '../lib/routes';
import { useMeta, useVersionedApi } from '../meta';

function Sources() {
  const { t, f } = useT();
  const meta = useMeta();
  if (meta.status === 'error') return <ErrorState onRetry={meta.reload} />;
  if (meta.status !== 'success') return <Skeleton height={160} />;
  const { sources, dataVersion, generatedAt } = meta.data;
  return (
    <>
      <p className="muted">
        {t('methodology.sources.version', { version: dataVersion, date: f.date(generatedAt) })}
      </p>
      {sources.length === 0 ? (
        <p>{t('methodology.sources.empty')}</p>
      ) : (
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label={t('methodology.sources.title')}
        >
          <table className="data-table data-table--sources">
            <caption className="sr-only">{t('methodology.sources.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('methodology.sources.name')}</th>
                <th scope="col" className="num">
                  {t('methodology.sources.size')}
                </th>
                <th scope="col">{t('methodology.sources.date')}</th>
                <th scope="col">SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source, index) => (
                <tr key={`${source.url}#${source.sha256}#${index}`}>
                  <th scope="row">
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.name}
                    </a>
                  </th>
                  <td className="num">{f.bytes(source.bytes)}</td>
                  <td>{f.date(source.downloadedAt)}</td>
                  <td>
                    <code className="hash">{source.sha256}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Validation() {
  const { t, f } = useT();
  const report = useVersionedApi<ValidationReport>((v) => apiUrls.validation(v));
  if (report.status === 'error') return <ErrorState onRetry={report.reload} />;
  if (report.status !== 'success') return <Skeleton height={120} />;
  const { areas, exact, rules, entries, generatedAt } = report.data;
  const inexact = entries.filter((entry) => entry.missing > 0);
  return (
    <div className="prose">
      <p className="big-fact">
        <strong className="big-fact__value">
          {f.int(exact)} / {f.int(areas)}
        </strong>{' '}
        <span>
          {t('methodology.validation.exact', { exact: f.int(exact), areas: f.int(areas) })}
        </span>
      </p>
      <p className="muted">
        {t('methodology.validation.rules')} <code>{rules}</code> · {f.date(generatedAt)}
      </p>
      {inexact.length > 0 ? (
        <details className="table-toggle">
          <summary>{t('methodology.validation.inexact', { count: f.int(inexact.length) })}</summary>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label={t('methodology.validation.inexactLabel')}
          >
            <table className="data-table">
              <caption className="sr-only">{t('methodology.validation.inexactLabel')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('methodology.validation.area')}</th>
                  <th scope="col" className="num">
                    {t('methodology.validation.seats')}
                  </th>
                  <th scope="col" className="num">
                    {t('methodology.validation.missing')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {inexact.map((entry) => (
                  <tr key={entry.key}>
                    <th scope="row">{entry.key}</th>
                    <td className="num">{f.int(entry.seats)}</td>
                    <td className="num">{f.int(entry.missing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : (
        <p>{t('methodology.validation.allExact')}</p>
      )}
    </div>
  );
}

const SECTIONS = ['assumptions', 'districts', 'rules', 'comparison', 'metrics', 'limits'] as const;

export default function MethodologyPage() {
  const { t, tl } = useT();
  usePageMeta({
    title: t('meta.methodology.title'),
    description: t('meta.methodology.description'),
    path: PATHS.methodology,
  });
  const repoUrl = import.meta.env.VITE_REPO_URL?.trim();

  return (
    <div className="container page">
      <p className="eyebrow">{t('nav.methodology')}</p>
      <h1 className="page-title">{t('methodology.title')}</h1>
      <p className="section-lede">{t('methodology.lede')}</p>

      <section className="prose-section" aria-labelledby="m-sources">
        <h2 id="m-sources" className="section-title">
          {t('methodology.sources.title')}
        </h2>
        <div className="prose">
          <Paragraphs items={tl('methodology.sources.body')} />
        </div>
        <Sources />
      </section>

      <section className="prose-section" aria-labelledby="m-validation">
        <h2 id="m-validation" className="section-title">
          {t('methodology.validation.title')}
        </h2>
        <div className="prose">
          <Paragraphs items={tl('methodology.validation.body')} />
        </div>
        <Validation />
      </section>

      {SECTIONS.map((key) => (
        <section key={key} className="prose-section" id={key} aria-labelledby={`m-${key}`}>
          <h2 id={`m-${key}`} className="section-title">
            {t(`methodology.${key}.title`)}
          </h2>
          <div className="prose">
            <Paragraphs items={tl(`methodology.${key}.body`)} />
            {key === 'metrics' ? (
              <dl className="formulas">
                {(
                  [
                    'gallagher',
                    'effectiveParties',
                    'majority',
                    'partiesForMajority',
                    'votesWithoutSeatPct',
                  ] as const
                ).map((metric) => (
                  <div key={metric} className="formulas__row">
                    <dt>{t(`metrics.${metric}.name`)}</dt>
                    <dd>
                      <code>{t(`methodology.metrics.formula.${metric}`)}</code>
                      <span className="formulas__text">
                        <Rich text={t(`methodology.metrics.explain.${metric}`)} />
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </section>
      ))}

      <section className="prose-section" id="reproduce" aria-labelledby="m-reproduce">
        <h2 id="m-reproduce" className="section-title">
          {t('methodology.reproduce.title')}
        </h2>
        <div className="prose">
          <Paragraphs items={tl('methodology.reproduce.body')} />
          <pre className="code-block" tabIndex={0}>
            <code>{t('methodology.reproduce.commands')}</code>
          </pre>
          {repoUrl ? (
            <p>
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn--ghost"
              >
                {t('methodology.reproduce.repo')}
              </a>
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
