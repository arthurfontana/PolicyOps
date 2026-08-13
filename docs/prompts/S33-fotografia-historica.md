# Sessão 33 — Fotografia histórica da política e comparações

**Modelo:** `Opus` · **Depende de:** S30 · **Épico/Marco:** Governança (M9)

> **Por que Opus:** comparação semântica sobre duas fontes de vigência (componentes + matrizes),
> onde um falso negativo apaga a evidência de que a política mudou e um falso positivo polui a
> resposta de auditoria — o mesmo perfil das S14/S21. Casos de borda de vigência (versões sem
> `effectiveTo`, componentes criados/arquivados no intervalo) não aparecem em teste superficial.

## Prompt

> Você está implementando a Sessão 33 do PolicyOps — a política inteira reconstruída em qualquer
> data, e as comparações data A × data B e release × release.
>
> **Leia antes de começar:** `docs/14-governanca-de-alteracoes.md` §4 (US-GOV-07/08), §10;
> `src/core/timeline/` (vigência por data das matrizes, S15) e `src/core/diff/` (S14);
> DEC-GOV-002 (as duas fontes da fotografia).
>
> ### Estado atual
> Componentes versionados com vigência (S26/S27/S30), matrizes com `getPortfolioAt` (S15), diff de
> matriz (S14), diff de payload/RichDoc (S28/S30), releases publicadas (S31 — se ainda não
> executada, a comparação release × release fica condicionada e o restante não bloqueia).
>
> ### Objetivo
> "Qual era a política vigente em 15/05?" e "o que mudou desde março?" respondidas em dois
> cliques, para a política inteira.
>
> ### Escopo
> 1. **Core** (`src/core/timeline/policy-at.ts`): fotografia da política em uma data — para cada
>    componente, a versão vigente (ou ausência); compõe com `getPortfolioAt` para os nós MATRIX.
>    Contadores do período (US-GOV-07). Regras de borda explícitas: versão publicada com
>    `effectiveFrom` futuro não vige; componente arquivado permanece na fotografia de datas
>    anteriores ao arquivamento.
> 2. **Comparação de política A × B** (`src/core/diff/policy-diff.ts`): componentes adicionados /
>    removidos / alterados (payload campo a campo, spec por bloco) + matrizes alteradas (diff
>    existente, resumido), agregados por seção da árvore.
> 3. **Telas**: seletor de data na árvore ("ver como em…" — árvore inteira em modo fotografia,
>    badge da data, edição bloqueada), tela de comparação com dois seletores (data × data;
>    release × release usa as fotografias imediatamente antes e depois da publicação da release).
> 4. **Timeline por componente** já existe (S27); acrescente o salto "ver política inteira nesta
>    data" a partir dela.
>
> ### Testes
> 100% no core novo. Bordas: data exatamente igual a `effectiveFrom` (inclusive), componente com
> única versão futura, arquivado no meio do intervalo, matriz sem componente espelho (não pode
> sumir da fotografia do projeto — decida a representação e documente), documento da fixture do
> épico com 3 mudanças em datas conhecidas → as três comparações par a par batem. Desempenho:
> fotografia + diff de um projeto com 300 componentes e 102 matrizes < 500 ms.
>
> ### Critérios de aceite
> - CT-GOV-01 (parte final): consulta em 2026-08-15 mostra goodlist v1; em 2026-09-02, v2.
> - Comparação março × agosto lista exatamente o que os DBs publicados no intervalo mudaram.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes; 1,5 MB ok;
>   `dist/PolicyOps.html` no commit.
>
> ### Fora do escopo
> Edição em modo fotografia, export da comparação, indicadores/analytics de mudança.
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/14-governanca-de-alteracoes.md` (US-GOV-07/08 ✅), `docs/05-regras-de-negocio.md`
> (regras de vigência de componente), `docs/07-ux-e-editor.md`, `docs/13-decisoes.md`, linha da
> S33 em `docs/09`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → pare e pergunte.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
