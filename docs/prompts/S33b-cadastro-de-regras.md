# Sessão 33b — Cadastro e versionamento de regras

**Modelo:** `Sonnet` · **Depende de:** S33a · **Épico/Marco:** Governança (M10)
· **Trilha antecipada:** 3 de 3 (32a → 33a → 33b) — **Lote 3: Conteúdo**

> **Por que Sonnet:** formulários por tipo e ciclo de vida sobre comandos que a S32a fechou e
> telas que a S33a montou. Sem invariante nova; o padrão de publicação é o das matrizes (S13).

> **Esta é a sessão que faz o produto valer sozinho.** Ao fim dela a política vigente existe dentro
> da ferramenta, digitada a partir do documento real. Depois dela vem um **ponto de parada
> deliberado** (DEC-GOV-012): o usuário usa, e só então decidimos `sectionKind`, nó de referência,
> acelerador de matriz e se a carga por recorte (S40) vale.

> **Cadastrar em volume é o caso de uso, não o caso de borda.** São ~50 regras a digitar a partir
> do Word. Se o fluxo for "abrir diálogo, preencher, salvar, voltar", a sessão falhou mesmo com
> todos os testes verdes.

## Prompt

> Você está implementando a Sessão 33b do PolicyOps — o cadastro estruturado dos componentes da
> política e o versionamento deles com vigência.
>
> **Leia antes de começar:** `docs/07-ux-e-editor.md` §17.3, §17.4, §17.5 (normativo desta sessão),
> §10 (padrão visual da timeline); `docs/14-governanca-de-alteracoes.md` §3.2 (payloads), §4
> (US-GOV-02), §6 (RN-GOV-06, RN-GOV-07, RN-GOV-09, I27), §9.1 (a anatomia do documento real);
> `docs/05-regras-de-negocio.md` §1 (publicação de matriz — o padrão a espelhar); DEC-GOV-011, 012.
>
> ### Estado atual
> A S33a entregou a árvore navegável, o CRUD estrutural, os nós MATRIX e o inspector mínimo, com
> os campos de payload e as ações de versão desabilitados. A S32a entregou `componentVersion/*`
> com inverso e o campo `Project.foundationEffectiveFrom`, sem consumidor. Nada de DB, release ou
> editor rico existe (S32b/S35/S34).
>
> ### Objetivo
> O usuário transcreve o documento de política para dentro da ferramenta e publica tudo com a
> vigência da fundação — e, a partir daí, cada mudança vira versão nova com lastro.
>
> ### Escopo
> 1. **Inspector por tipo** (§17.5): formulário do `RulePayload` (descrição de negócio, definição
>    técnica, entradas, condições, resultado, reason codes, dependências, notas) e os payloads de
>    `LIST`, `REASON_CODE`, `POLICY_VARIABLE` e `OTHER`. `POLICY_VARIABLE` com `variableId` mostra
>    a variável espelhada **sem duplicar domínios**, com link para a Biblioteca. Campo `spec`
>    aparece como placeholder somente leitura ("editor na S34") — não implemente o editor.
> 2. **Seção documentável** (I27): ação secundária **"Documentar esta seção"** cria a primeira
>    versão de uma `SECTION`, que passa a ter texto, vigência e timeline como qualquer outra. Sem
>    a ação, a seção continua sendo pasta pura e **não** aparece como "sem política vigente".
> 3. **Ciclo de vida na tela**: criar rascunho, editar, publicar (mesmo diálogo-padrão das
>    matrizes, `effectiveFrom` obrigatório e nota), descartar. Publicação direta exibe o aviso da
>    RN-GOV-07 — **uma vez por lote**, não uma vez por item.
> 4. **Vigência da fundação** (§17.4, RN-GOV-09): campo nas propriedades do projeto; primeira
>    versão de componente novo já nasce apontando essa data; ação **"Publicar pendentes"** na
>    árvore, com desmarcação item a item, publicando em lote — tudo ou nada (RN-GOV-05).
> 5. **Entrada em volume** (§17.3): colar um bloco de texto no inspector e reconhecer por prefixo
>    de linha — parágrafo solto → `businessDescription`; `Definição técnica:` → `technicalDefinition`;
>    `Observação:` → reason codes + resultado + notas. **Sem parser de Markdown e sem lib**: é
>    reconhecimento de prefixo sobre o formato do documento de origem, com preview antes de aplicar.
> 6. **Timeline do componente**: versões com intervalo de vigência, autor e origem (o campo de DB
>    aparece quando existir), no padrão visual da timeline de matriz (S13/S15).
>
> ### Testes
> Unit (jsdom): publicar exige vigência; publicar em lote é tudo-ou-nada; seção sem versões não
> entra na consulta de vigência; o reconhecimento de bloco colado cobre o formato real (com e sem
> `Observação:`, com reason code múltiplo, com linha vazia no meio). E2E: criar regra → publicar →
> criar v2 → timeline mostra as duas com vigências corretas (CT-GOV base da US-GOV-02).
>
> ### Critérios de aceite
> - **Digitar as 15 regras do capítulo 4.2 (Regras Duras / C.M.A) do documento real** — com
>   definição técnica, reason code e resultado — **e publicá-las em uma sessão de trabalho**, sem
>   diálogo modal por regra. Este é o critério que decide se a sessão está pronta.
> - Cadastro da amostra do épico (Decisões Soberanas → Goodlist; Regras Duras → Dívida > 5k)
>   navegável e versionável de ponta a ponta.
> - Nenhuma regressão nos E2E atuais.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes; 1,5 MB ok;
>   `dist/PolicyOps.html` no commit.
>
> ### Fora do escopo
> Editor rico (S34), DB/workflow (S35+), publicação via DB ou release (S36), fotografia histórica
> (S39), carga por recorte (S40). E o que `docs/14` §3.6 adia.
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/07-ux-e-editor.md` §17.3–§17.5, `docs/14-governanca-de-alteracoes.md`
> (US-GOV-01/02 ✅, RN-GOV-09 conforme implementada), `docs/05-regras-de-negocio.md` (vigência de
> componente), `docs/13-decisoes.md`, linha da S33b em `docs/09`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → pare e pergunte.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
