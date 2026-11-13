import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans/wght.css';
import { App } from './App';
import { initAnalytics } from './analytics';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';

initAnalytics();

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
