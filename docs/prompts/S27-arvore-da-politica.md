# Sessão 27 — Árvore da política e cadastro de regras

**Modelo:** `Sonnet` · **Depende de:** S26 · **Épico/Marco:** Governança (M7)

> **Por que Sonnet:** composição de telas sobre contratos que a S26 já fechou (comandos de árvore
> e de versão prontos e testados). Não há invariante nova nem combinatória — é transcrição fiel de
> `docs/14` §4 (US-GOV-01/02) para React.

## Prompt

> Você está implementando a Sessão 27 do PolicyOps — a árvore da política e o cadastro estruturado
> de componentes, sobre o modelo entregue na S26.
>
> **Leia antes de começar:** `docs/14-governanca-de-alteracoes.md` §3.1–3.2, §4 (US-GOV-01/02),
> §6 (RN-GOV-06/07); `docs/03-modelo-do-documento.md` (schema 4); `docs/07-ux-e-editor.md`
> (padrões de shell, inspector e diálogos); DEC-GOV-001/002.
>
> ### Estado atual
> A S26 entregou schema 4, comandos de árvore (`component/*`) e ciclo de versão
> (`componentVersion/*`), tudo em `src/core/` com testes. Não existe nenhuma tela de componentes.
> O shell, a barra lateral por projeto e os padrões de inspector vêm das S09/S11/S13.
>
> ### Objetivo
> O usuário monta a hierarquia da política, cadastra regras com campos estruturados e as versiona
> com vigência — sem tocar em Word.
>
> ### Escopo
> 1. **Árvore por projeto** na navegação: expandir/recolher, busca por nome/código, contagem por
>    seção, criar/renomear/mover (drag ou menu)/arquivar componente. Nó MATRIX mostra estado e
>    vigência da matriz referenciada e navega para ela; criar nó MATRIX = escolher matriz do
>    projeto ainda não referenciada (I23).
> 2. **Inspector de componente** por tipo: formulário do `RulePayload` (e payloads de LIST,
>    REASON_CODE, POLICY_VARIABLE, OTHER), `origin` e `reviewStatus` visíveis e editáveis
>    (promover a VALIDATED é ação explícita). Campo `spec` aparece como placeholder somente
>    leitura ("editor na S28") — não implemente o editor.
> 3. **Ciclo de vida na tela**: criar rascunho, editar, publicar (pede `effectiveFrom` e nota,
>    mesmo diálogo-padrão das matrizes), descartar. Publicação direta exibe o aviso da RN-GOV-07.
> 4. **Timeline do componente**: versões com intervalo de vigência, autor e origem (DB futuro —
>    deixe o campo aparecendo quando existir), no padrão visual da timeline de matriz (S13/S15).
>
> ### Testes
> Unit dos componentes de árvore (jsdom) para: mover valida ciclo, criar MATRIX só com matriz
> livre, publicar exige vigência. E2E curto: criar seção → regra → publicar → v2 → timeline mostra
> as duas com vigências corretas (CT-GOV base da US-GOV-02).
>
> ### Critérios de aceite
> - Cadastro da amostra real do épico (Decisões Soberanas → Goodlist, Regras Duras → Dívida > 5k)
>   navegável e versionável de ponta a ponta.
> - Grid e telas existentes intactos (nenhuma regressão nos E2E atuais).
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes; 1,5 MB ok;
>   `dist/PolicyOps.html` no commit.
>
> ### Fora do escopo
> Editor rico (S28), DB/workflow (S29+), fotografia histórica (S33), import (S34).
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/07-ux-e-editor.md` (árvore e inspector de componente),
> `docs/14-governanca-de-alteracoes.md` (US-GOV-01/02 com estado ✅), `docs/13-decisoes.md` se
> houver decisão nova, linha da S27 em `docs/09`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → pare e pergunte.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
