# Policy Matrix Studio

Fonte oficial das matrizes de política de crédito — os "cineminhas" — com representação visual, versionamento, auditoria e consulta histórica.

> **Status: planejamento.** Este repositório contém, no momento, apenas a especificação e o plano de execução. A implementação começa na Sessão 01.

## O problema

Matrizes de política vivem hoje em Excel, PowerPoint e imagens. Ninguém sabe ao certo qual é a versão vigente, não há histórico das alterações, e o risco de divergência entre a documentação e o motor de crédito é permanente.

## A ideia central

Variáveis (Score HVI3, Restritivo, Faixa de Renda) são **entidades independentes e versionadas** numa biblioteca. Uma matriz escolhe duas delas como eixos e **congela um snapshot** dos domínios no momento em que a versão é criada. A biblioteca pode evoluir livremente; versões publicadas nunca mudam. O lastro fica preservado, e o usuário decide caso a caso quando adotar a evolução.

## Documentação

| Documento | Conteúdo |
|-----------|----------|
| [01 — Visão e escopo](docs/01-visao-e-escopo.md) | Problema, conceitos, escopo do MVP, premissas |
| [02 — Especificação técnica](docs/02-especificacao-tecnica.md) | Stack, estrutura de pastas, convenções, auth, qualidade |
| [03 — Modelo de dados](docs/03-modelo-de-dados.md) | Schema Prisma completo, invariantes, dados de seed |
| [04 — Regras de negócio](docs/04-regras-de-negocio.md) | Versionamento, patch de células, diff, reconciliação |
| [05 — UX e editor](docs/05-ux-e-editor.md) | Shell, grid, engine de seleção, edição em massa, comparação |
| [06 — API](docs/06-api.md) | Server Actions, contratos, formato canônico |
| [07 — Roadmap](docs/07-roadmap-de-entregas.md) | As 14 sessões, modelos recomendados, marcos |
| [Prompts](docs/prompts/) | Um prompt pronto por sessão |

## Como executar o plano

Uma sessão por vez, na ordem, cada uma numa conversa nova do Claude Code na raiz deste repositório:

1. `/model` → selecione o modelo indicado para a sessão.
2. Cole o conteúdo de `docs/prompts/SXX-*.md`.
3. Confira os critérios de aceite do próprio prompt antes de aceitar o commit.

| # | Sessão | Modelo |
|---|--------|--------|
| 01 | Scaffold e infraestrutura | Sonnet |
| 02 | Schema, migrations e seed | Sonnet |
| 03 | Camada de domínio: versionamento e snapshot | **Opus** |
| 04 | Biblioteca de Variáveis | Sonnet |
| 05 | Biblioteca de Conteúdo | Haiku |
| 06 | Projetos e criação de matrizes | Sonnet |
| 07 | Grid do editor e engine de seleção | **Opus** |
| 08 | Inspector, edição em massa e undo/redo | **Opus** |
| 09 | Fluxo de versionamento na UI | Sonnet |
| 10 | Engine de diff e tela de comparação | **Opus** |
| 11 | Vigência por data e viewer | Sonnet |
| 12 | Reconciliação de evolução de variáveis | **Opus** |
| 13 | Templates | Sonnet |
| 14 | Exportação, polimento e E2E | Haiku |

**Marcos:** M1 bibliotecas prontas (após S05) · M2 editor funcionando (após S08) · **M3 substitui o Excel (após S11)** · M4 MVP completo (após S14).

## Stack

Next.js 15 · React 19 · TypeScript · PostgreSQL 16 · Prisma 6 · Tailwind v4 · shadcn/ui · Zustand · Zod · Vitest · Playwright

Decidida em [docs/02](docs/02-especificacao-tecnica.md) — as sessões de implementação não devem alterá-la.
