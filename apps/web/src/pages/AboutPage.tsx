import { useEffect } from 'react';
import { PageHero } from '../components/PageHero';
import { Rich } from '../components/Rich';
import { usePageMeta } from '../hooks';
import { useT } from '../i18n';
import { AUTHOR_LINKS } from '../lib/author';
import { PATHS } from '../lib/routes';

export default function AboutPage() {
  const { t, tl } = useT();
  usePageMeta({
    title: t('meta.about.title'),
    description: t('meta.about.description'),
    path: PATHS.about,
  });

  // Âncoras (`/sobre#privacy`, usada pelo aviso de privacidade): a página é carregada sob demanda.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const sections = [
    'project',
    'author',
    'sources',
    'independence',
    'privacy',
    'contribute',
    'credits',
  ] as const;
  const [, personalSiteLink] = AUTHOR_LINKS;

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
              {tl(`about.${key}.body`).map((text, index, paragraphs) => (
                <p key={index}>
                  <Rich text={text} />
                  {key === 'author' && index === paragraphs.length - 1 ? (
                    <>
                      {' '}
                      <span aria-hidden="true">·</span>
                      {'\u00a0'}
                      <a href={personalSiteLink.href} target="_blank" rel="noopener noreferrer">
                        {personalSiteLink.label}
                      </a>
                    </>
                  ) : null}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
