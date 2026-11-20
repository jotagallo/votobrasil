import { defineConfig } from 'vitest/config';

// Separado de `vite.config.ts`: os testes não precisam dos plugins do site, e o carregador de
// configuração padrão do Vite não importa `@votobr/shared` (TypeScript puro do workspace).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
