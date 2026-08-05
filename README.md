# Policy Matrix Studio

Fonte oficial das matrizes de política de crédito — os "cineminhas" — com edição visual, versionamento, auditoria e consulta histórica.

**Um único arquivo `.html`.** Sem instalar nada, sem servidor, sem banco de dados. Você coloca `PolicyOps.html` numa biblioteca do SharePoint, o time abre no navegador, edita e salva.

> **Status: planejamento.** O repositório contém, no momento, a especificação e o plano de execução. A implementação começa na Sessão 01.

## O problema

Matrizes de política vivem hoje em Excel, PowerPoint e imagens. Ninguém sabe ao certo qual é a versão vigente, não há histórico das alterações, e o risco de divergência entre a documentação e o motor de crédito é permanente.

## As duas ideias que sustentam a solução

**Variáveis são entidades versionadas, não texto.** Score HVI3, Segmento e Faixa de Faturamento vivem numa biblioteca. Uma matriz escolhe variáveis para seus eixos e **congela um snapshot** delas. A biblioteca evolui livremente; versões publicadas nunca mudam. O lastro fica preservado, e o usuário decide caso a caso quando adotar a evolução.

**Um eixo é uma pilha de até 3 variáveis.** `Segmento › Faixa de Faturamento` no eixo vertical, `Score` no horizontal. Combinações que não existem no mundo real — Varejo não fatura acima de 1M — são declaradas uma vez na **biblioteca de compatibilidade** e valem para todas as matrizes.

```
                          │        Score HVI3            │
                          │  R1   R2   R3   R4   R5   R6 │
──────────────────────────┼──────────────────────────────┤
 Varejo   │ até 100k      │  ██   ██   ██   ██   ██   ██ │
          │ 100k – 500k   │  ██   ██   ██   ██   ██   ██ │
          │ 500k – 1M     │  ██   ██   ██   ██   ██   ██ │
──────────┼───────────────┼──────────────────────────────┤
 Atacado  │ 500k – 1M     │  ██   ██   ██   ██   ██   ██ │
          │ 1M – 10M      │  ██   ██   ██   ██   ██   ██ │
          │ acima de 10M  │  ██   ██   ██   ██   ██   ██ │
```

## Como fica na sua rede

```
\\SharePoint\Politicas\
   ├── PolicyOps.html       ← a aplicação (~500 KB), publicada uma vez
   ├── politicas.json       ← todos os dados, legível e versionado pelo SharePoint
   └── _backups/
```

## Documentação

| Documento | Conteúdo |
|---|---|
| [01 — Visão e escopo](docs/01-visao-e-escopo.md) | Problema, conceitos, escopo do MVP, premissas |
| [02 — Arquitetura](docs/02-arquitetura.md) | Stack, arquivo único, camadas, restrições do bundle |
| [03 — Modelo do documento](docs/03-modelo-do-documento.md) | Schema JSON completo, invariantes, exemplo |
| [04 — Eixos aninhados](docs/04-eixos-aninhados.md) | Tuplas, compatibilidade, cabeçalhos, operações de nível |
| [05 — Regras de negócio](docs/05-regras-de-negocio.md) | Versionamento, células, diff, reconciliação |
| [06 — Persistência e concorrência](docs/06-persistencia-e-concorrencia.md) | Abrir, salvar, conflito, merge, autosave, recuperação |
| [07 — UX e editor](docs/07-ux-e-editor.md) | Shell, grid, seleção hierárquica, edição em massa |
| [08 — Camada de comandos](docs/08-camada-de-comandos.md) | Contrato interno, catálogo de comandos, formatos de export |
| [09 — Roadmap](docs/09-roadmap-de-entregas.md) | As 17 sessões, modelos recomendados, marcos |
| [Prompts](docs/prompts/) | Um prompt pronto por sessão |

## Como executar o plano

Uma sessão por vez, na ordem, cada uma numa conversa nova do Claude Code na raiz deste repositório:

1. `/model` → selecione o modelo indicado.
2. Cole o conteúdo de `docs/prompts/SXX-*.md`.
3. Confira os critérios de aceite do próprio prompt antes de aceitar o commit.
4. Verifique que `dist/PolicyOps.html` foi atualizado — é o arquivo que vai para o SharePoint.

| # | Sessão | Modelo |
|---|---|---|
| 01 | Scaffold e build de arquivo único | Sonnet |
| 02 | Modelo do documento e validação | Sonnet |
| 03 | Motor de eixos aninhados | **Opus** |
| 04 | Store, comandos, undo/redo | **Opus** |
| 05 | Persistência: abrir, salvar, conflito | **Opus** |
| 06 | Biblioteca de Variáveis | Sonnet |
| 07 | Biblioteca de Compatibilidade | Sonnet |
| 08 | Biblioteca de Conteúdo | Haiku |
| 09 | Projetos, matrizes e grid aninhado | Sonnet |
| 10 | Engine de seleção hierárquica | **Opus** |
| 11 | Inspector e edição em massa | Sonnet |
| 12 | Operações de nível nos eixos | **Opus** |
| 13 | Ciclo de vida e histórico | Sonnet |
| 14 | Diff e comparação | **Opus** |
| 15 | Vigência por data e portfólio | Sonnet |
| 16 | Reconciliação da biblioteca | **Opus** |
| 17 | Templates, merge, export e polimento | **Opus** |

**Marcos:** M1 roda e salva (após S05) · M2 bibliotecas prontas (S08) · M3 editor funcionando (S11) · **M4 substitui o Excel (S15)** · M5 MVP completo (S17).

## Stack

Vite 6 · React 19 · TypeScript · Zustand · Zod · Tailwind v4 · Radix UI · Vitest · Playwright

Sem backend, sem banco, sem requisições de rede em tempo de execução. Decidida em [docs/02](docs/02-arquitetura.md) — as sessões de implementação não devem alterá-la.
