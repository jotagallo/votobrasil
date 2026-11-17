import { useEffect } from 'react';
import { PageHero } from '../components/PageHero';
import { Paragraphs, Rich } from '../components/Rich';
import { usePageMeta } from '../hooks';
import { useT } from '../i18n';
import { PATHS } from '../lib/routes';

export default function AboutPage() {
  const { t, tl } = useT();
  usePageMeta({
    title: t('meta.about.title'),
    description: t('meta.about.description'),
    path: PATHS.about,
  });
  const repoUrl = import.meta.env.VITE_REPO_URL?.trim();

  // Âncoras (`/sobre#privacy`, usada pelo aviso de privacidade): a página é carregada sob demanda.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const sections = [
    'project',
    'sources',
    'independence',
    'privacy',
    'contribute',
    'credits',
  ] as const;

  return (
    <>
      <PageHero eyebrow={t('nav.about')} title={t('about.title')} lede={t('about.lede')} />
      <div className="container page page--reading">
        {sections.map((key) => (
          <section key={key} id={key} className="prose-section" aria-labelledby={`about-${key}`}>
            <h2 id={`about-${key}`} className="section-title">
              {t(`about.${key}.title`)}
            </h2>
            <div className="prose">
              <Paragraphs items={tl(`about.${key}.body`)} />
              {key === 'contribute' ? (
                <p>
                  {repoUrl ? (
                    <a
                      href={repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn--ghost"
                    >
                      {t('about.contribute.repoLink')}
                    </a>
                  ) : (
                    <Rich text={t('about.contribute.noRepo')} />
                  )}
                </p>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
