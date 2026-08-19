# CLAUDE.md

Policy Matrix Studio: uma SPA autocontida (`PolicyOps.html`) servida por um **servidor Python
local por usuário** (`127.0.0.1`), com dados e evidências numa **pasta de rede** — sem máquina
central, sem banco, **zero requisições externas**. Essa restrição comanda todas as decisões de
arquitetura (`docs/14-plataforma-local.md`, ADR-001/002). `docs/02-arquitetura.md` (stack,
camadas, estrutura de pastas) é **normativo**: não substituir bibliotecas, não reorganizar
pastas sem perguntar. O produto é entregue em 44 sessões incrementais, uma de cada vez —
`docs/09-roadmap-de-entregas.md` (quadro geral) e `docs/prompts/` (um arquivo por sessão).

## Documentação em camadas — como usar este repositório

Este `CLAUDE.md` é um **índice enxuto**, carregado inteiro em toda sessão do Claude Code. Ele NÃO
contém o detalhe de cada domínio — isso vive em `docs/01..14-*.md` (documentação **normativa**: o
que o sistema é e por quê, catálogo de decisões em `docs/13-decisoes.md`) e, sob demanda, em
`docs/claude/*.md` (detalhe de **implementação**: convenções que toda sessão repete, mapa das
âncoras de região). **Antes de mexer em qualquer domínio, leia o ponteiro da tabela "Onde vive o
quê" abaixo** — não peça para "ler o projeto inteiro primeiro", os ponteiros já resolvem isso a um
custo muito menor. Pesquisa exploratória grande (achar onde algo é implementado sem saber o
domínio) vale mais delegada a um subagent de busca do que a Reads amplos nesta sessão — ver
`docs/prompts/README.md` § Higiene de prompts.

**Regra de tamanho (guard mecânico, ADR-006)**: nova feature documenta em `docs/01..14` (se for
normativa: schema, regra de negócio, UX) ou em `docs/claude/` (se for só detalhe de implementação);
no `CLAUDE.md` entra **no máximo 1 linha** no mapa de ponteiros "Onde vive o quê". Teto de **~450
linhas**, checado por `pnpm check:claude-md` no CI (`.github/workflows/ci.yml`). Se a linha nova
estourar o teto: primeiro pode uma seção deste arquivo que
regrediu de "ponteiro" para "detalhe" (move o parágrafo para `docs/claude/` ou `docs/01..14`,
deixa o ponteiro de 1 linha no lugar) — nunca apaga informação para caber. Só se o índice já
estiver genuinamente enxuto, a tabela "Onde vive o quê" pode dar spillover para
`docs/claude/Mapa-de-regioes.md` ou um arquivo de mapa dedicado, com 1 linha aqui apontando para
lá.

## Comandos

```bash
pnpm dev                  # servidor de desenvolvimento
pnpm build                # gera dist/PolicyOps.html
pnpm preview              # serve o build localmente
pnpm lint
pnpm typecheck
pnpm test:unit            # Vitest — node para src/core/, jsdom (via pragma) para componentes
pnpm test:e2e             # Playwright contra dist/PolicyOps.html por file://
pnpm check-selfcontained  # falha se o HTML tiver qualquer referência externa
pnpm check:claude-md      # falha se este arquivo passar de ~450 linhas

python -m pytest server/tests   # servidor local (server/requirements.txt + pytest)
python server/policyops_server.py --data-dir <pasta>   # sobe o servidor em 127.0.0.1
```

Convenções que toda sessão repete (suíte de contrato dos adapters, fixtures canônicas, checklist
de fechamento): `docs/claude/Convencoes-de-sessao.md`.

## As 8 regras (docs/prompts/README.md)

1. Ler `docs/02-arquitetura.md`, `docs/03-modelo-do-documento.md` e `docs/05-regras-de-negocio.md` antes de escrever código.
2. Não tomar decisões de arquitetura fora do que está documentado — **parar e perguntar**.
3. Não adicionar dependências fora da lista de `docs/02-arquitetura.md` §2 sem perguntar.
4. **`src/core/` é TypeScript puro**: sem React, sem Zustand, sem DOM, sem `window`.
5. **Zero requisições de rede externas** em tempo de execução. Sem CDN, sem fontes web, sem `eval`. Só o servidor local same-origin (`/api/*`).
6. Escopo é escopo: não implementar sessões futuras "já que estou aqui".
7. Terminar com `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes (e `python -m pytest server/tests` quando tocar `server/`), e **`dist/PolicyOps.html` atualizado no commit**.
8. Commitar na branch de trabalho e fazer push.

## Estrutura de pastas (resumida)

Árvore completa: `docs/02-arquitetura.md` §4.

```
/
├── docs/                  # documentação normativa (01..14) + prompts de sessão + docs/claude/
├── dist/PolicyOps.html    # artefato buildado, COMMITADO no repositório
├── src/
│   ├── core/              # TypeScript puro: document, axes, versioning, diff, merge,
│   │                      # reconcile, library, import, templates, export, queries.ts
│   ├── storage/           # StorageAdapter e implementações (fsa, download, server — S27)
│   ├── store/             # Zustand: document-store, editor-store, ui-store, persistence-store
│   ├── components/        # shell, grid, inspector, library, dialogs, import, matrix, ui
│   └── lib/                # colors, format, hash, download
├── server/                # servidor Python local (FastAPI): policyops_server.py + tests/ — S26
├── tests/                 # unit/ (espelha src/core/), fixtures/, e2e/
└── scripts/               # check-selfcontained, check-claude-md, finalize-dist
```

## Onde vive o quê (leia antes de mexer no domínio)

| Domínio | Doc normativo | Código |
|---|---|---|
| Documento e schema (tipos, invariantes I1–I22, migração) | `docs/03-modelo-do-documento.md` | `src/core/document/` |
| Eixos aninhados (tuplas, cabeçalho, níveis) | `docs/04-eixos-aninhados.md` | `src/core/axes/` |
| Versionamento (ciclo de vida, rascunho/publicar, células) | `docs/05-regras-de-negocio.md` §1–3 | `src/core/versioning/` |
| Diff entre versões | `docs/05-regras-de-negocio.md` §4 | `src/core/diff/` |
| Merge de documentos em conflito | `docs/06-persistencia-e-concorrencia.md` §7 | `src/core/merge/` |
| Reconciliação da biblioteca (evolução de variável) | `docs/05-regras-de-negocio.md` §5 | `src/core/reconcile/` |
| Import/carga de matrizes externas | `docs/12-carga-de-matrizes.md` | `src/core/import/`, `src/components/import/` |
| Storage e adapters (FSA, download, lock, backups) | `docs/06-persistencia-e-concorrencia.md` | `src/storage/`, `src/store/persistence-store.ts` |
| Servidor local (API v1, token, lock, backups) | `docs/14-plataforma-local.md` §3–5 | `server/policyops_server.py`, `server/tests/` |
| Launcher e pacote de distribuição (`iniciar.bat`/`instalar.bat`, `dist/plataforma/`) | `docs/14-plataforma-local.md` §9 | `server/launcher.py`, `server/*.bat`, `scripts/{fetch-wheels,build-plataforma,verify-plataforma}.mjs` |
| Identidade e papéis (ACL, resolveRole, gate de comandos) | `docs/14-plataforma-local.md` §6, `docs/08-camada-de-comandos.md` §6 | `src/core/document/roles.ts`, `meta.acl` no schema, `server/policyops_server.py` |
| Evidências — acervo `_evidencias/` (anexo, hash, lixeira) | `docs/14-plataforma-local.md` §7 | `src/core/document/evidence.ts`, `src/storage/evidences.ts`, `src/components/inspector/EvidenceSection.tsx` |
| Grid e UX (shell, seleção, inspector, tags/filtro) | `docs/07-ux-e-editor.md` | `src/components/grid/`, `src/components/` |
| Bibliotecas (variáveis, compatibilidade, catálogo) | `docs/03-modelo-do-documento.md` §2–4 | `src/core/library/`, `src/components/library/` |
| Templates de matriz | `docs/05-regras-de-negocio.md` §8 | `src/core/templates/`, `src/components/templates/` |
| Consultas de leitura (vigência, timeline, auditoria, fotografia da política em uma data e comparação entre duas — S39 ✅) | `docs/05-regras-de-negocio.md` §6 | `src/core/queries.ts`, `src/core/timeline/policy-at.ts`, `src/core/diff/policy-diff.ts` |
| Export (JSON/CSV canônico) | `docs/07-ux-e-editor.md` §9 | `src/core/export/` |
| Componentes de política (árvore, versões, schema 5) | `docs/03-modelo-do-documento.md` §12–13 | `src/core/document/components.ts`, `src/core/versioning/component-lifecycle.ts` |
| Árvore da política e cadastro/versionamento de regras (S33a/S33b ✅; árvore na barra lateral + barra de ferramentas do shell — S41 ✅ em §2/§2.1/§17.1; página do componente no centro — S42 ✅ em §17.5) | `docs/07-ux-e-editor.md` §17 | `src/components/tree/{ComponentPage,PolicyTree}.tsx`, `src/components/shell/{Toolbar,Sidebar,Shell}.tsx`, `src/components/inspector/ComponentPayloadFields.tsx`, `src/core/versioning/component-lifecycle.ts` |
| Governança de alterações (DB, workflow, vínculo de rascunho e publicação, release, timeline, carga por recorte — épico GOV, S32b/S35/S36/S37/S38/S39/S40 ✅) | `docs/14-governanca-de-alteracoes.md` | `src/core/document/{change-requests,cr-workflow,cr-drafts,cr-freeze,cr-publish,releases,release-publish}.ts`, `src/core/import/markdown-*.ts`, `src/components/change-requests/` |
| Editor rico de especificação (`RichDoc`: blocos, colar, imagem embutida, diff por bloco — S34 ✅) | `docs/07-ux-e-editor.md` §18, `docs/14-governanca-de-alteracoes.md` §7 | `src/core/richdoc/`, `src/components/richdoc/` |
| Pacote para a Fábrica (gerador puro, HTML de impressão, Markdown, `factoryTemplate` do projeto — S38 ✅) | `docs/14-governanca-de-alteracoes.md` §8 | `src/core/export/factory-package*.ts`, `src/lib/print-window.ts`, `src/components/dialogs/FactoryContactsEditor.tsx`, `src/components/change-requests/factory-package-actions.ts` |

Mapa das âncoras de região dos arquivos grandes (`// #region: <slug>`, `docs/claude/Mapa-de-regioes.md`) — grep rápido: `grep -rn "// #region:" src/`.

## Decisões arquiteturais (resumo dos ADRs — catálogo completo em `docs/13-decisoes.md`)

| ADR | Decisão | Justificativa |
|-----|---------|---------------|
| ADR-001 | Servidor Python local por usuário, pasta de rede, sem máquina central | Browser não grava arquivo de forma confiável; servidor local resolve sem virar operação centralizada |
| ADR-002 | Servidor entra por baixo do `StorageAdapter` existente | Front e `src/core/` não mudam de dono; "zero rede" passa a significar "zero rede **externa**" |
| ADR-003 | Identidade = login Windows capturado pelo servidor; papéis em `meta.acl` | Identificador gratuito e não falsificável; papéis dão controle organizacional sem fingir segurança de arquivo compartilhado |
| ADR-004 | Evidências em acervo gerenciado, navegável e em claro (nunca opaco) | Sobrevive a desastre: o time acessa pelo Explorer mesmo se a aplicação quebrar; hash detecta adulteração |
| ADR-005 | FastAPI com instalação em camadas (venv + índice pip + wheels offline) | Instalação determinística e offline; padrão já validado em produção no AppCreditoSimulador |
| ADR-006 | Guardrails de consumo de contexto tratados como requisito de arquitetura | Sessão nova acha qualquer domínio por 1 ponteiro; custo de tokens vira estável em vez de crescer com o produto |
