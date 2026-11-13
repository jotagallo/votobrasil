# Contribuindo

Obrigado por ajudar! O VotoBrasil precisa ser **preciso e neutro**: toda mudança em números, regras ou textos deve poder ser conferida contra uma fonte oficial.

## Fluxo

1. Use Node 22 (`nvm use`) e rode `npm ci`.
2. Crie uma branch a partir de `main` e faça mudanças pequenas e focadas.
3. Antes de abrir o PR: `npm run lint && npm run typecheck && npm test`.
4. Se mexeu no ETL ou nos algoritmos: `npm run data:build && npm run data:validate`.

## Regras do projeto

- **Textos**: nenhuma string de interface no código. Edite `packages/shared/src/locales/{pt-BR,en,es}.json` e mantenha as três línguas em sincronia (os testes verificam chaves e placeholders).
- **Algoritmos**: ficam em `packages/shared` e precisam de teste com valores calculados à mão.
- **Dados**: nunca versione `data/raw` nem `data/processed`; eles são reproduzíveis com `npm run data:build`.
- **Segredos**: jamais faça commit de chaves, tokens ou `.env`. Para reportar vulnerabilidades, veja [SECURITY.md](SECURITY.md).
- **Neutralidade**: descreva sistemas eleitorais pelo que fazem, sem juízo de valor, e cite a fonte de qualquer afirmação factual.
