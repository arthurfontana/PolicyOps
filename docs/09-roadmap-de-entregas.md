# Roadmap de Entregas

40 sessões incrementais — as 17 do MVP, 18–20 pós-MVP (biblioteca de variáveis), 21–25 do épico Carga, 26–31 do épico **Plataforma** (`14-plataforma-local.md`) e 32–40 do épico **Governança de Alterações** (`14-governanca-de-alteracoes.md`, 🔮 planejado). Cada uma termina com algo que roda, testado, commitado, e com `dist/PolicyOps.html` atualizado.

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
| 23 | Tags de matriz, filtro e schema 3 | **Sonnet** | ✅ **Entregue** — schema 3, migração 2→3 puramente aditiva, tags de matriz com facetas de filtro, perfis de carga persistidos | 20 |
| 24 | Aplicação da carga e versionamento seletivo | **Opus** | ✅ **Entregue** — carga aplicada: rascunho só nas alteradas, fila de revisão, perfil salvo, auditoria e idempotência | 22, 23 |
| 25 | Evolução estrutural na carga ✅ | **Opus** | Faixa nova no arquivo vira nova versão de variável adotada no rascunho, sem caminho manual | 24 |
| 26 | Servidor local: núcleo de persistência | **Opus** | `PUT /api/document` com escrita atômica, conflito 409, lock, backups e token — pytest verde contra pasta temporária | — |
| 27 | Modo `SERVER` no front | **Sonnet** | `server-adapter` + detecção de modo; abrir/salvar/conflito/merge rodando ponta a ponta contra o servidor real (E2E) | 26 |
| 28 | Launcher e distribuição | **Sonnet** | `iniciar.bat` + `instalar.bat` (venv + wheels offline) e o pacote `dist/plataforma/` gerado pelo build — dois cliques numa máquina limpa | 27 |
| 29 | Identidade Windows e papéis | **Sonnet** | `whoami` carimba auditoria/saves; `meta.acl` (schema 4) com papéis aplicados na interface e no servidor | 27 |
| 30 | Evidências: acervo navegável | **Opus** | Anexar/abrir/desanexar evidência com hash conferido; acervo legível no Explorer; `attachments` no schema 4 | 27, 29 |
| 31 | Guardrails de contexto e reorganização documental | **Sonnet** | `CLAUDE.md` índice ≤450 linhas com mapa "onde vive o quê", guard mecânico no CI, âncoras nos arquivos grandes | — |
| 32 | Modelo de componentes e schema 5 | **Opus** | `PolicyComponent`/`ComponentVersion`/`ChangeRequest`/`Release` no schema, migração aditiva, invariantes I23–I26, comandos de árvore com inverso — 100% testado, sem tela | 29 |
| 33 | Árvore da política e cadastro de regras | **Sonnet** | Árvore navegável por projeto, CRUD de componente por tipo, versionar/publicar regra com vigência, timeline do componente | 32 |
| 34 | Editor rico de especificação | **Opus** | `RichDoc` de blocos próprios: editar, colar do Word/Excel, imagem-anexo com teto, diff por bloco | 32 |
| 35 | Solicitação de Alteração e workflow | **Sonnet** | Criar DB multi-componente (motivadores, atual×proposto, impactos, critérios, testes), grafo de 12 estados, fila de aprovação, painel de pendências | 33, 34 |
| 36 | Vínculo DB ↔ rascunhos e publicação | **Opus** | Item do DB vincula rascunho (componente ou matriz), congelamento pós-aprovação, publicação atômica com vigência, rebase quando a base mudou | 35 |
| 37 | Release e timeline do Diário de Bordo | **Sonnet** | Release agrupa DBs, publica em lote (reutiliza S36), timeline cronológica dos DBs publicados | 36 |
| 38 | Pacote para a Fábrica | **Sonnet** | HTML imprimível + Markdown gerados do DB, template de boilerplate por projeto | 36 |
| 39 | Fotografia histórica da política | **Opus** | Política inteira (componentes + matrizes) em qualquer data, comparação data A × data B e release × release | 36 |
| 40 | Carga inicial de componentes | **Sonnet** | Importar Markdown estruturado → Identificar → Revisar → Confirmar, com origem preservada e undo total | 33 |

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

> **Sessão 23 entregue.** `schemaVersion: 3` — `migrate.ts` ganha a migração 2→3
> (`importProfiles: []`, puramente aditiva; testada com um `sample-document.json`
> real de v2 e com a cadeia 1→2→3 sobre o fixture de v1). `Matrix.tags` e
> `CatalogItem.group` entram no schema; `matrix/setTags` (idempotente, valida
> I20, inverso exato, evento `MATRIX_TAGGED`), `catalog/create`/`catalog/update`
> aceitam `group`, e `importProfile/save`/`importProfile/delete` gravam
> `ImportProfile` no documento (`src/core/import/profile.ts`, já escrito na S21,
> agora referenciado por `document/schema.ts` — os primitivos de schema saíram
> para `document/primitives.ts` para não fechar um ciclo de import em tempo de
> execução). `listMatrices` filtra por facetas de tag (`OU` no grupo, `E` entre
> grupos, contagem por tag sobre o conjunto antes do filtro do próprio grupo).
> Interface: campo de tags com autocompletar e criação inline no inspector da
> matriz, faixa de filtro por facetas na lista de matrizes com chips e
> contagem filtrada na barra lateral, coluna Grupo editável em linha na aba TAG
> do Conteúdo. O merge de documentos (S17) e a canonicalização de exportação
> (`serialize.ts`) foram estendidos para `importProfiles`/`tags`/`group` na
> mesma sessão, para o build continuar fechando — nenhum dos dois tinha
> cobertura de teste dedicada antes, então o alcance ficou no mínimo necessário
> para manter o documento válido depois de um merge ou de um save.
>
> **Sessão 24 entregue — marco M6 fechado.** `import/apply` (`src/core/import/apply.ts`) compõe os
> comandos existentes para criar as matrizes novas e um rascunho **só** nas alteradas, sem publicar
> nada (RN-10); o passo 5 vira o plano interativo com seleção, filtros e o `CompareView` embutido
> (DEC-CARGA-015), o passo 6 aplica e abre a fila de revisão, e a tela de Rascunhos ganha o filtro
> por `importRunId` com "Publicar revisados" em lote. CT-01, CT-02, CT-10, CT-11, CT-13, CT-14,
> CT-15 e CT-16 verdes, mais o inverso, a atomicidade do lote e os 102 rascunhos do arquivo real
> aplicados em ~800 ms (orçamento de 2 s). O E2E do épico roda a sequência inteira: carga →
> publicação → 5 células alteradas → segunda carga com 1 matriz → terceira carga sem nada a aplicar.
> A S24 foi desenvolvida em paralelo à S23 e dependia do modelo de documento dela
> (`schemaVersion: 3`, `importProfiles`, `Matrix.tags`, `CatalogItem.group`, I20–I22); as duas
> convergiram nesta branch.
>
> A sessão 17 acumula três frentes. Se ficar grande, quebre em 17a (templates), 17b (merge de documentos) e 17c (export e polimento) — o prompt já vem dividido nessas três partes, com critérios de aceite independentes.

> **Sessões 21–25 são o épico Carga** ([`12-carga-de-matrizes.md`](12-carga-de-matrizes.md), decisões `DEC-CARGA-*` em [`13-decisoes.md`](13-decisoes.md)), nascido do caso real de trazer a extração `CINEMINHA` (6.678 linhas → 102 matrizes) para dentro do documento e mantê-la atualizada mês a mês. Dependem do diff (14) e, para o passo de biblioteca, do que as sessões 19–20 já entregaram. **23 é independente das demais** — tags e migração de schema não dependem do motor de carga — e pode ser executada em paralelo com 21/22.

> **Sessões 26–31 são o épico Plataforma** ([`14-plataforma-local.md`](14-plataforma-local.md),
> decisões ADR-001 a ADR-006 em [`13-decisoes.md`](13-decisoes.md)): o servidor Python local por
> usuário que substitui a estratégia SharePoint/FSA — salvamento direto na pasta de rede em
> qualquer navegador, identidade Windows com papéis e evidências anexadas às políticas. A ordem
> 26 → 27 → 28 fecha o marco M7 e **precede qualquer evolução funcional nova**, inclusive o épico
> de Governança de Alterações: funcionalidade nova nasce já sobre a plataforma, e é por isso que
> este épico foi priorizado antes na ordem de execução. A **S31 é independente** e recomendada o
> quanto antes — ela barateia todas as sessões seguintes. A S29 e a S30 dependem do modo `SERVER`
> (27); a S30 usa a identidade da 29 para carimbar quem anexou.

> **Sessões 32–40 são o épico Governança de Alterações** ([`14-governanca-de-alteracoes.md`](14-governanca-de-alteracoes.md), decisões `DEC-GOV-*` em [`13-decisoes.md`](13-decisoes.md), 🔮 planejado): a política inteira como árvore de componentes versionados, o Diário de Bordo como Solicitação de Alteração estruturada com workflow, releases e Pacote para a Fábrica gerado. Nasceu com numeração própria (26–34) numa sessão de especificação separada da do épico Plataforma e foi renumerado para 32–40 ao consolidar as duas — inclusive o schema, que sai de `schemaVersion: 4` para `schemaVersion: 5` porque a 4 já é do épico Plataforma (`meta.acl`, S29; ver DEC-GOV-009). A ordem recomendada prioriza valor cedo: 32 → 33 → 40 (a árvore já carregada com a política real) → 34 → 35 → 36 → 37/38 (paralelizáveis) → 39. As perguntas abertas do §12 de `14-governanca-de-alteracoes.md` devem ser fechadas antes das sessões que as citam.

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

**26** é Opus: é a camada onde perda de trabalho é o modo de falha — escrita atômica em pasta de
rede, detecção de conflito e lock são o mesmo perfil de risco que justificou Opus na sessão 05,
agora num runtime novo (Python) sem a rede de segurança do código existente.

**27 e 28** são Sonnet: o 27 transcreve um contrato fechado (`StorageAdapter` +
`14-plataforma-local.md` §4) para um terceiro adapter com a suíte de contrato já existente como
gabarito; o 28 transcreve um padrão de launcher/instalação **já validado em produção** no
AppCreditoSimulador (ADR-005) — composição, não invenção.

**29** é Sonnet: migração de schema puramente aditiva (`meta.acl`, mesmo perfil da S23) e
composição de telas sobre papéis já especificados em `14-plataforma-local.md` §6. A válvula de
escape ("pare e pergunte") cobre qualquer decisão de enforcement não documentada.

**30** é Opus: evidência de auditoria tem perda de trabalho e corrupção silenciosa como modos de
falha — cópia parcial em rede instável, colisão de nomes, vínculo apontando para arquivo errado,
hash divergente. Errar aqui destrói exatamente o valor probatório que justifica a feature.

**31** é Sonnet: reorganização documental é mecânica na execução, mas decidir **o que** vive em
cada camada exige julgamento sobre o conteúdo — acima de Haiku, sem risco de invariante que
pedisse Opus.

**32, 34, 36 e 39** são Opus: a 32 desenha o schema e as invariantes que todo o épico Governança
herda (erro aqui corrompe dados em silêncio, o perfil de 03/12/16); a 34 tem perda de trabalho do
usuário como modo de falha (texto longo digitado num editor próprio) e serialização que precisa
nascer estável; a 36 é o coração da governança — congelamento, publicação atômica e rebase, a
mesma matemática de borda de 04/05/24; a 39 é comparação semântica sobre duas fontes (componentes
+ matrizes) onde falso negativo apaga evidência de mudança, o perfil da 14/21.

**33, 35, 37, 38 e 40** são Sonnet: composição de telas e CRUD sobre contratos que
`14-governanca-de-alteracoes.md` e a S32 já fecham (árvore, formulários do DB, grafo de estados
transcrito, release, geração de documento derivado, parser de Markdown convencionado). Vale a
válvula de escape de sempre: decisão de arquitetura não coberta pela documentação → **parar e
perguntar**.

## Marcos utilizáveis

| Marco | Após | O que já dá para fazer |
|---|---|---|
| **M1 — Roda e salva** | 05 | Abrir o `.html` do SharePoint, criar documento, salvar, reabrir. Sem funcionalidade de matriz, mas a fundação existe |
| **M2 — Bibliotecas prontas** | 08 | Cadastrar as variáveis, as compatibilidades e as ofertas reais da empresa |
| **M3 — Editor funcionando** | 11 | Montar as matrizes de verdade, inclusive aninhadas, e editá-las |
| **M4 — Substitui o Excel** | 15 | Fonte oficial: versionar, publicar, comparar, consultar por data |
| **M5 — MVP completo** | 17 | Escala: evolução da biblioteca, templates, merge, exportação |
| **M6 — Carga em produção** | 24 | A extração mensal entra por arquivo: 102 matrizes carregadas na primeira vez, e nas seguintes só as que mudaram viram versão |
| **M7 — Plataforma no ar** | 28 | Dois cliques no `iniciar.bat`: salvar direto na pasta de rede, conflito e lock funcionando, em qualquer navegador. Fim dos downloads |
| **M8 — Identidade amarrada** | 29 | Auditoria e saves carimbados com o login de rede; papéis controlam quem edita e quem publica |
| **M9 — Evidências anexadas** | 30 | DBs e ofícios anexados a projeto, matriz ou versão, com integridade por hash e acervo navegável no Explorer |
| **M10 — Política estruturada** | 40 | A política inteira (não só matrizes) vive na ferramenta: árvore navegável, regras versionadas com vigência, carga inicial feita a partir da documentação real |
| **M11 — DB estruturado** | 36 | O Diário de Bordo deixa o Word: solicitação com atual×proposto, aprovação registrada e publicação com vigência amarrada às versões |
| **M12 — Governança completa** | 39 | Release, Pacote para a Fábrica gerado e a pergunta "qual era a política vigente em 15/05?" respondida em dois cliques |

M4 é o ponto em que a ferramenta passa a valer mais que a planilha. As sessões 16–17 são o que a torna sustentável em escala. M6 é o que dispensa a digitação: enquanto a política nasce fora do PolicyOps, é a carga que mantém as duas pontas coerentes — e a sessão 22 já entrega valor sozinha, porque monta a biblioteca inteira a partir do arquivo. M7 é o que resolve a causa raiz da arquitetura original nunca ter funcionado no ambiente real. M10–M12 tiram o Diário de Bordo do Word: a política inteira, não só as matrizes, passa a viver e a ser rastreada dentro do PolicyOps.

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
