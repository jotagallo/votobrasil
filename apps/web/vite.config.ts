import react from '@vitejs/plugin-react';
import type { PluginOption } from 'vite';
import { defineConfig } from 'vite';
import { mockApi } from './dev/mock-api.ts';
import { siteFiles } from './plugins/site-files.ts';

const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:8080';

const proxy = {
  '/api': { target: API_TARGET, changeOrigin: false },
  '/healthz': { target: API_TARGET, changeOrigin: false },
};

// `--configLoader runner` (ver scripts): o carregador padrão não importa `@votobr/shared` (TS puro).
export default defineConfig(({ command }) => {
  const plugins: PluginOption[] = [react(), siteFiles()];
  // O mock só é registrado no servidor (dev/preview): o build de produção nunca o inclui.
  if (command === 'serve') plugins.push(mockApi({ apiTarget: API_TARGET }));

  return {
    plugins,
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      target: 'es2022',
      sourcemap: false,
      // Fontes e ícones sempre como arquivos: a CSP não permite `data:` em font-src.
      assetsInlineLimit: 0,
    },
  };
});
