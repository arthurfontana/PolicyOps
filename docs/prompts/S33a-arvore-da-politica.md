# Sessão 33a — Árvore da política (esqueleto navegável)

**Modelo:** `Sonnet` · **Depende de:** S32a · **Épico/Marco:** Governança (M10)
· **Trilha antecipada:** 2 de 3 (32a → 33a → 33b) — **Lote 2: Esqueleto**

> **Por que Sonnet:** composição de telas sobre contratos que a S32a já fechou (comandos de árvore
> prontos e testados). Não há invariante nova nem combinatória — é transcrição fiel de `docs/14`
> §4 (US-GOV-01) e `docs/07` §17 para React.

> **Por que 33a e 33b (DEC-GOV-012):** a primeira versão da política é construída **à mão,
> incrementalmente**, e não importada de uma vez. Dividir a antiga S33 cria um ponto de checagem
> barato: ao fim **desta** sessão o usuário monta a hierarquia inteira da política real e já
> consegue dizer se o modelo de árvore está certo — **antes** de existir formulário de regra. Se
> estiver errado, a correção cai sobre duas sessões, não sobre o épico.

> **O que esta sessão NÃO faz:** payload de regra, ciclo de vida de versão e timeline são a
> **S33b**. Aqui o inspector é mínimo e nada publica.

## Prompt

> Você está implementando a Sessão 33a do PolicyOps — a árvore da política como tela do projeto,
> sobre o modelo entregue na S32a.
>
> **Leia antes de começar:** `docs/07-ux-e-editor.md` §17 (normativo desta sessão — layout,
> facetas, ergonomia, duas portas para a matriz), §2 e §15 (shell e filtro por facetas existentes);
> `docs/14-governanca-de-alteracoes.md` §3.1, §3.6 (o que está adiado), §4 (US-GOV-01), §6 (I23,
> I24, I27); `docs/03-modelo-do-documento.md` (schema 5); DEC-GOV-001, 002, 011, 012, 013.
>
> ### Estado atual
> A S32a entregou schema 5, comandos de árvore (`component/*`) e ciclo de versão
> (`componentVersion/*`), tudo em `src/core/` com testes. Não existe nenhuma tela de componentes.
> O shell, a barra lateral por projeto, o `TagFilterBar` e os padrões de inspector vêm das
> S09/S11/S13/S23. As **102 matrizes reais já estão no documento** (épico Carga) — esta sessão não
> as cria nem as importa: ela dá a cada uma um lugar na política. As entidades de DB e release
> existem no schema mas não têm comandos nem tela (S32b/S35) — não as exiba.
>
> ### Objetivo
> O usuário monta a hierarquia inteira da política real (capítulos, agrupamentos temáticos) e
> pendura nela as matrizes que já existem — navegando, buscando e filtrando sem travar.
>
> ### Escopo
> 1. **Árvore como tela do projeto** (`docs/07` §17.1): painel de árvore ao lado do conteúdo, com
>    expandir/recolher, busca por nome e código, contagem por seção, filtro por tipo, por
>    `reviewStatus` e por faceta (reuse o `TagFilterBar` e os grupos de tag da S23). Filtro
>    **mantém os ancestrais visíveis, esmaecidos** — nunca achata a árvore em lista. Estado de
>    expansão e filtros no `ui-store` (interface, não documento).
> 2. **Sidebar** (§17.1): o projeto e os **dois primeiros níveis** da árvore como âncoras; o resto
>    da sidebar continua como está. Breadcrumb clicável no topo do conteúdo.
> 3. **CRUD estrutural**: criar/renomear/mover/arquivar componente de qualquer tipo; mover por
>    drag **e** por menu "Mover para…", validando ciclo, profundidade e reindexando `position`
>    (I24). Editar `tags`, `origin` e `reviewStatus` (promover a `VALIDATED` é ação explícita).
> 4. **Nó MATRIX** (§17.2): criar = escolher, num seletor com busca e filtro por tag, entre as
>    matrizes do projeto **ainda não referenciadas** (I23). O nó exibe o badge de estado e vigência
>    da matriz espelhada (`docs/07` §3) e navega para o grid. Um nó aponta **uma** matriz; um
>    capítulo como "Canal Digital" é uma seção com N nós MATRIX filhos.
> 5. **Ergonomia de estrutura** (§17.3, a parte desta sessão): `Enter` cria irmão já em edição de
>    nome, `Tab`/`Shift+Tab` desce/sobe um nível antes de gravar, `Ctrl/Cmd+D` duplica. Sem isso a
>    sessão não cumpre o objetivo — montar ~50 seções com diálogo modal é inviável.
> 6. **Inspector mínimo**: nome, código, tipo, tags, `origin`, `reviewStatus`, contagem de filhos.
>    Campos de payload e ações de versão aparecem **desabilitados com tooltip "S33b"**.
> 7. **Nota permanente** no rodapé do painel (§17.1): *"A ordem reflete o documento de política. A
>    sequência de avaliação do motor está descrita no texto de cada regra."*
>
> ### Testes
> Unit (jsdom): mover valida ciclo e profundidade; criar MATRIX só oferece matriz livre; filtro
> preserva ancestrais; `Enter` cria irmão na posição certa. E2E curto: montar 3 níveis, pendurar
> uma matriz existente, mover uma seção e conferir a ordem persistida.
>
> ### Critérios de aceite
> - **Montar o esqueleto real do documento *Filtros e Critérios de Crédito B2C*** (16 capítulos,
>   ~36 agrupamentos temáticos) e pendurar 5 matrizes reais **em menos de 30 minutos**, só com
>   teclado e mouse. Este é o critério que decide se a sessão está pronta.
> - A árvore continua utilizável com ~300 componentes em 4 níveis (fixture sintética): expandir,
>   buscar e filtrar sem travar.
> - Grid e telas existentes intactos (nenhuma regressão nos E2E atuais); a tela de matrizes com
>   facetas (§15) continua funcionando como está.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes; 1,5 MB ok;
>   `dist/PolicyOps.html` no commit.
>
> ### Fora do escopo
> Payload de regra, criar/publicar versão, timeline, vigência da fundação (**S33b**); editor rico
> (S34); DB/workflow (S35+); fotografia histórica (S39); carga por recorte (S40). E o que `docs/14`
> §3.6 adia: ordem de execução, `sectionKind`, nó de referência, numeração de origem.
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/07-ux-e-editor.md` §17 (ajustar ao que foi realmente construído),
> `docs/14-governanca-de-alteracoes.md` (US-GOV-01 com estado ✅ parcial), `docs/13-decisoes.md` se
> houver decisão nova, linha da S33a em `docs/09`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → pare e pergunte.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
