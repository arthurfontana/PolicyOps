# Sessão 07 — Biblioteca de Compatibilidade

**Modelo: `Sonnet`** · **Depende de:** S03, S06

---

## Prompt

> Você está implementando a Sessão 07 do Policy Matrix Studio — a Biblioteca de Compatibilidade.
>
> **Leia antes de começar:** `docs/03-modelo-do-documento.md` §3, `docs/04-eixos-aninhados.md` §3 (como as regras são consumidas), `docs/05-regras-de-negocio.md` §5 e `docs/07-ux-e-editor.md` §11 (bloco Compatibilidade).
>
> ### O que este conceito resolve
> Num eixo `SEGMENTO › FAIXA DE FATURAMENTO`, nem toda combinação existe: Varejo não tem faturamento acima de 1M, Corporate não tem abaixo de 1M. Isso é conhecimento sobre o negócio, não decisão de uma matriz específica — então vive na biblioteca, declarado uma vez, e vale para todas as matrizes que empilharem essas duas variáveis.
>
> O motor que consome essas regras **já existe** desde a S03 (`generateTuples`). Esta sessão constrói o cadastro e a interface. **Não reimplemente a geração de tuplas.**
>
> ### Objetivo
> Cadastrar, versionar e publicar regras de compatibilidade entre pares de variáveis.
>
> ### Escopo
>
> #### 1. Comandos — `src/core/library/compatibility.ts`
> Os seis comandos de `docs/08-camada-de-comandos.md` §3, no contrato de comando da S04:
> `compat/create`, `compat/createDraft`, `compat/saveMap`, `compat/publish`, `compat/discardDraft`, `compat/archive`.
>
> Validações:
> - **I12**: uma única regra publicada por par `(parentVariableId, childVariableId)` → `COMPATIBILITY_PAIR_DUPLICATE`. O par é **ordenado**: Segmento→Faturamento é diferente de Faturamento→Segmento;
> - pai e filho precisam ser variáveis distintas, ambas com versão publicada;
> - `allow` só pode citar códigos existentes nas versões pinadas — códigos desconhecidos viram **aviso**, não erro (a variável pode ter evoluído), e aparecem na interface;
> - `defaultForUnlisted` é `'ALL'` ou `'NONE'`, padrão `'ALL'`;
> - versão publicada é imutável (I10, I11).
>
> `compat/saveMap` grava também `parentVariableVersionId` e `childVariableVersionId` — as versões usadas para escrever o mapa, para rastreabilidade.
>
> #### 2. Consultas
> - `listCompatibilityRules(doc, { search? })` com contagem de uso (quantos eixos de quantas matrizes derivaram tuplas dessa regra).
> - `getApplicableRule(doc, parentVariableId, childVariableId)` — a regra publicada do par, ou `null`.
> - `getCompatibilityUsage(doc, ruleId)`.
>
> #### 3. Interface — `/library/compatibility`
> - **Lista**: nome, par de variáveis (com seta), nº de combinações válidas sobre o total, uso, badge de rascunho aberto. Estado vazio com ação primária.
> - **Criação**: escolher variável pai e variável filho entre as que têm versão publicada; bloquear par já existente com mensagem clara apontando a regra existente.
> - **Editor em matriz de marcação** — este é o ponto central da sessão:
>   - domínios do pai nas **linhas**, domínios do filho nas **colunas**, uma caixa de seleção em cada cruzamento;
>   - por linha: botões "todos" / "nenhum" e contador ("3 de 5");
>   - por coluna: mesma coisa;
>   - contador geral: "8 de 15 combinações válidas";
>   - seleção de `defaultForUnlisted` com explicação em português do efeito;
>   - domínios citados no mapa que não existem mais aparecem numa faixa de aviso, com ação de limpá-los;
>   - **preview do eixo resultante**: a lista de tuplas que a regra produz, na ordem do grid, usando `generateTuples` de verdade — não uma simulação.
>   - habilitado só em DRAFT.
> - **Timeline de versões** com estados e notas, igual à de variáveis.
> - Painel **Impacto** com o mesmo teor do aviso das variáveis:
>   > Publicar esta versão **não altera** nenhuma matriz já publicada. Rascunhos poderão adotar a nova versão manualmente.
>
> #### 4. Integração com o construtor de eixos
> Nada a fazer aqui ainda (o construtor vem na S09), mas exponha `getApplicableRule` de forma que a S09 possa mostrar "Regra X aplicada — 8 de 15 combinações válidas" ao lado de cada par adjacente de níveis.
>
> ### Testes
> - I12: criar segunda regra publicada para o mesmo par falha; para o par invertido, passa.
> - Mapa citando código inexistente gera aviso e **não** impede o salvamento.
> - `defaultForUnlisted: 'NONE'` com pai ausente do mapa elimina o pai — verifique via `generateTuples` que ele some das tuplas.
> - `defaultForUnlisted: 'ALL'` com pai ausente libera todos os filhos.
> - Publicar v2 de uma regra **não altera** as tuplas de nenhuma versão de matriz existente — teste explícito, comparando os arrays `tuples` antes e depois.
> - Editar mapa em versão publicada falha com `COMPATIBILITY_VERSION_IMMUTABLE`.
> - Componente: marcar/desmarcar atualiza o contador e o preview de tuplas na hora.
> - E2E: criar a regra `SEG_X_FATURAMENTO` do zero, publicar, e ver o preview com as 8 tuplas esperadas.
>
> ### Critérios de aceite
> - A regra do documento de exemplo pode ser reconstruída pela interface e produz as mesmas 8 tuplas.
> - Publicar nova versão de regra não muda nenhuma matriz existente.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, tamanho no orçamento.
>
> ### Fora do escopo
> Adotar a nova versão de regra num rascunho de matriz — isso é a S16.
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push.
