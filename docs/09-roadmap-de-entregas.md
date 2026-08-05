# Roadmap de Entregas

17 sessões incrementais. Cada uma termina com algo que roda, testado, commitado, e com `dist/PolicyOps.html` atualizado.

## Quadro geral

| # | Sessão | Modelo | Entrega verificável | Depende de |
|---|---|---|---|---|
| 01 | Scaffold e build de arquivo único | **Sonnet** | `PolicyOps.html` abre por duplo clique e mostra o shell | — |
| 02 | Modelo do documento e validação | **Sonnet** | Schema Zod, documento de exemplo, migração | 01 |
| 03 | Motor de eixos aninhados | **Opus** | Tuplas, compatibilidade e cabeçalhos, 100% testados | 02 |
| 04 | Store, comandos, undo/redo | **Opus** | Command pattern com inverso e pilha de 100 | 02 |
| 05 | Persistência: abrir, salvar, conflito | **Opus** | Abre e salva de verdade nos dois modos | 04 |
| 06 | Biblioteca de Variáveis | **Sonnet** | CRUD versionado com validação de faixas | 04 |
| 07 | Biblioteca de Compatibilidade | **Sonnet** | Editor em matriz de marcação, versionado | 03,06 |
| 08 | Biblioteca de Conteúdo | **Haiku** | CRUD do catálogo | 04 |
| 09 | Projetos, matrizes e grid | **Sonnet** | Grid com cabeçalhos aninhados, somente leitura | 03,06,07,08 |
| 10 | Engine de seleção hierárquica | **Opus** | Todas as interações, incluindo cabeçalho de nível | 09 |
| 11 | Inspector e edição em massa | **Sonnet** | Editar 300 células de uma vez, desfazer | 10 |
| 12 | Operações de nível nos eixos | **Opus** | Adicionar, remover e reordenar nível com preview | 11 |
| 13 | Ciclo de vida e histórico | **Sonnet** | Rascunho → publicar → auditoria | 11 |
| 14 | Diff e comparação | **Opus** | Comparar duas versões nos 3 modos | 13 |
| 15 | Vigência por data e portfólio | **Sonnet** | "Como estava em 15/03/2026" | 13 |
| 16 | Reconciliação da biblioteca | **Opus** | Adotar nova versão de variável ou de regra | 13 |
| 17 | Templates, merge, export e polimento | **Opus** | Fechamento do MVP | 16 |

> A sessão 17 acumula três frentes. Se ficar grande, quebre em 17a (templates), 17b (merge de documentos) e 17c (export e polimento) — o prompt já vem dividido nessas três partes, com critérios de aceite independentes.

## Por que cada modelo

**Opus (7 sessões)** — 03, 04, 05, 10, 12, 14, 16 e a parte de merge da 17. São as que envolvem:

- invariantes que, se saírem erradas, corrompem dados históricos em silêncio (03, 12, 16);
- combinatória com muitos casos de borda que não aparecem em teste (10, 14);
- perda de trabalho do usuário como modo de falha (04, 05, merge).

**Sonnet (7)** — 01, 02, 06, 07, 09, 11, 13, 15. Transcrição fiel de especificação, CRUD e composição de telas sobre contratos já definidos.

**Haiku (1)** — 08. CRUD de uma entidade só.

> Se numa sessão Sonnet/Haiku aparecer decisão de arquitetura não coberta pela documentação, a instrução é **parar e perguntar**. Isso está escrito em todos os prompts.

## Marcos utilizáveis

| Marco | Após | O que já dá para fazer |
|---|---|---|
| **M1 — Roda e salva** | 05 | Abrir o `.html` do SharePoint, criar documento, salvar, reabrir. Sem funcionalidade de matriz, mas a fundação existe |
| **M2 — Bibliotecas prontas** | 08 | Cadastrar as variáveis, as compatibilidades e as ofertas reais da empresa |
| **M3 — Editor funcionando** | 11 | Montar as matrizes de verdade, inclusive aninhadas, e editá-las |
| **M4 — Substitui o Excel** | 15 | Fonte oficial: versionar, publicar, comparar, consultar por data |
| **M5 — MVP completo** | 17 | Escala: evolução da biblioteca, templates, merge, exportação |

M4 é o ponto em que a ferramenta passa a valer mais que a planilha. As sessões 16–17 são o que a torna sustentável em escala.

## Ordem e dependências

A ordem da tabela é a ordem de execução. Duas observações:

- **05 antes de 06** não é negociável: sem persistência, cada sessão de teste manual começa do zero.
- **03 antes de 09** também não: o grid depende do layout de cabeçalhos, e implementá-lo "provisoriamente" na tela garante retrabalho.

As sessões 06, 07 e 08 são independentes entre si e poderiam ser paralelizadas, se você quiser rodar duas conversas ao mesmo tempo. As demais são sequenciais.

## Como conduzir cada sessão

1. Abrir uma conversa nova do Claude Code na raiz do repositório.
2. Selecionar o modelo indicado (`/model`).
3. Colar o conteúdo de `docs/prompts/SXX-*.md`.
4. Conferir os critérios de aceite do próprio prompt antes de aceitar o commit.
5. Verificar que `dist/PolicyOps.html` foi atualizado — é o que você leva para o SharePoint.

## Estimativa

Nenhuma sessão foi dimensionada para caber num único turno. As de Opus tendem a precisar de idas e vindas. Se uma estiver crescendo demais, o prompt indica onde é seguro cortar.
