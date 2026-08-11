# Roadmap de Entregas

25 sessões incrementais — as 17 do MVP, 18–20 pós-MVP (biblioteca de variáveis) e 21–25 do épico Carga. Cada uma termina com algo que roda, testado, commitado, e com `dist/PolicyOps.html` atualizado.

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
| 18 | Faixas regionais e duplicação de variáveis | **Sonnet** | Variável `RANGE` com threshold por regional, colar tabela, duplicar variável | 06 |
| 19 | Importação genérica de domínios e paletas de cor | **Sonnet** | Colar tabela para qualquer tipo de variável, continuidade automática por padrão, preservação de cor ao recolar, paletas oficiais | 18 |
| 20 | Agrupamentos hierárquicos de faixas | **Opus** | `regionalDimension` generalizado em `groupingDimensions` de 1 a 4 níveis, migração de schema, colagem com colunas de agrupamento, editor tidy | 19 |
| 21 | Motor de carga de matrizes | **Opus** | ✅ **Entregue** — `planImport` sobre o CSV real: 102 matrizes classificadas em novas/alteradas/inalteradas, com diff por célula, 100% testado | 14 |
| 22 | Assistente de carga: arquivo, colunas e biblioteca | **Sonnet** | ✅ **Entregue** — passos 1–4 do assistente e o passo 5 (plano) somente leitura; a biblioteca do documento sai montada a partir do arquivo | 21 |
| 23 | Tags de matriz, filtro e schema 3 | **Sonnet** | 🟡 **Parcial** — o modelo de documento (schema 3, `importProfiles`, `Matrix.tags`, `CatalogItem.group`, `matrix/setTags`, I20–I22) foi entregue pela S24, que dependia dele; falta o filtro por facetas na lista de matrizes e na barra lateral | 20 |
| 24 | Aplicação da carga e versionamento seletivo | **Opus** | ✅ **Entregue** — carga aplicada: rascunho só nas alteradas, fila de revisão, perfil salvo, auditoria e idempotência | 22, 23 |
| 25 | Evolução estrutural na carga | **Opus** | Faixa nova no arquivo vira nova versão de variável adotada no rascunho, sem caminho manual | 24 |

> **Sessão 21 entregue.** O motor vive em `src/core/import/` (`issues`, `parse-table`, `profile`,
> `resolve`, `plan`, `library-gaps`, `hash`), com 100% de cobertura e os cenários CT-01 a CT-10 e
> CT-16 verdes sobre um recorte real do `CINEMINHA_20260708.csv`. O arquivo inteiro sobre um
> documento sem matrizes classifica 102 matrizes `NEW` e 40.068 células em menos de 1 s; aplicado
> sobre o documento já publicado, volta 102 `UNCHANGED` e zero células alteradas. As telas são as
> sessões 22 e 24.

> **Sessão 22 entregue.** O assistente vive em `src/components/import/` (`ImportWizard` +
> passos 1–5), com estado de UI em `src/store/import-store.ts`. Rodado ponta a ponta contra o
> recorte real do CINEMINHA (`tests/fixtures/cineminha-recorte.csv`, 231 linhas) a partir de um
> documento com só `SCORE_HVI3` publicada: o passo 3 monta o resto da biblioteca (domínios
> incluindo `R99`, `MODELO_ADICIONAL`, `FAIXA_MODELO_ADICIONAL`, a compatibilidade entre elas, e o
> catálogo de ofertas/decisões/tags) pelos comandos normais, e o passo 5 chega a 18 matrizes novas
> sem nenhuma pendência. Quatro ajustes de composição de tela descobertos ao montar o fluxo
> completo ficam em `13-decisoes.md` DEC-CARGA-014.

> **Sessão 24 entregue — marco M6 fechado.** `import/apply` (`src/core/import/apply.ts`) compõe os
> comandos existentes para criar as matrizes novas e um rascunho **só** nas alteradas, sem publicar
> nada (RN-10); o passo 5 vira o plano interativo com seleção, filtros e o `CompareView` embutido
> (DEC-CARGA-015), o passo 6 aplica e abre a fila de revisão, e a tela de Rascunhos ganha o filtro
> por `importRunId` com "Publicar revisados" em lote. CT-01, CT-02, CT-10, CT-11, CT-13, CT-14,
> CT-15 e CT-16 verdes, mais o inverso, a atomicidade do lote e os 102 rascunhos do arquivo real
> aplicados em ~800 ms (orçamento de 2 s). O E2E do épico roda a sequência inteira: carga →
> publicação → 5 células alteradas → segunda carga com 1 matriz → terceira carga sem nada a aplicar.
>
> **A S23 não estava implementada quando a S24 começou.** O modelo de documento dela — `schemaVersion: 3`,
> `importProfiles`, `Matrix.tags`, `CatalogItem.group`, os eventos novos, I20–I22, `matrix/setTags` e
> `importProfile/save`/`delete` — é pré-condição da aplicação da carga, e foi entregue junto com a S24.
> O que resta da S23 é a interface: o campo de tags no inspector da matriz e o filtro por facetas na
> lista e na barra lateral (`07-ux-e-editor.md` §15).

> A sessão 17 acumula três frentes. Se ficar grande, quebre em 17a (templates), 17b (merge de documentos) e 17c (export e polimento) — o prompt já vem dividido nessas três partes, com critérios de aceite independentes.

> **Sessões 21–25 são o épico Carga** ([`12-carga-de-matrizes.md`](12-carga-de-matrizes.md), decisões `DEC-CARGA-*` em [`13-decisoes.md`](13-decisoes.md)), nascido do caso real de trazer a extração `CINEMINHA` (6.678 linhas → 102 matrizes) para dentro do documento e mantê-la atualizada mês a mês. Dependem do diff (14) e, para o passo de biblioteca, do que as sessões 19–20 já entregaram. **23 é independente das demais** — tags e migração de schema não dependem do motor de carga — e pode ser executada em paralelo com 21/22.

> **Sessões 18–20 são pós-MVP**, adicionadas depois do fechamento das 17 originais, a pedido de um caso real de score B2B com corte por regional e, na sequência, por Regional × Porte × Tipo de Empresa (ver `docs/prompts/S18-faixa-regional.md`, `S19-import-generico-e-paletas.md`, `S20-agrupamentos-hierarquicos.md`). Não bloqueiam nem dependem de nenhum marco M1–M5; só precisam da Biblioteca de Variáveis (06) pronta. **19 e 20 evoluem o que a 18 entregou** — a colagem específica de "regional" e o schema `regionalDimension` da sessão 18 são substituídos (não mantidos em paralelo) pela colagem genérica e por `groupingDimensions` ao final da 20; ver a nota de migração em `docs/03-modelo-do-documento.md` §10.

## Por que cada modelo

**Opus (7 sessões)** — 03, 04, 05, 10, 12, 14, 16 e a parte de merge da 17. São as que envolvem:

- invariantes que, se saírem erradas, corrompem dados históricos em silêncio (03, 12, 16);
- combinatória com muitos casos de borda que não aparecem em teste (10, 14);
- perda de trabalho do usuário como modo de falha (04, 05, merge).

**Sonnet (7)** — 01, 02, 06, 07, 09, 11, 13, 15. Transcrição fiel de especificação, CRUD e composição de telas sobre contratos já definidos.

**Haiku (1)** — 08. CRUD de uma entidade só.

> Se numa sessão Sonnet/Haiku aparecer decisão de arquitetura não coberta pela documentação, a instrução é **parar e perguntar**. Isso está escrito em todos os prompts.

**18** é Sonnet pelo mesmo motivo de 06/07: transcrição fiel de um contrato já fechado em `docs/03` e `docs/05` §5.6 (schema, validação, formato de colagem), sem combinatória nova de eixo/tupla — a parte que exigiria Opus (motor de eixos) não é tocada, porque a dimensão regional é explicitamente removida do snapshot antes de chegar lá.

**19** é Sonnet pelo mesmo motivo: generaliza a colagem e adiciona paletas sem tocar no schema do documento (`groupingDimensions` continua não existindo até a 20) nem em invariante nenhum — é composição de tela e um parser novo sobre um contrato que este pacote de documentação já fecha.

**21, 24 e 25** são Opus: comparação semântica em escala (102 matrizes, 40.000 células) onde um falso negativo apaga a evidência de que a política mudou e um falso positivo enche a linha do tempo de versões idênticas; aplicação em lote que precisa ser tudo-ou-nada sobre o documento; e, na 25, evolução de eixo já publicado — o mesmo perfil de risco que justificou Opus em 03/12/16.

**22 e 23** são Sonnet: composição de telas e CRUD sobre contratos que este pacote de documentação já fecha (`12-carga-de-matrizes.md` §5 e §6), sem invariante nova de eixo nem combinatória. A migração 2→3 da sessão 23 é puramente aditiva (`03-modelo-do-documento.md` §10) — não reescreve campo existente, que é o que tornaria a migração cara.

**20** é Opus: renomeia e reestrutura um campo do schema já publicado (exige migração de `schemaVersion`, `docs/03` §10), generaliza uma invariante (I9/I19) para combinatória de caminhos que **não** é fixa (hierarquias assimétricas, sem completude obrigatória) e reescreve o editor de domínios de grid pivotado para tabela tidy — é exatamente o perfil "invariante que corrompe dado em silêncio se sair errada" que justifica Opus em 03/12/16.

## Marcos utilizáveis

| Marco | Após | O que já dá para fazer |
|---|---|---|
| **M1 — Roda e salva** | 05 | Abrir o `.html` do SharePoint, criar documento, salvar, reabrir. Sem funcionalidade de matriz, mas a fundação existe |
| **M2 — Bibliotecas prontas** | 08 | Cadastrar as variáveis, as compatibilidades e as ofertas reais da empresa |
| **M3 — Editor funcionando** | 11 | Montar as matrizes de verdade, inclusive aninhadas, e editá-las |
| **M4 — Substitui o Excel** | 15 | Fonte oficial: versionar, publicar, comparar, consultar por data |
| **M5 — MVP completo** | 17 | Escala: evolução da biblioteca, templates, merge, exportação |
| **M6 — Carga em produção** | 24 | A extração mensal entra por arquivo: 102 matrizes carregadas na primeira vez, e nas seguintes só as que mudaram viram versão |

M4 é o ponto em que a ferramenta passa a valer mais que a planilha. As sessões 16–17 são o que a torna sustentável em escala. M6 é o que dispensa a digitação: enquanto a política nasce fora do PolicyOps, é a carga que mantém as duas pontas coerentes — e a sessão 22 já entrega valor sozinha, porque monta a biblioteca inteira a partir do arquivo.

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
