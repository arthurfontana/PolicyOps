# CLAUDE.md

Policy Matrix Studio: um único `PolicyOps.html` autocontido, sem servidor, sem banco, sem requisições de
rede. Essa restrição comanda todas as decisões de arquitetura.

## Documentos normativos

Leia antes de mexer em código:

- [`docs/02-arquitetura.md`](docs/02-arquitetura.md) — stack, estrutura de pastas, restrições do bundle. **Normativo**: não substituir bibliotecas, não reorganizar pastas.
- [`docs/03-modelo-do-documento.md`](docs/03-modelo-do-documento.md) — schema do documento e invariantes.
- [`docs/05-regras-de-negocio.md`](docs/05-regras-de-negocio.md) — versionamento, células, diff, catálogo de erros (§9).
- [`docs/07-ux-e-editor.md`](docs/07-ux-e-editor.md) — shell, grid, seleção, inspector.
- [`docs/09-roadmap-de-entregas.md`](docs/09-roadmap-de-entregas.md) e [`docs/prompts/`](docs/prompts/) — as 17 sessões de implementação, uma por vez.

## As 8 regras (docs/prompts/README.md)

1. Ler `docs/02-arquitetura.md`, `docs/03-modelo-do-documento.md` e `docs/05-regras-de-negocio.md` antes de escrever código.
2. Não tomar decisões de arquitetura fora do que está documentado — **parar e perguntar**.
3. Não adicionar dependências fora da lista de `docs/02-arquitetura.md` §2 sem perguntar.
4. **`src/core/` é TypeScript puro**: sem React, sem Zustand, sem DOM, sem `window`.
5. **Zero requisições de rede** em tempo de execução. Sem CDN, sem fontes web, sem `eval`.
6. Escopo é escopo: não implementar sessões futuras "já que estou aqui".
7. Terminar com `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, o orçamento de 1,5 MB respeitado, e **`dist/PolicyOps.html` atualizado no commit**.
8. Commitar na branch de trabalho e fazer push.

## Comandos

```bash
pnpm dev                  # servidor de desenvolvimento
pnpm build                # gera dist/PolicyOps.html (roda check-size)
pnpm preview              # serve o build localmente
pnpm lint
pnpm typecheck
pnpm test:unit            # Vitest — node para src/core/, jsdom (via pragma) para componentes
pnpm test:e2e             # Playwright contra dist/PolicyOps.html por file://
pnpm check-size           # falha se dist/PolicyOps.html > 1,5 MB
pnpm check-selfcontained  # falha se o HTML tiver qualquer referência externa
```
