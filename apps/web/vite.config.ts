import react from '@vitejs/plugin-react';
import type { PluginOption } from 'vite';
import { defineConfig } from 'vitest/config';

const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:8080';

const proxy = {
  '/api': { target: API_TARGET, changeOrigin: false },
  '/healthz': { target: API_TARGET, changeOrigin: false },
};

export default defineConfig(async ({ command, mode }) => {
  const plugins: PluginOption[] = [react()];
  // O mock só existe no servidor de desenvolvimento: nunca é importado pelo build de produção.
  if (command === 'serve' && mode !== 'test') {
    const { mockApi } = await import('./dev/mock-api.ts');
    plugins.push(mockApi({ apiTarget: API_TARGET }));
  }

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
    test: {
      include: ['test/**/*.test.ts'],
      environment: 'node',
    },
  };
});
