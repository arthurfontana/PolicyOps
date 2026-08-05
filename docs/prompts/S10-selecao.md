# Sessão 10 — Engine de seleção hierárquica

**Modelo: `Opus`** · **Depende de:** S09

---

> **Por que Opus:** a engine de seleção tem dezenas de combinações de estado (âncora, retângulo, soma, subtração, teclado × mouse × cabeçalhos de múltiplos níveis) que se contradizem com facilidade. O aninhamento acrescenta um eixo inteiro de casos de borda que não aparecem em teste automatizado.

## Prompt

> Você está implementando a Sessão 10 do Policy Matrix Studio — a engine de seleção.
>
> **Leia antes de começar:** `docs/07-ux-e-editor.md` §5 por inteiro, com atenção cirúrgica à tabela de interações. Implemente **todas** as linhas, nenhuma a menos. Leia também `docs/04-eixos-aninhados.md` §7 (`tuplesUnder`, `coordsForHeader` — já existem desde a S03, **consuma**).
>
> ### O que torna esta engine diferente
> O eixo é aninhado. Clicar no cabeçalho "Varejo" — que é nível 0 e cobre 3 linhas — precisa selecionar as 3 linhas inteiras. Clicar em "Varejo › 100k–500k" seleciona 1. Isso vale para qualquer nível e para os dois eixos. É o que resolve o pedido de "selecionar tudo que é um segmento e reprovar".
>
> ### Objetivo
> Transformar o grid somente-leitura da S09 num grid selecionável. Ainda **sem edição de valores** — só seleção. A S11 conecta ao inspector.
>
> ### Escopo
>
> #### 1. Helpers puros — `src/core/axes/selection.ts`
> É aqui que a corretude se prova, e é aqui que os testes moram:
> ```ts
> rectBetween(view, a: Coord, b: Coord): Coord[]
> expandFrom(view, anchor: Coord, direction, current: Coord): Coord[]
> coordsUnderHeader(view, role, prefixPath): Coord[]
> headerRangeCoords(view, role, level, fromPath, toPath): Coord[]
> allCoords(view): Coord[]
> toKey(coord) / fromKey(key)
> isHeaderFullySelected(view, role, prefixPath, selection): boolean
> ```
> **Regra estrutural:** todo retângulo é calculado sobre os **índices nos arrays `tuples`**, nunca sobre ordem alfabética de códigos nem ordem de inserção no `Set`. As tuplas já vêm na ordem visual desde a S03.
>
> #### 2. Store — `src/store/editor-store.ts`
> ```ts
> {
>   selection: Set<string>;                  // "xPath::yPath"
>   anchor: Coord | null;
>   focus: Coord | null;
>   marquee: { active, additive, from: Coord, to: Coord } | null;
>   zoom: number;
> }
> ```
> Ações: `selectSingle`, `extendTo`, `toggle`, `selectRect`, `selectHeader`, `extendHeader`, `toggleHeader`, `selectAll`, `clear`, `moveFocus(direction, { shift })`, `startMarquee`, `updateMarquee`, `endMarquee`, `setZoom`.
>
> #### 3. Interações — implemente exatamente a tabela de §5
> Pontos que costumam sair errados:
> - **Ctrl/Cmd + clique** alterna a célula **e** a torna a nova âncora, mesmo quando a remove da seleção.
> - **Shift + clique** usa a âncora, não a última célula clicada.
> - **Ctrl + arrastar** soma; arrastar sem modificador **substitui**.
> - **Shift + setas** expande a partir da âncora e **encolhe** quando a direção se inverte — não é acumulativo.
> - **Clique em cabeçalho de nível intermediário**: num eixo de 3 níveis, clicar no nível 1 seleciona todas as combinações sob aquele prefixo de 2 códigos.
> - **Shift + clique em cabeçalho** estende a faixa **do mesmo nível**, não um retângulo de células soltas. Estender de "Varejo" a "Corporate" pega tudo, inclusive Atacado no meio.
> - Marquee precisa funcionar arrastando para fora do grid e voltando (clamp nos limites) e não pode iniciar seleção de texto do navegador.
> - `Esc` limpa seleção e marquee; sem nada selecionado, não engole o evento.
> - Atalhos só agem com foco no grid — nunca sequestram teclas enquanto o usuário digita no inspector.
>
> #### 4. Feedback visual
> - Borda azul 2px na seleção; âncora com borda distinta; anel de foco visível na célula focada.
> - Retângulo do marquee translúcido durante o arrasto.
> - **Cabeçalho destacado quando todas as suas combinações estão selecionadas** — em todos os níveis. Se as 3 linhas de Varejo estão selecionadas, o cabeçalho "Varejo" acende. Use `isHeaderFullySelected`.
> - Contador flutuante no rodapé: "18 células selecionadas", ou o caminho legível quando for uma só (`Varejo › 100k–500k × R3`).
>
> #### 5. Acessibilidade
> `role="grid"`, `role="gridcell"` com `aria-selected`, roving tabindex, `aria-live` polido anunciando a seleção. Navegação completa por teclado, incluindo chegar aos cabeçalhos.
>
> #### 6. Desempenho
> Numa matriz de 1.500 combinações, arrastar o marquee mantém 60fps. Memoize a célula (`React.memo` com comparador sobre os campos que a afetam) e **não recrie o `Set` a cada `mousemove`**: derive o retângulo do marquee na renderização e materialize a seleção só no `mouseup`. Inclua um teste medindo o tempo de commit com 1.500 células.
>
> ### Testes
> Unitários de `selection.ts` (é onde a corretude se prova):
> - `rectBetween` com âncora depois do alvo nos dois eixos (retângulo invertido);
> - `expandFrom` invertendo direção (encolhe, não acumula);
> - tuplas cuja ordem de `position` difere da ordem alfabética dos códigos — teste explícito;
> - `coordsUnderHeader` em eixo de 1, 2 e 3 níveis, para cada nível;
> - `coordsUnderHeader` com **supressão assimétrica**: "Varejo" devolve 3 linhas, "Corporate" devolve 2;
> - `headerRangeCoords` de Varejo a Corporate inclui Atacado;
> - `isHeaderFullySelected` verdadeiro só quando todas as descendentes estão dentro.
>
> Componente (Testing Library + `user-event`): clique, shift+clique, ctrl+clique, ctrl+A, Esc, setas, shift+setas, clique em cabeçalho de cada nível, shift em cabeçalho, marquee simples e aditivo com eventos de ponteiro sintéticos.
>
> ### Critérios de aceite
> - **Todas** as linhas da tabela de §5 funcionam no navegador — verifique manualmente uma a uma antes de commitar.
> - Clicar em "Varejo" no grid `MTZ_LIMITE_PJ` seleciona exatamente 18 células (3 linhas × 6 colunas).
> - Clicar em "Corporate" seleciona 12 (2 × 6).
> - Em versão não editável a seleção **continua funcionando** (útil para inspecionar); o store apenas marca `isEditable: false`.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, tamanho no orçamento.
>
> ### Fora do escopo
> Inspector, edição de valores, undo (já existe desde a S04). Nada nesta sessão altera o documento.
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push.
