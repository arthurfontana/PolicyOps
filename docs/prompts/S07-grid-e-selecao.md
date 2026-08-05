# Sessão 07 — Grid do editor e engine de seleção

**Modelo recomendado: `Opus`**
**Depende de:** S06

---

> **Por que Opus:** a engine de seleção tem dezenas de combinações de estado (âncora, retângulo, soma, subtração, teclado × mouse × cabeçalhos) que se contradizem facilmente. É lógica de interação com muitos casos de borda que não aparecem em teste automatizado — precisa de raciocínio cuidadoso, não de transcrição.

## Prompt

> Você está implementando a Sessão 07 do Policy Matrix Studio — a engine de seleção do editor.
>
> **Leia antes de começar:** `docs/05-ux-e-editor.md` §3 por inteiro, com atenção cirúrgica à tabela de §3.2. Aquela tabela é a especificação completa do comportamento; implemente **todas** as linhas, nenhuma a menos.
>
> ### Objetivo
> Transformar o grid somente-leitura da S06 num grid selecionável, com todas as interações de mouse e teclado. Ainda **sem edição de valores** — só seleção. A S08 conecta a seleção ao inspector.
>
> ### Escopo
>
> #### 1. `src/stores/editor-store.ts` (Zustand)
> Estado:
> ```ts
> {
>   payload: EditorPayload | null;
>   selection: Set<string>;          // chave "${x}::${y}"
>   anchor: { x: string; y: string } | null;
>   focus:  { x: string; y: string } | null;
>   marquee: { active: boolean; additive: boolean; from: Coord; to: Coord } | null;
>   zoom: number;
> }
> ```
> **Regra estrutural:** todo retângulo é calculado sobre os **índices de `position`** dos domínios, nunca sobre a ordem alfabética dos códigos nem sobre a ordem de inserção no `Set`. Escreva helpers puros em `src/lib/selection.ts`:
> - `rectBetween(axes, a, b): Coord[]`
> - `expandFrom(axes, anchor, direction, current): Coord[]`
> - `columnCoords(axes, xCode)`, `rowCoords(axes, yCode)`, `allCoords(axes)`
> - `toKey(coord)` / `fromKey(key)`
>
> Estes helpers são funções puras sobre os arrays de domínios — testáveis sem React, e é onde a maior parte dos testes vai morar.
>
> Ações do store: `selectSingle`, `extendTo`, `toggle`, `selectRect`, `selectColumn`, `selectRow`, `selectAll`, `clearSelection`, `moveFocus(direction, { shift })`, `startMarquee`, `updateMarquee`, `endMarquee`, `setZoom`.
>
> #### 2. Interações — implemente exatamente a tabela §3.2
> Pontos de atenção que costumam sair errados:
> - **Ctrl/Cmd + clique** alterna a célula **e** a torna a nova âncora, mesmo quando a remove da seleção.
> - **Shift + clique** usa a âncora, não a última célula clicada.
> - **Ctrl + arrastar** soma ao que já estava selecionado; arrastar sem modificador **substitui**.
> - **Shift + setas** expande a partir da âncora e pode *encolher* quando a direção se inverte — não é acumulativo.
> - Clique em cabeçalho de coluna/linha com Shift estende a **faixa de cabeçalhos**, não um retângulo de células soltas.
> - Marquee precisa funcionar mesmo quando o usuário arrasta para fora do grid e volta (clamp nos limites), e não pode iniciar seleção de texto do navegador.
> - `Esc` limpa seleção e marquee; se não houver nada, não faz nada (não engole o evento).
> - Atalhos de teclado só agem quando o foco está no grid — não podem sequestrar teclas enquanto o usuário digita num campo do inspector.
>
> #### 3. Feedback visual
> - Borda azul 2px na seleção; a âncora com borda mais forte e distinta.
> - Retângulo do marquee com fundo translúcido enquanto arrasta.
> - Cabeçalhos de linha/coluna destacados quando toda a linha/coluna está selecionada.
> - Contador flutuante no rodapé do canvas: "37 células selecionadas", com a coordenada legível quando for uma só (`R3 × Médio`).
> - Célula focada com anel de foco visível (acessibilidade por teclado).
>
> #### 4. Acessibilidade
> - O grid é `role="grid"`, células `role="gridcell"` com `aria-selected`.
> - Navegação completa por teclado, com roving tabindex.
> - `aria-live` polido anunciando mudanças de seleção ("37 células selecionadas").
>
> #### 5. Desempenho
> Numa matriz 40×40 (1.600 células), arrastar o marquee deve manter 60fps. Memoize a célula (`React.memo` com comparador sobre os campos que a afetam) e evite recriar o `Set` inteiro a cada `mousemove` — derive o retângulo do marquee na renderização e só materialize a seleção no `mouseup`. Inclua um teste de carga renderizando 40×40 e medindo o tempo de commit.
>
> #### 6. Testes
> Unitários de `src/lib/selection.ts` — é aqui que a corretude se prova:
> - `rectBetween` com âncora depois do alvo em ambos os eixos (retângulo "invertido");
> - `expandFrom` invertendo direção (encolhe, não acumula);
> - domínios cuja ordem de `position` difere da ordem alfabética dos códigos — teste explícito para isso;
> - `selectColumn`/`selectRow` cobrindo exatamente os domínios corretos.
>
> Testes de componente (Testing Library + `user-event`) para: clique, shift+clique, ctrl+clique, ctrl+A, Esc, setas, shift+setas, clique em cabeçalho, shift em cabeçalho.
>
> Teste de componente para o marquee com eventos de ponteiro sintéticos (mousedown → mousemove × N → mouseup), incluindo o caso aditivo.
>
> ### Critérios de aceite
> - Todas as 14 linhas da tabela §3.2 funcionam de verdade no navegador — verifique manualmente uma a uma antes de commitar.
> - O contador reflete a seleção corretamente em todos os modos.
> - Em versão não editável (PUBLISHED/SUPERSEDED) a seleção **continua funcionando** (útil para inspecionar), mas o store marca `isEditable: false` — a S08 usa isso para desabilitar a edição.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes.
>
> ### Fora do escopo
> Inspector, edição de valores, undo/redo, persistência. Nada nesta sessão escreve no banco.
>
> ### Encerramento
> Commit descritivo e push.
