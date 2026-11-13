import { Suspense, lazy, useMemo } from 'react';
import { Route, Router, Switch, useLocation } from 'wouter';
import { Layout } from './components/Layout';
import { Skeleton } from './components/states';
import { LocaleContext } from './i18n';
import { localePrefix, splitLocale } from './lib/routes';
import { MetaProvider } from './MetaProvider';

const HomePage = lazy(() => import('./pages/HomePage'));
const HousePage = lazy(() => import('./pages/HousePage'));
const AreaPage = lazy(() => import('./pages/AreaPage'));
const SystemsPage = lazy(() => import('./pages/SystemsPage'));
const MethodologyPage = lazy(() => import('./pages/MethodologyPage'));
const SemipresidentialismPage = lazy(() => import('./pages/SemipresidentialismPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function Routes() {
  return (
    <Suspense
      fallback={
        <div className="container page">
          <Skeleton height={320} />
        </div>
      }
    >
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/casa/:office" component={HousePage} />
        <Route path="/casa/:office/:area" component={AreaPage} />
        <Route path="/sistemas" component={SystemsPage} />
        <Route path="/metodologia" component={MethodologyPage} />
        <Route path="/semipresidencialismo" component={SemipresidentialismPage} />
        <Route path="/sobre" component={AboutPage} />
        <Route component={NotFoundPage} />
      </Switch>
    </Suspense>
  );
}

/** Resolve o idioma pelo prefixo da URL e monta o roteador interno relativo a ele. */
function LocaleShell() {
  const [location] = useLocation();
  const { locale } = useMemo(() => splitLocale(location), [location]);
  return (
    <LocaleContext.Provider value={locale}>
      <Router base={localePrefix(locale)}>
        <MetaProvider>
          <Layout>
            <Routes />
          </Layout>
        </MetaProvider>
      </Router>
    </LocaleContext.Provider>
  );
}

export function App() {
  return (
    <Router>
      <LocaleShell />
    </Router>
  );
}
