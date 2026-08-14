# Sessão 36 — Vínculo DB ↔ rascunhos e publicação com vigência

**Modelo:** `Opus` · **Depende de:** S35 · **Épico/Marco:** Governança (M11)

> **Por que Opus:** é o coração da governança — congelamento pós-aprovação, publicação atômica
> multi-entidade (componentes **e** matrizes na mesma operação) e rebase quando a versão-base
> mudou por baixo. Falha aqui publica política errada ou apaga o lastro entre o que foi aprovado
> e o que entrou em vigor: o perfil das S04/S05/S24.

## Prompt

> Você está implementando a Sessão 36 do PolicyOps — o vínculo entre itens de DB e rascunhos, e a
> publicação de um DB com vigência.
>
> **Leia antes de começar:** `docs/14-governanca-de-alteracoes.md` §3.3, §5, §6 (RN-GOV-04/05/06 e
> I25), §10 (CT-GOV-01/02/03/04/06), §12 pergunta 4 (vigência retroativa — se aberta, pare e
> pergunte); DEC-GOV-002/003; `docs/05-regras-de-negocio.md` §1 (publicação de matriz).
>
> ### Estado atual
> S35 entregou o DB completo até `APPROVED`, sem vínculo com versões. Rascunhos de componente
> (S32a/S33) e de matriz (mecanismo original) existem e publicam individualmente. `import/apply`
> (S24) é o precedente de aplicação atômica em lote.
>
> ### Objetivo
> Um item de DB carrega o rascunho exato do que foi aprovado, e publicar o DB coloca tudo em
> vigor na data definida — tudo ou nada.
>
> ### Escopo
> 1. **Vincular rascunho ao item** (`changeRequest/linkDraft`): para componente, cria/aponta
>    rascunho com `changeRequestId` do DB; para item MATRIX, aponta rascunho da matriz. Item
>    `CREATE` cria componente + rascunho juntos. Regras: um rascunho pertence a no máximo um DB;
>    desfazer o vínculo não descarta o rascunho sem confirmação.
> 2. **Congelamento** (I25) de ponta a ponta: a partir de `APPROVED`, itens e rascunhos vinculados
>    ficam somente leitura na UI e rejeitados no core (`E-GOV-01`); `CHANGES_REQUESTED` reabre.
> 3. **Detecção de base desatualizada** (RN-GOV-02): se a versão vigente do componente mudou
>    depois de `baseVersionId` (outro DB publicou antes), a publicação falha com `E-GOV-02` e a
>    tela oferece rebase explícito: rever o diff contra a nova vigente e reconfirmar. Nunca
>    silencioso.
> 4. **Publicação do DB** (`changeRequest/publish`): valida todos os itens (rascunho presente e
>    publicável, vigência definida), publica componentes e matrizes com `effectiveFrom` do DB numa
>    operação atômica (padrão do `import/apply`), move o status para `PUBLISHED` e grava eventos.
>    Falha em qualquer item → nada publicado, `E-GOV-04` com a lista (CT-GOV-03 no caso release,
>    aqui no individual).
> 5. **Atual × proposto rico**: na revisão do DB e na fila do gestor, diff de payload campo a
>    campo + diff de `spec` por bloco (S34) + `CompareView` existente para item MATRIX.
>
> ### Testes
> 100% no core novo. CT-GOV-01 (ponta a ponta goodlist), CT-GOV-02, CT-GOV-04, CT-GOV-06 (regra +
> matriz publicando juntas), rebase (`E-GOV-02`) com e sem reconfirmação, atomicidade (item
> quebrado no meio do lote → documento intacto), vigência retroativa conforme a decisão da
> pergunta 4. E2E estendendo o da S35 até PUBLISHED e conferindo a timeline dos componentes.
>
> ### Critérios de aceite
> - CT-GOV-01 verde de ponta a ponta, incluindo consulta por data antes/depois da vigência.
> - Publicação parcial é impossível por construção — teste que injeta falha prova isso.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes; 1,5 MB ok;
>   `dist/PolicyOps.html` no commit.
>
> ### Fora do escopo
> Release (S37 — publicar em lote reutiliza o que esta sessão entrega), pacote (S38), fotografia
> completa (S39).
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/14-governanca-de-alteracoes.md` (US-GOV-05 parcial ✅, RNs ajustadas, resposta
> da pergunta 4 incorporada), `docs/05-regras-de-negocio.md` (publicação via DB),
> `docs/08-camada-de-comandos.md`, `docs/13-decisoes.md`, linha da S36 em `docs/09`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → pare e pergunte.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
