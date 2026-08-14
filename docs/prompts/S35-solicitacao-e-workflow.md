# Sessão 35 — Solicitação de Alteração (DB) e workflow

**Modelo:** `Sonnet` · **Depende de:** S32b, S33b, S34 · **Épico/Marco:** Governança (M11)

> **Por que Sonnet:** a máquina de estados, as validações e os comandos vieram prontos da S32b; o
> editor rico, da S34. Esta sessão transcreve o grafo e os formulários de `docs/14` §3.3–§5 em
> telas — CRUD e composição, sem invariante nova.

> **Atenção à ordem:** a S32b (núcleo de DB, release e workflow) foi separada da S32a quando a
> carga da política foi antecipada (DEC-GOV-010). Ela **não** é opcional e **não** foi executada
> na trilha antecipada — confirme que está entregue antes de começar esta sessão.

## Prompt

> Você está implementando a Sessão 35 do PolicyOps — o Diário de Bordo como Solicitação de
> Alteração estruturada, com workflow e fila de aprovação.
>
> **Leia antes de começar:** `docs/14-governanca-de-alteracoes.md` §3.3, §4 (US-GOV-03/04/10), §5
> (grafo — normativo), §6 (RN-GOV-01/02/03/04) e §12 (perguntas 1 e 2 — se ainda estiverem
> abertas, **pare e pergunte antes de implementar numeração e papéis**); DEC-GOV-003/004.
>
> ### Estado atual
> S32a: schema 5 e componentes versionados. S32b: `ChangeRequest`, `Release`, comandos de
> transição/aprovação e erros E-GOV testados. S33a/S33b: árvore de componentes com versão vigente
> consultável, **com a política real já cadastrada** (à mão na S33b e, se a S40 tiver sido
> executada, também por recorte). S34: `RichDocEditor` pronto para
> reuso. Nenhuma tela de DB existe.
>
> ### Objetivo
> O analista cria, documenta e submete um DB multi-componente; o gestor revisa numa fila e
> aprova/devolve/rejeita com registro — e todos veem suas pendências ao abrir o documento.
>
> ### Escopo
> 1. **Lista de DBs** por projeto: código, título, status (badge por estado), prioridade,
>    solicitante, filtros por status/prioridade/componente. Numeração sugerida sequencial a
>    partir do maior `DB-<n>` existente, editável (I26).
> 2. **Criação/edição do DB** (US-GOV-03): motivadores (catálogo `MOTIVATOR` + criação inline,
>    como as tags da S23), itens com seleção de componente na árvore — `currentSummary`
>    pré-preenchido da versão vigente, `proposedSummary` obrigatório —, impactos
>    (`IMPACT_CATEGORY` + texto), critérios de aceite (Dado/Quando/Então, incentivado, não
>    imposto), cenários de teste, vigência proposta, `spec` e `motivationText` com o
>    `RichDocEditor`.
> 3. **Workflow na tela**: ações visíveis conforme o estado (grafo §5), submissão validando
>    RN-GOV-03 com mensagens do catálogo E-GOV; trilha de eventos do DB visível.
> 4. **Fila de aprovação** (US-GOV-04): submetidos/em revisão, abrir a especificação completa,
>    atual × proposto por item (texto a texto nesta sessão; diff rico é a S36), decisão com
>    comentário (obrigatório na devolução).
> 5. **Painel de pendências** (US-GOV-10) na tela inicial do documento: aguardando revisão,
>    devolvidos, aprovados sem release, filtro "meu nome". Deixe claro na UI que papéis são
>    declarativos (DEC-GOV-004).
>
> ### Testes
> Unit (jsdom): submissão bloqueada sem motivador/item/vigência; ações por estado; devolução exige
> comentário. E2E: CT-GOV-02 (aprovar não publica) e o caminho DRAFT→…→APPROVED do CT-GOV-01.
>
> ### Critérios de aceite
> - Reproduzir o DB-515 real (goodlist) na ferramenta: motivador, item sobre a regra Goodlist com
>   "hoje" vindo da versão vigente, proposto, critérios de aceite e vigência — submetido e
>   aprovado com trilha completa.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes; 1,5 MB ok;
>   `dist/PolicyOps.html` no commit.
>
> ### Fora do escopo
> Vincular rascunhos e publicar (S36 — o botão existe desabilitado com tooltip), release (S37),
> pacote (S38).
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/07-ux-e-editor.md` (telas de DB, fila, pendências),
> `docs/14-governanca-de-alteracoes.md` (US-GOV-03/04/10 ✅; respostas das perguntas 1–2
> incorporadas ao texto), `docs/13-decisoes.md`, linha da S35 em `docs/09`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → pare e pergunte.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
