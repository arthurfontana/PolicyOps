# Prompts de Execução

Um arquivo por sessão. Abra uma conversa nova do Claude Code na raiz do repositório, selecione o modelo indicado com `/model`, e cole o conteúdo do arquivo inteiro.

Marque a coluna **Executado** conforme cada sessão for concluída e commitada.

| # | Executado | Arquivo | Modelo | Tema |
|---|---|---|---|---|
| 01 | [x] | [S01-scaffold.md](S01-scaffold.md) | `Sonnet` | Vite → arquivo único, shell, tema |
| 02 | [x] | [S02-documento.md](S02-documento.md) | `Sonnet` | Schema Zod, validação, exemplo, migração |
| 03 | [x] | [S03-eixos-aninhados.md](S03-eixos-aninhados.md) | `Opus` | Tuplas, compatibilidade, cabeçalhos |
| 04 | [x] | [S04-store-e-comandos.md](S04-store-e-comandos.md) | `Opus` | Command pattern, undo/redo |
| 05 | [x] | [S05-persistencia.md](S05-persistencia.md) | `Opus` | Abrir, salvar, conflito, autosave, lock |
| 06 | [x] | [S06-biblioteca-variaveis.md](S06-biblioteca-variaveis.md) | `Sonnet` | Biblioteca de Variáveis |
| 07 | [x] | [S07-biblioteca-compatibilidade.md](S07-biblioteca-compatibilidade.md) | `Sonnet` | Biblioteca de Compatibilidade |
| 08 | [x] | [S08-biblioteca-conteudo.md](S08-biblioteca-conteudo.md) | `Haiku` | Catálogo de ofertas/decisões/limites |
| 09 | [x] | [S09-grid-e-matrizes.md](S09-grid-e-matrizes.md) | `Sonnet` | Projetos, matrizes, grid aninhado |
| 10 | [x] | [S10-selecao.md](S10-selecao.md) | `Opus` | Engine de seleção hierárquica |
| 11 | [x] | [S11-inspector-e-edicao-massa.md](S11-inspector-e-edicao-massa.md) | `Sonnet` | Inspector e edição em massa |
| 12 | [x] | [S12-operacoes-de-nivel.md](S12-operacoes-de-nivel.md) | `Opus` | Adicionar/remover/reordenar nível |
| 13 | [x] | [S13-ciclo-de-vida.md](S13-ciclo-de-vida.md) | `Sonnet` | Rascunho, publicação, histórico |
| 14 | [x] | [S14-diff-e-comparacao.md](S14-diff-e-comparacao.md) | `Opus` | Diff e tela de comparação |
| 15 | [x] | [S15-vigencia-por-data.md](S15-vigencia-por-data.md) | `Sonnet` | Vigência, linha do tempo, portfólio |
| 16 | [x] | [S16-reconciliacao.md](S16-reconciliacao.md) | `Opus` | Evolução da biblioteca e resnapshot |
| 17 | [x] | [S17-templates-merge-export.md](S17-templates-merge-export.md) | `Opus` | Templates, merge, export, polimento |
| 18 | [x] | [S18-faixa-regional.md](S18-faixa-regional.md) | `Sonnet` | Faixas regionais e duplicação de variáveis (pós-MVP, depende de 06) |
| 19 | [x] | [S19-import-generico-e-paletas.md](S19-import-generico-e-paletas.md) | `Sonnet` | Importação genérica de domínios e paletas de cor (pós-MVP, depende de 18) |
| 20 | [x] | [S20-agrupamentos-hierarquicos.md](S20-agrupamentos-hierarquicos.md) | `Opus` | Agrupamentos hierárquicos de faixas — generaliza regional em N níveis (pós-MVP, depende de 19) |
| 21 | [x] | [S21-motor-de-carga.md](S21-motor-de-carga.md) | `Opus` | Motor da carga de matrizes: parser, perfil, plano e diff (épico Carga, depende de 14) |
| 22 | [x] | [S22-assistente-de-carga-mapeamento.md](S22-assistente-de-carga-mapeamento.md) | `Sonnet` | Assistente de carga, passos 1–4: arquivo, colunas e biblioteca (depende de 21) |
| 23 | [x] | [S23-tags-e-schema-3.md](S23-tags-e-schema-3.md) | `Sonnet` | Tags de matriz, filtro por facetas e `schemaVersion: 3` (depende de 20; paralelizável) |
| 24 | [x] | [S24-aplicacao-da-carga.md](S24-aplicacao-da-carga.md) | `Opus` | Aplicação da carga, versionamento seletivo e fila de revisão (depende de 22 e 23) |
| 25 | [x] | [S25-evolucao-estrutural-na-carga.md](S25-evolucao-estrutural-na-carga.md) | `Opus` | Faixa nova no arquivo vira versão de variável adotada no rascunho (depende de 24) |
| 26 | [x] | [S26-servidor-local.md](S26-servidor-local.md) | `Opus` | Servidor local: persistência atômica, conflito, lock, backups, token (épico Plataforma) |
| 27 | [x] | [S27-modo-server.md](S27-modo-server.md) | `Sonnet` | `server-adapter` e modo `SERVER` no front (depende de 26) |
| 28 | [x] | [S28-launcher-e-distribuicao.md](S28-launcher-e-distribuicao.md) | `Sonnet` | `iniciar.bat`, `instalar.bat`, pacote `dist/plataforma/` (depende de 27) |
| 29 | [x] | [S29-identidade-e-papeis.md](S29-identidade-e-papeis.md) | `Sonnet` | Identidade Windows, `meta.acl` e papéis — schema 4 (depende de 27) |
| 30 | [x] | [S30-evidencias.md](S30-evidencias.md) | `Opus` | Evidências: acervo navegável com hash (depende de 27 e 29) |
| 31 | [x] | [S31-guardrails-de-contexto.md](S31-guardrails-de-contexto.md) | `Sonnet` | CLAUDE.md índice, guard mecânico, âncoras de região (independente) |
| 32a | [x] | [S32a-nucleo-de-componentes.md](S32a-nucleo-de-componentes.md) | `Opus` | Schema 5 inteiro + componentes versionados, I23–I24, I27 (épico Governança, depende de 29) — **lote 1: fundação** |
| 32b | [x] | [S32b-solicitacao-release-workflow.md](S32b-solicitacao-release-workflow.md) | `Opus` | Núcleo de DB, release, grafo de estados, I25–I26 (depende de 32a; **antes da 35**) |
| 33a | [x] | [S33a-arvore-da-politica.md](S33a-arvore-da-politica.md) | `Sonnet` | Árvore da política: esqueleto navegável, nós MATRIX, facetas (depende de 32a) — **lote 2: esqueleto** |
| 33b | [x] | [S33b-cadastro-de-regras.md](S33b-cadastro-de-regras.md) | `Sonnet` | Cadastro por tipo, versionamento com vigência, entrada em volume (depende de 33a) — **lote 3: conteúdo** |
| 34 | [x] | [S34-editor-rico.md](S34-editor-rico.md) | `Opus` | Editor rico de blocos, anexos de imagem, diff por bloco (depende de 32a) |
| 35 | [x] | [S35-solicitacao-e-workflow.md](S35-solicitacao-e-workflow.md) | `Sonnet` | Solicitação de Alteração (DB), workflow, fila e pendências (depende de 32b, 33b e 34) |
| 36 | [x] | [S36-vinculo-e-publicacao.md](S36-vinculo-e-publicacao.md) | `Opus` | Vínculo DB↔rascunhos, congelamento, publicação atômica (depende de 35) |
| 37 | [x] | [S37-release-e-timeline.md](S37-release-e-timeline.md) | `Sonnet` | Release de política e timeline do Diário de Bordo (depende de 36) |
| 38 | [x] | [S38-pacote-fabrica.md](S38-pacote-fabrica.md) | `Sonnet` | Pacote para a Fábrica: HTML imprimível + Markdown (depende de 36) |
| 39 | [x] | [S39-fotografia-historica.md](S39-fotografia-historica.md) | `Opus` | Política inteira em qualquer data e comparações A×B (depende de 36) |
| 40 | [x] | [S40-carga-de-componentes.md](S40-carga-de-componentes.md) | `Sonnet` | 🟡 Carga da política **por recorte**, dentro da seção escolhida (depende de 32a, 33a, 33b) — **lote 4: opcional, decidir após uso real** |
| 41 | [ ] | [S41-shell-e-navegacao.md](S41-shell-e-navegacao.md) | `Opus` | Árvore da política na barra lateral (redimensionável) e barra de ferramentas contextual (épico Experiência, depende de 33b/40) |
| 42 | [ ] | [S42-pagina-do-componente.md](S42-pagina-do-componente.md) | `Sonnet` | Componente editado no centro da tela, em coluna larga; inspector direito só para seleção (depende de 41) |
| 43 | [ ] | [S43-vigencia-da-politica.md](S43-vigencia-da-politica.md) | `Opus` | Vigência mostra a política inteira na data (estrutura, não só matrizes); some o modo fotografia da árvore (depende de 42) |
| 44 | [ ] | [S44-fluxo-do-dia-a-dia.md](S44-fluxo-do-dia-a-dia.md) | `Sonnet` | Teclado na árvore, "próximo pendente", densidade e atalhos (depende de 43) |

## Épico Experiência (41–44)

Reforma de layout pedida depois do uso real da política dentro da ferramenta: **uma árvore só**
(barra lateral), **o componente no centro**, **ações na barra de ferramentas** e **a consulta
histórica como tela**. Decisões em `docs/13-decisoes.md` (DEC-UX-001 a DEC-UX-005), comportamento
alvo em `docs/07-ux-e-editor.md` §2, §2.1, §10, §17.1, §17.5, §20 e §21. A ordem é sequencial —
cada sessão pressupõe o layout da anterior:

```
41 (navegação) → 42 (página do componente) → 43 (vigência/consulta) → 44 (fluxo e teclado)
```

## Ordem do épico Governança (DEC-GOV-010, revista pela DEC-GOV-012)

A numeração da tabela **não** é a ordem de execução deste épico. O objetivo da trilha antecipada
continua sendo ter a política real dentro da ferramenta antes de investir no resto — mas ela entra
**à mão, incrementalmente**, e não por uma carga de tudo de uma vez. A antiga S32 foi dividida em
32a/32b (para o workflow do Diário de Bordo sair do caminho crítico) e a S33, em 33a/33b (para
existir um ponto de checagem antes de o formulário de regra ser construído):

```
32a → 33a → 33b → ⟨uso real: a política as-is entra à mão; a rota se ajusta aqui⟩
  → 40 (opcional) → 34 ✅ → 32b → 35 → 36 → 37/38 → 39
```

**Lotes para colocar a política as-is** (detalhe em `docs/09-roadmap-de-entregas.md`):

| Lote | Sessões | Ao fim dele você consegue |
|---|---|---|
| 1 — Fundação | 32a | nada visível: schema, comandos e testes |
| 2 — Esqueleto | 33a | montar a hierarquia da política e pendurar as matrizes que já existem |
| 3 — Conteúdo | 33b | digitar e publicar as regras com a vigência da fundação |
| ⏸ Parada | — | usar, e decidir `sectionKind`, nó de referência e se a 40 vale |
| 4 — Aceleração | 40 | subir capítulos convertidos, por recorte (opcional) |
| 5 — Governança | 34 ✅ → 32b → 35 → 36 → 37/38 → 39 | o épico completo |

Antes da S40, converta o documento de política para o Markdown convencionado com o prompt de
`docs/14-governanca-de-alteracoes.md` §9.1 — não depende de código e pode ser feito enquanto as
32a/33 rodam.

## Regras válidas para todas as sessões

Repetidas dentro de cada prompt; ficam aqui como referência.

1. Ler `docs/02-arquitetura.md`, `docs/03-modelo-do-documento.md` e `docs/05-regras-de-negocio.md` antes de escrever código.
2. Não tomar decisões de arquitetura fora do que está documentado — **parar e perguntar**.
3. Não adicionar dependências fora da lista de `docs/02-arquitetura.md` §2 sem perguntar.
4. **`src/core/` é TypeScript puro**: sem React, sem Zustand, sem DOM, sem `window`.
5. **Zero requisições de rede externas** em tempo de execução. Sem CDN, sem fontes web, sem `eval`. A única comunicação permitida é com o servidor local same-origin (`/api/*`, `docs/14-plataforma-local.md` §5).
6. Escopo é escopo: não implementar sessões futuras "já que estou aqui".
7. Terminar com `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes (e `python -m pytest server/tests` quando a sessão tocar `server/`), e **`dist/PolicyOps.html` atualizado no commit**.
8. Commitar na branch de trabalho e fazer push.

## Higiene de prompts (ADR-006, S31)

Guardrails de consumo de contexto valem também para como a sessão é conduzida, não só para a
documentação:

- **Pesquisa exploratória grande vai para um subagent.** "Onde isso é implementado?", "que
  arquivos mexem em X?" sobre um domínio ainda não localizado pelo mapa "Onde vive o quê" do
  `CLAUDE.md` custa menos delegado a um subagent de busca do que em Reads amplos na sessão
  principal — a sessão principal fica só com a resposta, não com o caminho até ela.
- **Pedido aponta arquivo/região, não "o projeto".** Já sabendo o domínio, use o ponteiro da
  tabela "Onde vive o quê" (doc normativo + diretório) e, se o arquivo tiver âncoras
  (`docs/claude/Mapa-de-regioes.md`), a âncora — `grep -n "// #region: <slug>" <arquivo>` — em vez
  de pedir para ler o arquivo inteiro ou o repositório inteiro.
- **Sessão nova por tarefa.** Uma conversa que já implementou uma sessão e vai começar outra sem
  relação carrega contexto irrelevante (Reads, tentativas descartadas) que não ajuda a próxima
  tarefa e só custa tokens — abra uma sessão nova, como a numeração de sessões deste diretório já
  pressupõe.
