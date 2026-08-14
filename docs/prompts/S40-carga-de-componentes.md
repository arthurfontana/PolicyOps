# Sessão 40 — Carga inicial da política via Markdown estruturado

**Modelo:** `Sonnet` · **Depende de:** S32a e S33 · **Épico/Marco:** Governança (M10)
· **Trilha antecipada:** 3 de 3 (32a → 33 → 40) — **executar aqui, antes da S34**

> **Por que Sonnet:** parser de um formato convencionado + assistente de revisão sobre padrões que
> o épico Carga já consolidou (Importar→Identificar→Revisar→Confirmar, aplicação por comandos com
> undo). O contrato do formato está fechado em `docs/14` §9; a parte perigosa (schema e comandos)
> veio da S32a.

> **Sessão antecipada (DEC-GOV-010).** Ela era a última do épico e passou a ser a terceira: o
> resto da governança (editor rico, DB, workflow, release, pacote, fotografia) é construído em
> cima da política real carregada, não de dados de exemplo. Só o que ela precisa foi feito antes —
> componentes e versões (S32a) e a árvore (S33). **Nada de DB, release ou workflow existe ainda**
> (S32b/S35): não tente vincular a carga a uma Solicitação de Alteração.
>
> O Markdown da política pode (e deve) chegar pronto: o prompt de conversão está em `docs/14` §9.1
> e não depende de código nenhum — converta o documento real enquanto as S32a/S33 rodam, para esta
> sessão nascer com conteúdo de verdade para testar.

## Prompt

> Você está implementando a Sessão 40 do PolicyOps — a carga inicial da política: um Markdown
> estruturado vira a árvore de componentes, com revisão antes de entrar.
>
> **Leia antes de começar:** `docs/14-governanca-de-alteracoes.md` §9 (fluxo e convenção do
> formato — normativo) e §9.1 (prompt de conversão), §10 (CT-GOV-05); DEC-GOV-007 e DEC-GOV-010;
> `docs/12-carga-de-matrizes.md` §5 (padrões do assistente de carga que devem ser reaproveitados
> visualmente).
>
> ### Estado atual
> Árvore e CRUD de componentes prontos (S32a/S33). O assistente de carga de matrizes
> (`src/components/import/`) é o precedente de UX. Nada lê Markdown no produto. `ChangeRequest`,
> `Release` e o editor rico não existem como funcionalidade — o campo `spec` do componente fica
> vazio na carga (o corpo textual vai para o payload, não para `RichDoc`).
>
> ### Objetivo
> O usuário transforma a documentação Word existente (convertida fora da ferramenta) na árvore da
> política em minutos, com origem preservada e revisão obrigatória.
>
> ### Escopo
> 1. **Parser** (`src/core/import/markdown-policy.ts`, puro): headings → hierarquia de SECTION;
>    blocos convencionados (`> Definição técnica:`, `> Reason code:`, `> Fonte:`, `> Tipo:`) →
>    componente tipado com payload e `origin`. Sem lib de Markdown — o subset é pequeno
>    (headings, parágrafos, blockquotes, listas); escreva um parser dedicado e testado. Heurística
>    de tipo: `> Tipo:` explícito vence; senão RULE por padrão sob seção, com aviso.
> 2. **Assistente** (3 passos, padrão visual da carga de matrizes): arquivo/colar texto →
>    revisão da árvore proposta (tipo editável por linha, excluir itens, avisos de heurística,
>    duplicata de `code` bloqueia com `E-GOV-06`) → confirmação com `effectiveFrom` da carga e
>    resumo.
> 3. **Aplicação** por comandos existentes (`component/create` + primeira versão `PUBLISHED` com
>    o `effectiveFrom` informado, `reviewStatus: PENDING_REVIEW`), em lote atômico com undo total
>    (CT-GOV-05).
> 4. **Prompt de conversão** documentado: o rascunho vive em `docs/14` §9.1 desde o replanejamento
>    (DEC-GOV-010) e já foi usado para converter o documento real. Mova-o para
>    `docs/10-guia-do-usuario.md` como seção do fluxo de carga, ajustado ao formato final que o
>    parser aceitar — se o parser divergir do rascunho, o texto do §9/§9.1 é que se ajusta, e a
>    divergência entra em `docs/13`.
>
> ### Testes
> 100% no parser: fixture derivada do documento real *Filtros e Critérios B2C* (sumário de 4
> níveis, regras com definição técnica/reason code/fonte), heurísticas, duplicatas, Markdown
> malformado (nunca lança — reporta issues no padrão da carga). CT-GOV-05 completo, incluindo o
> undo. E2E: colar amostra → revisar → confirmar → árvore navegável.
>
> ### Critérios de aceite
> - A amostra real (Decisões Soberanas com Goodlist/PEP/Override + Regras Duras com Dívida>5k)
>   entra com hierarquia, payloads e origens corretos, sem edição manual pós-carga.
> - Nada entra sem passar pela tela de revisão; undo remove a carga inteira.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes; 1,5 MB ok;
>   `dist/PolicyOps.html` no commit.
>
> ### Fora do escopo
> Reimportação incremental/diff de carga (fase 2 do épico), parse de `.docx`/PDF, qualquer IA em
> runtime (DEC-GOV-007), importar imagens.
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/14-governanca-de-alteracoes.md` (US-GOV-09 ✅, formato final do Markdown),
> `docs/10-guia-do-usuario.md` (fluxo + prompt de conversão), `docs/13-decisoes.md`, linha da S40
> em `docs/09`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → pare e pergunte.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
