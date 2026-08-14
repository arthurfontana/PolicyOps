# Roadmap de Entregas

40 sessões incrementais — as 17 do MVP, 18–20 pós-MVP (biblioteca de variáveis), 21–25 do épico Carga, 26–31 do épico **Plataforma** (`14-plataforma-local.md`) e 32–40 do épico **Governança de Alterações** (`14-governanca-de-alteracoes.md`, 🔮 planejado; a 32 foi dividida em **32a**/**32b** e a 33, em **33a**/**33b** — DEC-GOV-010 e DEC-GOV-012). Cada uma termina com algo que roda, testado, commitado, e com `dist/PolicyOps.html` atualizado.

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
| 26 | Servidor local: núcleo de persistência | **Opus** | ✅ **Entregue** — `server/policyops_server.py` (FastAPI, `127.0.0.1`, token por boot): `GET/PUT /api/document` com escrita atômica e conflito 409, lock consultivo com 423, backups com rotação de 20, `whoami` e `health`; 55 testes pytest contra pasta temporária | — |
| 27 | Modo `SERVER` no front | **Sonnet** | ✅ **Entregue** — `server-adapter` + detecção de modo (`localServer`); abrir/salvar/conflito/merge rodando ponta a ponta contra o servidor real (E2E) | 26 |
| 28 | Launcher e distribuição | **Sonnet** | `iniciar.bat` + `instalar.bat` (venv + wheels offline) e o pacote `dist/plataforma/` gerado pelo build — dois cliques numa máquina limpa | 27 |
| 29 | Identidade Windows e papéis | **Sonnet** | `whoami` carimba auditoria/saves; `meta.acl` (schema 4) com papéis aplicados na interface e no servidor | 27 |
| 30 | Evidências: acervo navegável | **Opus** | ✅ **Entregue** — anexar/abrir/desanexar evidência com hash conferido; acervo legível no Explorer; `attachments` no schema 4 | 27, 29 |
| 31 | Guardrails de contexto e reorganização documental | **Sonnet** | ✅ **Entregue** — `CLAUDE.md` índice ≤450 linhas com mapa "onde vive o quê", guard mecânico no CI, âncoras nos arquivos grandes | — |
| 32a | Núcleo de componentes e schema 5 | **Opus** | `schemaVersion: 5` inteiro (uma migração aditiva), `PolicyComponent`/`ComponentVersion`, invariantes I23–I24, comandos de árvore e de versão com inverso — 100% testado, sem tela | 29 |
| 32b | DB, release e workflow (núcleo) | **Opus** | Comandos de `ChangeRequest`/`Release`, grafo de 12 estados, aprovações, I25–I26 — sem tela. **Pré-requisito da 35**, não da 33/40 | 32a |
| 33a | Árvore da política (esqueleto) | **Sonnet** | Árvore como tela do projeto: criar/renomear/mover/arquivar seção, nó MATRIX apontando matriz existente, busca, facetas, contagens, breadcrumb, inspector mínimo. Sem payload de regra e sem ciclo de vida | 32a |
| 33b | Cadastro e versionamento de regras | **Sonnet** | Formulário por tipo (`RulePayload` e demais), rascunho/publicar com vigência, timeline, ergonomia de entrada em volume, vigência da fundação e publicação em lote | 33a |
| 34 | Editor rico de especificação | **Opus** | `RichDoc` de blocos próprios: editar, colar do Word/Excel, imagem-anexo com teto, diff por bloco | 32a |
| 35 | Solicitação de Alteração e workflow | **Sonnet** | Criar DB multi-componente (motivadores, atual×proposto, impactos, critérios, testes), grafo de 12 estados na tela, fila de aprovação, painel de pendências | 32b, 33, 34 |
| 36 | Vínculo DB ↔ rascunhos e publicação | **Opus** | Item do DB vincula rascunho (componente ou matriz), congelamento pós-aprovação, publicação atômica com vigência, rebase quando a base mudou | 35 |
| 37 | Release e timeline do Diário de Bordo | **Sonnet** | Release agrupa DBs, publica em lote (reutiliza S36), timeline cronológica dos DBs publicados | 36 |
| 38 | Pacote para a Fábrica | **Sonnet** | HTML imprimível + Markdown gerados do DB, template de boilerplate por projeto | 36 |
| 39 | Fotografia histórica da política | **Opus** | Política inteira (componentes + matrizes) em qualquer data, comparação data A × data B e release × release | 36 |
| 40 | Carga da política por recorte 🟡 | **Sonnet** | Importar um capítulo em Markdown **dentro da seção escolhida** → Revisar → Confirmar, com origem preservada e undo total. **Opcional**: só se a digitação virar o gargalo depois da 33b (DEC-GOV-012) | 32a, 33a, 33b |

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

> **Sessão 26 entregue.** `server/policyops_server.py` (≈600 linhas, FastAPI) sobe em `127.0.0.1`
> numa porta livre de 8770–8799, serve o `PolicyOps.html` sem cache e expõe a API v1:
> `health`/`whoami`, `GET/PUT /api/document` com hash SHA-256, conflito `409` que **não grava** e
> escrita atômica (`.tmp` + `fsync` + `os.replace`), lock consultivo no mesmo `{nome}.lock.json` do
> modo `FULL` (`423` para o segundo usuário, obsoleto aos 10 min), backup do conteúdo anterior a
> cada save com rotação de 20 e `GET /api/backups`. Token aleatório por boot em
> `X-PolicyOps-Token` (401 sem ele; só `/api/health` dispensa) e `X-PolicyOps-Api: 1` em toda
> resposta. 55 testes pytest (`server/tests/`, rodando contra `tmp_path`) cobrem o bloco de
> servidor de `14-plataforma-local.md` §11 exceto papéis (S29) e evidências (S30). Nenhuma linha de
> TypeScript mudou; os ajustes finos de contrato descobertos aqui estão em `14` §4 e em
> DEC-PLAT-001.

> **Sessão 27 entregue.** `capabilities.ts` ganhou o terceiro estágio (assíncrono, depois dos dois
> síncronos de sempre): token por `?t=` na URL — guardado em `sessionStorage`, removido da barra de
> endereço via `history.replaceState` — mais `GET /api/health` com `X-PolicyOps-Api` compatível.
> API mais nova que a do front vira aviso na tela inicial (`degraded`), nunca "tentar mesmo assim".
> `server-adapter.ts` implementa `StorageAdapter` sobre `fetch`: `open()`/`save()` conversam com
> `GET`/`PUT /api/document`, `409` vira `CONFLICT` (com o `remoteHash` guardado para "sobrescrever
> mesmo assim"/"mesclar" — diferente do modo `FULL`, o `force` do servidor só destrava o lock, nunca
> ignora o `baseHash`, então um conflito repetido continua voltando `409`), erro de rede vira `IO`
> perguntando se o servidor caiu, e `saveAs`/`openFromDrop`/recentes ficam indisponíveis (arquivo
> fixo pela pasta). `lock.ts` ganhou `ApiAdvisoryLock`, atrás da porta comum `AdvisoryLockPort` —
> mesmo `{nome}.lock.json`, `423` vira `HELD` no mesmo formato do modo `FULL`. Identidade resolvida
> por `GET /api/whoami` (ADR-003): sem diálogo "como você quer ser identificado?", tela inicial
> pulada quando o documento da pasta abre direto. 51 testes de unidade novos (contrato do
> `server-adapter` com servidor falso via `fetch` mockado, `ApiAdvisoryLock`, terceiro estágio de
> `capabilities` — suíte total 1.353 → 1.404) mais 5 E2E que sobem o servidor real da S26 contra
> pasta temporária: abrir → editar → salvar → reabrir → conflito simulado (gravação externa no
> arquivo) → mesclar, além de bootstrap sem arquivo e servidor caindo no meio da edição.
> DEC-PLAT-002 registra o refinamento do
> `force` e a mensagem nova de `423` na defesa em profundidade do `PUT` (mapeada para `PERMISSION`,
> não uma variante nova de `SaveResult`).

> **Sessão 28 entregue — marco M7 fechado.** `server/instalar.bat` localiza `py -3`/`python`, cria
> `server/.venv/` e instala `requirements.txt` linha a linha tentando o índice pip primeiro e as
> wheels offline de `server/wheels/` na falha, com resumo final em português (quantas foram pelo
> índice, quantas pelas wheels, quantas falharam) — nunca toca o Python do sistema.
> `server/iniciar.bat` usa o Python do venv se existir (senão orienta a rodar `instalar.bat`, lembra
> o plano B do duplo clique no `.html`, e sai sem travar nem instalar nada), sobe
> `server/launcher.py` com `--data-dir ".."` (o pai de `_app/`, docs/14 §9). `launcher.py` é código
> novo, não um `.bat` mais esperto: reaproveita `policyops_server.prepare()` (extraído de `main()`
> nesta sessão, mesmo comportamento) e sobe o `uvicorn` numa thread do próprio processo — fechar a
> janela ou `Ctrl+C` derruba servidor e thread juntos, sem processo órfão — em vez de um
> subprocesso, para não precisar reconstruir por *parsing* de stdout o que já dá para chamar direto
> em Python. `wait_for_health()` faz o polling do `/api/health` antes de abrir o navegador
> (`webbrowser.open`), com timeout generoso sobre a meta de 8 s de `14` §10. No caminho, ficou claro
> um gap real da S26: `resolve_html_path()` só procurava o `PolicyOps.html` ao lado do script ou em
> `dist/` — nunca no layout publicado de verdade (`_app/PolicyOps.html`, um nível acima de
> `_app/server/`) — corrigido com um terceiro caminho de busca (DEC-PLAT-003).
> `scripts/fetch-wheels.mjs` baixa as wheels Windows x64 pinadas em `requirements.txt` (agora com
> versão fixa — a mais recente de cada uma que ainda roda em Python 3.9) para 5 versões de Python
> (3.9–3.13, cobrindo o parque), via `pip download --platform win_amd64 --only-binary=:all:`; não é
> commitado (`.gitignore`), documentado no `LEIAME.txt` do pacote. `pnpm build:plataforma` monta
> `dist/plataforma/` (`iniciar.bat`, `instalar.bat`, `PolicyOps.html`, `server/` com código +
> `requirements.txt` + `wheels/` + `LEIAME.txt`); `pnpm check:plataforma` confere que nada falta e
> que nenhum arquivo do pacote cita caminho absoluto da máquina de build. 8 testes pytest novos
> (porta ocupada, `config.json` sobrescrevendo `--data-dir`, `wait_for_health` com servidor real de
> teste, o layout `_app/` de verdade) — suíte do servidor 55 → 63. Roteiro manual completo (venv
> real, `pip install` do índice e via `--no-index --find-links`, `launcher.py` de ponta a ponta:
> health → navegador → salvar → reabrir → `Ctrl+C` limpo) documentado no PR.

> **Sessão 29 entregue — marco M8 fechado.** `schemaVersion: 4`: `meta.acl?` opcional
> (`users: Array<{ username, role }>`, `defaultRole`), migração 3 → 4 puramente aditiva a ponto de
> não escrever nenhum campo (`meta.acl` ausente já é o estado migrado). `resolveRole(doc, username)`
> (`src/core/document/roles.ts`, puro): ACL ausente, vazia, ou populada sem nenhum `ADMIN` é modo
> aberto (`isOpenMode`, todo mundo `PUBLISHER`); listado, o papel da lista; não listado,
> `defaultRole`. O gate central fica no `dispatch` de `document-store.ts` — nunca em `execute`,
> `undo` nem `redo` —, comparando `minRoleForCommand(command.type)` contra o papel efetivo antes de
> rodar qualquer comando, com uma exceção estreita para `acl/set` em modo aberto poder criar o
> primeiro `ADMIN` (DEC-PLAT-004). Comando novo `acl/set` substitui `meta.acl` inteira, recusa
> (`ACL_REQUIRES_ADMIN`) ficar sem nenhum `ADMIN`, e gera `ACL_CHANGED` com `{ before, after }`. No
> servidor, `resolve_effective_role()` deriva o papel de `meta.acl` lido direto do disco
> (defensivo — arquivo ilegível cai em modo aberto) a cada chamada de `whoami` e de `PUT
> /api/document`, que passa a recusar com `403 FORBIDDEN` quem tem papel efetivo `READER` — antes
> de qualquer outra checagem. A tela `#/acl` (atrás de `ADMIN`, e liberada em modo aberto para o
> bootstrap) lista usuários e `defaultRole`, trava o botão de salvar se a lista ficaria sem `ADMIN`,
> e mostra o texto honesto de `14` §6 ("organização, não segurança"). A identidade estruturada
> (`{ username, source: 'windows' | 'typed' }`) vive em `document-store.identity`, separada do
> `actor` de exibição — corrige um gap real do S27: `savedBy`/lock já usavam o login resolvido por
> `whoami`, mas `DocEvent.actor`/`createdBy` ainda vinham do nome digitado em `localStorage`, mesmo
> no modo `SERVER`. 41 testes de unidade novos (`resolveRole`/gate por linha da tabela de papéis,
> migração 3→4 com fixture real, `checkI23`/`checkI24`) mais 11 pytest (`whoami` com ACL
> ausente/vazia/populada/sem ADMIN, `403` para `READER`, `403` antes do hash) e 1 E2E que sobe o
> servidor real com uma ACL definindo o usuário do SO como `READER` e confirma as duas camadas.

> **Sessão 30 entregue — marco M9 fechado.** `attachments?` no documento (ainda
> `schemaVersion: 4`: campo novo e opcional é o caso "sem migração" de `03` §10) com `relPath`,
> `sha256`, `addedBy`, `addedAt` e `target` (`PROJECT` | `MATRIX` | `VERSION` pelo **número** da
> versão, que é o que aparece na pasta). Comandos `evidence/attach`/`evidence/detach` com inverso
> exato — o do desanexo restaura o registro inteiro **na posição original**, não um append — e
> eventos `EVIDENCE_ATTACHED`/`EVIDENCE_DETACHED`; invariantes I25 (alvo existe) e I26 (`relPath`
> único, `relPath`/`sha256` não vazios). No servidor, `POST /api/evidences` (multipart, papel
> mínimo `EDITOR`) copia em *streaming* calculando o SHA-256 nos mesmos blocos que vão para o
> disco, grava atômico (`.tmp` + `os.replace`), resolve colisão com ` (2)` e corta em 50 MB com
> `413` sem deixar `.tmp` para trás; `GET` confere o hash **antes** de responder (`409
> HASH_MISMATCH`); `DELETE` move para `_evidencias/_lixeira/` preservando a árvore, idempotente.
> O caminho legível (`{projeto-slug}/{matriz-slug}/v{n}/{AAAA-MM-DD}_{nome original}`) é
> **construído** a partir dos códigos slugificados, não validado a partir de caminho recebido —
> é o que fecha *path traversal* por construção; o `relPath` que volta do documento passa por
> `resolve_under` (segmento `..`, caminho absoluto, letra de unidade, e conferência pós-`resolve`).
> A ida para a lixeira é reconciliada pela camada de persistência **depois** de cada save
> bem-sucedido (comparando o que o documento reivindica com o que a sessão sabe existir no
> acervo), nunca no desanexo: é o que faz `Ctrl+Z` funcionar sem depender de um arquivo que já se
> moveu. Seção "Evidências" no inspector de versão, de matriz e na tela de projeto, desabilitada
> com o motivo fora do modo `SERVER`. 45 testes de unidade novos (comandos com inverso,
> invariantes, append-only sobre versão publicada com deep equal do snapshot, cliente da API,
> reconciliação da lixeira — suíte 1.444 → 1.489), 31 pytest (`_evidencias/` do caminho exato ao
> papel mínimo — 74 → 105) e 2 E2E contra o servidor real: anexar em versão publicada → salvar →
> reabrir → abrir o arquivo → adulterar no disco → a aplicação denuncia; e desanexar/desfazer sem
> tocar no arquivo. DEC-PLAT-005 registra a decisão de o servidor **não** guardar estado do
> acervo (`relPath`/`sha256` vêm do documento em toda chamada) — sem ela, o `DELETE`, que
> acontece depois de o vínculo já ter saído do documento salvo, não teria como resolver o `id`.

> **Sessão 31 entregue.** `CLAUDE.md` reescrito como índice em camadas (114 linhas, teto de 450
> guardado por `pnpm check:claude-md` — `scripts/check-claude-md.mjs`, registrado no CI logo após
> `pnpm install`), com a tabela "Onde vive o quê" cobrindo os 12 domínios pedidos mais 5 extras
> (bibliotecas, templates, consultas, export, governança). `docs/claude/` criado com dois arquivos:
> `Mapa-de-regioes.md` (índice das âncoras) e `Convencoes-de-sessao.md` (comandos de fechamento,
> contrato dos adapters, fixtures canônicas) — nada duplicado de `docs/01..14`, só ponteiro. Os 17
> arquivos de `src/` acima de ~600 linhas (`merge/documents.ts`, `validate.ts`, `lifecycle.ts`,
> `Grid.tsx` e mais 13) ganharam 126 âncoras `// #region: <slug>` grep-áveis — puramente aditivo,
> nenhuma linha de código movida ou alterada (confirmado por `git diff --stat`: só `+`), suíte de
> 1.353 testes e `lint`/`typecheck` verdes sem tocar. Padrão da âncora documentado em ADR-007.
> `docs/prompts/README.md` ganhou a nota de higiene de prompts (G6).

> **Sessões 32–40 são o épico Governança de Alterações** ([`14-governanca-de-alteracoes.md`](14-governanca-de-alteracoes.md), decisões `DEC-GOV-*` em [`13-decisoes.md`](13-decisoes.md), 🔮 planejado): a política inteira como árvore de componentes versionados, o Diário de Bordo como Solicitação de Alteração estruturada com workflow, releases e Pacote para a Fábrica gerado. Nasceu com numeração própria (26–34) numa sessão de especificação separada da do épico Plataforma e foi renumerado para 32–40 ao consolidar as duas — inclusive o schema, que sai de `schemaVersion: 4` para `schemaVersion: 5` porque a 4 já é do épico Plataforma (`meta.acl`, S29; ver DEC-GOV-009). As perguntas abertas do §12 de `14-governanca-de-alteracoes.md` devem ser fechadas antes das sessões que as citam.
>
> **Ordem de execução do épico (DEC-GOV-010, revista pela DEC-GOV-012)** — o objetivo continua sendo ter a política real dentro da ferramenta antes de investir no resto do épico, mas o caminho mudou: a primeira versão é **construída à mão, incrementalmente**, e não importada de uma vez. A antiga 33 virou **33a** (esqueleto) + **33b** (regras), e a carga (40) virou opcional e por recorte:
>
> ```
> 32a → 33a → 33b → ⟨uso real: a política as-is entra à mão; rota se ajusta aqui⟩
>   → 40 (opcional) → 34 → 32b → 35 → 36 → 37/38 (paralelizáveis) → 39
> ```
>
> O ponto de parada depois da 33b é o que torna a correção de rota barata: são três sessões, e tudo o que o usuário cadastrar ali sobrevive a qualquer decisão posterior, porque o resto do épico **lê** essas entidades em vez de redefini-las. A **32b não é opcional**: sem ela a 35 não tem comandos para chamar. Converter o Word em Markdown (`14-governanca-de-alteracoes.md` §9.1) não depende de código e vale desde já — serve para digitar bloco a bloco na 33b, mesmo que a 40 nunca seja executada.

### Lotes para colocar a política as-is

O que executar, em ordem, para sair de "a política vive no Word" e chegar em "a política vive na
ferramenta". Cada lote termina com algo que o usuário **usa** no mesmo dia:

| Lote | Sessões | O que você consegue fazer ao fim |
|---|---|---|
| **1 — Fundação** | 32a | Nada visível: schema 5, componentes, versões e comandos testados. É a base que não dá para pular |
| **2 — Esqueleto** | 33a | Montar a hierarquia inteira da política (capítulos, temas) e pendurar as matrizes já importadas. **Aqui você já julga se o modelo de hierarquia está certo** — antes de existir formulário de regra |
| **3 — Conteúdo** | 33b | Digitar as regras com definição técnica, reason code e resultado, e publicar tudo com a vigência da fundação. A política vigente passa a existir na ferramenta |
| **⏸ Parada** | — | Uso real. Decidir: `sectionKind`, referências como nó, acelerador de matriz, e se a 40 vale |
| **4 — Aceleração** (opcional) | 40 | Subir capítulos convertidos em Markdown dentro da seção escolhida, em recortes |
| **5 — Governança** | 34 → 32b → 35 → 36 → 37/38 → 39 | Editor rico, Diário de Bordo, publicação com vigência, release, pacote e fotografia histórica |

Enquanto o lote 1 roda, o único trabalho paralelo que vale é converter o Word em Markdown com o
prompt de `14-governanca-de-alteracoes.md` §9.1 — ele é a fonte de onde o texto será colado na
etapa 3, com ou sem a sessão 40.

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

**32a, 32b, 34, 36 e 39** são Opus: a 32a desenha o schema e as invariantes de árvore que todo o
épico Governança herda e a 32b, o grafo de estados e o congelamento que a publicação usa (erro
nas duas corrompe dados em silêncio, o perfil de 03/12/16); a 34 tem perda de trabalho do
usuário como modo de falha (texto longo digitado num editor próprio) e serialização que precisa
nascer estável; a 36 é o coração da governança — congelamento, publicação atômica e rebase, a
mesma matemática de borda de 04/05/24; a 39 é comparação semântica sobre duas fontes (componentes
+ matrizes) onde falso negativo apaga evidência de mudança, o perfil da 14/21.

**33, 35, 37, 38 e 40** são Sonnet: composição de telas e CRUD sobre contratos que
`14-governanca-de-alteracoes.md` e as S32a/S32b já fecham (árvore, formulários do DB, grafo de estados
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
| **M10 — Política estruturada** | 33b | A política inteira (não só matrizes) vive na ferramenta: árvore navegável, matrizes existentes posicionadas nela, regras versionadas com vigência. É o **primeiro** marco do épico e são três sessões (32a → 33a → 33b); a política as-is entra à mão, incrementalmente, e a carga por recorte (40) é aceleração opcional depois disso (DEC-GOV-012) |
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
