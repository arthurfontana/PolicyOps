# Sessão 40 — Carga da política por recorte (opcional)

**Modelo:** `Sonnet` · **Depende de:** S32a, S33a e S33b · **Épico/Marco:** Governança (M10)
· **Lote 4: Aceleração — opcional**

> **Por que Sonnet:** parser de um formato convencionado + assistente de revisão sobre padrões que
> o épico Carga já consolidou (Importar→Identificar→Revisar→Confirmar, aplicação por comandos com
> undo). O contrato do formato está fechado em `docs/14` §9; a parte perigosa (schema e comandos)
> veio da S32a.

> **🟡 Sessão opcional, e só depois do uso real (DEC-GOV-012).** A primeira versão da política é
> construída à mão pela árvore (S33a/S33b). Esta sessão só se justifica se, depois disso, o
> gargalo for **digitação** — e não a decisão sobre o que é seção e o que é regra, que nenhuma
> carga resolve. Antes de executá-la, confirme com o usuário que ela ainda faz sentido.
>
> **O que mudou em relação ao desenho original:** a carga deixou de ser "importar a política
> inteira de uma vez" e passou a ser **por recorte** — um capítulo por vez, **dentro da seção que o
> usuário escolher na árvore**. É o que a torna compatível com uma política que já está
> parcialmente cadastrada à mão.
>
> **Nada de DB, release ou workflow existe ainda** (S32b/S35): não tente vincular a carga a uma
> Solicitação de Alteração. O Markdown chega pronto: o prompt de conversão está em `docs/14` §9.1
> e não depende de código nenhum.

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
> Árvore, CRUD de componentes e versionamento prontos (S32a/S33a/S33b), **com parte da política
> já cadastrada à mão** — a carga entra num documento povoado, não num vazio. O assistente de
> carga de matrizes (`src/components/import/`) é o precedente de UX. Nada lê Markdown no produto.
> `ChangeRequest`, `Release` e o editor rico não existem como funcionalidade — o campo `spec` do
> componente fica vazio na carga (o corpo textual vai para o payload, não para `RichDoc`).
>
> ### Objetivo
> O usuário sobe um capítulo já convertido em Markdown **dentro da seção que escolheu**, revisa e
> confirma — repetindo isso capítulo a capítulo, no ritmo dele, sem nunca precisar importar a
> política inteira de uma vez.
>
> ### Escopo
> 1. **Parser** (`src/core/import/markdown-policy.ts`, puro): headings → hierarquia de SECTION;
>    blocos convencionados (`> Definição técnica:`, `> Reason code:`, `> Fonte:`, `> Tipo:`) →
>    componente tipado com payload e `origin`. Sem lib de Markdown — o subset é pequeno
>    (headings, parágrafos, blockquotes, listas); escreva um parser dedicado e testado. Heurística
>    de tipo: `> Tipo:` explícito vence; senão RULE por padrão sob seção, com aviso.
> 2. **Assistente** (3 passos, padrão visual da carga de matrizes): **destino + arquivo/colar
>    texto** → revisão da árvore proposta (tipo editável por linha, excluir itens, avisos de
>    heurística, duplicata de `code` bloqueia com `E-GOV-06`) → confirmação com `effectiveFrom` da
>    carga e resumo.
>    **O destino é o que esta sessão acrescenta ao desenho original** (`docs/14` §9 passo 2): o
>    recorte entra sob a seção selecionada na árvore (ou na raiz do projeto). O heading mais alto
>    do recorte vira o primeiro nível **abaixo** do destino — colar um bloco que começa em `###`
>    dentro de `Bloqueios por Dívida` funciona, sem exigir que o usuário reconstrua os headings
>    ancestrais. A profundidade resultante respeita I24 (≤ 6) e o passo de revisão avisa antes de
>    estourar. `effectiveFrom` vem pré-preenchido com a vigência da fundação do projeto (RN-GOV-09).
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
> undo. E2E: colar amostra → revisar → confirmar → árvore navegável. **Testes do recorte**: colar
> um bloco que começa em `###` dentro de uma seção existente; colar dois recortes seguidos no
> mesmo destino sem duplicar; recorte que estouraria a profundidade 6 → aviso na revisão; recorte
> cujo primeiro `code` já existe → `E-GOV-06` apontando o componente que já está lá.
>
> ### Critérios de aceite
> - A amostra real (Decisões Soberanas com Goodlist/PEP/Override + Regras Duras com Dívida>5k)
>   entra com hierarquia, payloads e origens corretos, sem edição manual pós-carga.
> - **Um capítulo do documento real sobe dentro de uma seção criada à mão na S33a**, convivendo com
>   os componentes já cadastrados — sem duplicar nem reordenar o que já existia.
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
