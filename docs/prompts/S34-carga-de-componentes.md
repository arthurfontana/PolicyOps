# Sessão 34 — Carga inicial da política via Markdown estruturado

**Modelo:** `Sonnet` · **Depende de:** S27 · **Épico/Marco:** Governança (M7)

> **Por que Sonnet:** parser de um formato convencionado + assistente de revisão sobre padrões que
> o épico Carga já consolidou (Importar→Identificar→Revisar→Confirmar, aplicação por comandos com
> undo). O contrato do formato está fechado em `docs/14` §9; a parte perigosa (schema e comandos)
> veio da S26.

## Prompt

> Você está implementando a Sessão 34 do PolicyOps — a carga inicial da política: um Markdown
> estruturado vira a árvore de componentes, com revisão antes de entrar.
>
> **Leia antes de começar:** `docs/14-governanca-de-alteracoes.md` §9 (fluxo e convenção do
> formato — normativo), §10 (CT-GOV-05); DEC-GOV-007; `docs/12-carga-de-matrizes.md` §5 (padrões
> do assistente de carga que devem ser reaproveitados visualmente).
>
> ### Estado atual
> Árvore e CRUD de componentes prontos (S26/S27). O assistente de carga de matrizes
> (`src/components/import/`) é o precedente de UX. Nada lê Markdown no produto.
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
> 4. **Prompt de conversão** documentado: seção em `docs/10-guia-do-usuario.md` com o prompt
>    pronto para converter Word/PDF no Markdown convencionado usando uma IA externa, incluindo o
>    exemplo do §9.
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
> `docs/10-guia-do-usuario.md` (fluxo + prompt de conversão), `docs/13-decisoes.md`, linha da S34
> em `docs/09`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → pare e pergunte.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
