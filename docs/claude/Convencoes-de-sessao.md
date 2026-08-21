# Convenções de sessão

> Ponteiro a partir de: `CLAUDE.md` § Comandos. Sessão S31 (ADR-006). O que toda sessão de
> implementação repete — não duplica nada de `docs/01..14`, só resume o operacional.

## Comandos de verificação (fechamento de sessão)

Regra 7 das 8 regras (`docs/prompts/README.md`) — rodar antes de considerar a sessão terminada:

```bash
pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build
```

- Se a sessão tocou `server/`: também `python -m pytest server/tests`.
- Se a sessão tocou `CLAUDE.md`: também `pnpm check:claude-md` (guard de ~450 linhas, ADR-006).
- Antes de commitar mudança de UI: `pnpm check-selfcontained` (zero referência de rede externa no
  `dist/PolicyOps.html`) — normalmente coberto pelo CI, mas vale rodar local se a sessão mexeu em
  algo que poderia introduzir uma URL externa (fonte, ícone, script).
- `pnpm test:e2e` roda contra `dist/PolicyOps.html` por `file://` — só depois de `pnpm build`.
- **Mudou `src/components/grid/` ou adicionou um elemento posicionado por cima do grid** (alça de
  redimensionamento, marquee, overlay de diff): `pnpm test:e2e` deixa de ser opcional. `test:unit`
  roda em `jsdom`, que não tem geometria real — um `<div>` absoluto com `z-index` alto por cima de
  um cabeçalho sticky com `rowspan`/`colspan` passa limpo no Vitest e só quebra no Playwright real
  (`locator.click: ... intercepts pointer events`), como aconteceu com as alças de
  redimensionamento de coluna/linha (S46) cobrindo cabeçalhos agrupados de `tests/e2e/selecao.spec.ts`
  três vezes seguidas antes de virar regra. Ao desenhar um overlay assim: **nunca** deixe-o cobrir a
  faixa de cabeçalho sticky (X) nem a coluna de cabeçalho sticky (Y) — restrinja `top`/`left` e
  `width`/`height` à área de dados, e só depois rode o E2E para confirmar que nenhum
  `role="columnheader"`/`role="rowheader"` ficou inacessível a clique.
- `dist/PolicyOps.html` precisa estar atualizado **no mesmo commit** que gerou a mudança (regra 7).

## Suíte de contrato dos adapters

`src/storage/adapter.ts` define a interface `StorageAdapter` implementada por `fsa-adapter.ts`
(File System Access API) e `download-adapter.ts` (fallback `<input>`/`<a download>`); o modo
`SERVER` (S27, planejado) adiciona `server-adapter.ts` sobre a mesma interface (ADR-002). Um
adapter novo — ou uma mudança de contrato num adapter existente — precisa cobrir o mesmo conjunto
de comportamentos que `tests/unit/storage/fsa-adapter.test.ts` e
`tests/unit/storage/download-adapter.test.ts` já cobrem cada um à sua maneira (não é uma suíte
parametrizada única — é a mesma lista de `describe` replicada por adapter):

- abrir e salvar, com hash acompanhando a revisão salva;
- detecção de conflito (`docs/06-persistencia-e-concorrencia.md` §5) — hash divergente devolve
  `CONFLICT` sem gravar nada; "sobrescrever mesmo assim" só grava depois de aceitar o remoto como
  base;
- documento inválido nunca é gravado (§4) — `save()` devolve `IO` com a explicação, disco
  intocado;
- comportamento específico do adapter: `fsa-adapter` cobre backups automáticos (§9) e arquivo que
  virou lixo no disco; `download-adapter` cobre o aviso de ausência de detecção de conflito
  (`DOWNLOAD_ONLY_CONFLICT_WARNING`) e a leitura do arquivo baixado de volta
  (`readDocumentFromBytes`).

`tests/unit/storage/fakes.ts` (`fakeFileHandle`) e `@/storage/directory` (`memoryDirectory`) são
os dublês usados pelos dois arquivos — reuse-os em vez de mockar a File System Access API na mão.

## Fixtures canônicas

`tests/fixtures/*.json` são documentos completos usados em vários arquivos de teste — não crie
uma fixture nova se uma destas já cobre o cenário:

| Fixture | Uso |
|---|---|
| `sample-document.json` | Documento de exemplo completo, mesmo conteúdo de `createSampleDocument()` |
| `valid-base.json`, `valid-minimal.json` | Documentos válidos mínimos para testes de validação/schema |
| `defect-*.json` | Um defeito plantado por arquivo (referência de catálogo ausente, coordenada de célula inválida, tupla órfã, gap de `position`, duas versões `PUBLISHED`) — usados pelos testes de `validate.ts` |
| `migration-v0-raw.json`, `v2-document.json`, `v3-document.json`, `v4-document.json`, `regional-v1-document.json` | Documentos em versões antigas de schema, para os testes de `migrate.ts` — `vN-document.json` é o `sample-document.json` de antes da migração `N → N+1` |
| `mini-politica.json` | Mini-política no formato do documento real (capítulo com Visão Geral versionada, duas seções puras, 3 regras, espelho de matriz e de variável) — fixture das invariantes I27–I29 e do round-trip da árvore |
| `cineminha-recorte.csv` | Recorte real (231 linhas) do `CINEMINHA_20260708.csv` original — fixture do épico Carga (`docs/12-carga-de-matrizes.md`), usada pelo assistente de importação ponta a ponta |

Fixture nova só quando nenhuma das acima serve o cenário — e documenta o motivo num comentário no
próprio teste que a usa pela primeira vez (por que as fixtures existentes não bastam).
