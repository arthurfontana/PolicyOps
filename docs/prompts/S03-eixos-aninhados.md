# Sessão 03 — Motor de eixos aninhados

**Modelo: `Opus`** · **Depende de:** S02

---

> **Por que Opus:** é o motor que decide quais células existem numa matriz. Erro aqui produz grids silenciosamente errados — combinações que não deveriam existir, ou combinações faltando — e isso se propaga para o snapshot, que é imutável. Custo de erro altíssimo, e a lógica é combinatória, não transcrição.

## Prompt

> Você está implementando a Sessão 03 do Policy Matrix Studio — o motor de eixos aninhados.
>
> **Leia `docs/04-eixos-aninhados.md` por inteiro antes de escrever qualquer código.** É a especificação completa desta sessão, incluindo o algoritmo, os avisos, os erros e a lista de testes obrigatórios. Leia também `docs/03-modelo-do-documento.md` §3 (compatibilidade) e §6.1 (eixo).
>
> ### O problema que este motor resolve
> Um eixo não é uma variável — é uma pilha de até 3 variáveis. `SEGMENTO › FAT` no eixo Y significa que cada linha do grid é uma combinação (Varejo, até 100k). Mas nem toda combinação existe: Varejo não tem faturamento acima de 1M. Essas restrições são declaradas na **biblioteca de compatibilidade**, e este motor as aplica.
>
> ### Objetivo
> `src/core/axes/` completo, em TypeScript puro, com **100% de cobertura**. Nenhuma interface nesta sessão.
>
> ### Escopo
>
> #### 1. `paths.ts`
> As funções de §2. A codificação é injetiva **porque** `code` não pode conter `|` nem `:` — a Sessão 02 já validou isso, mas escreva aqui o teste que prova a propriedade.
>
> #### 2. `tuples.ts`
> `generateTuples` conforme o algoritmo de §3, literalmente. Pontos de atenção:
> - a **ordem** das tuplas é a produzida pelo algoritmo (nível 0 por `position`, depois nível 1 por `position`, …). É a ordem visual do grid e é determinística. Nunca reordene depois;
> - regras se aplicam apenas entre níveis **adjacentes** (i-1 → i);
> - `defaultForUnlisted` decide o que acontece com um domínio do pai ausente do mapa — `'ALL'` libera tudo, `'NONE'` elimina o pai do grid;
> - `manualSuppressions` filtra ao final;
> - os 5 avisos de §3.1 e os 5 erros de §3.2, todos implementados.
>
> #### 3. `header-layout.ts`
> `computeHeaderLayout` conforme §4. **Derive os spans das tuplas reais, agrupando tuplas consecutivas por prefixo** — nunca do produto cartesiano teórico. É isso que faz a supressão assimétrica funcionar sem caso especial: Varejo com 3 faixas e Corporate com 2 produzem spans 3 e 2 naturalmente.
>
> #### 4. `levels.ts`
> As três operações de §5, cada uma devolvendo o resultado **e o que seria perdido**:
> - `addLevel` com `REPLICATE` (padrão) e `CLEAR`;
> - `removeLevel` com `KEEP_IF_UNANIMOUS` (padrão) e `KEEP_FIRST` — o padrão é o conservador porque perder informação em silêncio é o pior desfecho;
> - `reorderLevels`, que remapeia as chaves de célula permutando os códigos do caminho. Atenção: como a compatibilidade é direcional, reordenar pode mudar o conjunto de tuplas — nesse caso a operação reporta o delta e exige confirmação.
>
> Cada operação também expõe uma versão `preview…` que calcula o impacto sem aplicar.
>
> #### 5. `combinations.ts`
> `allCombinations`, `countPending`, `listPending`, `tuplesUnder`, `coordsForHeader` (§6 e §7). `tuplesUnder` é o que implementa "clicar em Varejo seleciona as 3 linhas de Varejo".
>
> #### 6. Integração com o documento de exemplo
> Substitua a expansão inline que a Sessão 02 deixou em `create.ts` por chamadas reais a `generateTuples`. O eixo Y de `MTZ_LIMITE_PJ` deve continuar produzindo **exatamente 8 tuplas**, na mesma ordem. Se o número mudar, algo está errado — investigue antes de ajustar o teste.
>
> ### Testes — 100% de cobertura, obrigatório
>
> Implemente **toda** a lista de `docs/04-eixos-aninhados.md` §8. Ela não é sugestão: cada item existe porque é um jeito conhecido de errar. Destaques que não podem faltar:
> - 2 níveis com o mapa do exemplo → exatamente as 8 tuplas esperadas, **na ordem esperada** (compare o array inteiro, não o tamanho);
> - `defaultForUnlisted` nos dois valores;
> - header layout com **supressão assimétrica** (Varejo 3, Atacado 3, Corporate 2) → spans 3, 3, 2 e `startIndex` correto;
> - `addLevel` com `REPLICATE` preserva conteúdo em todas as descendentes — compare o mapa de células inteiro;
> - `removeLevel` com `KEEP_IF_UNANIMOUS`: grupo unânime preserva, grupo divergente esvazia;
> - `reorderLevels` sem mudança de conjunto preserva **todas** as células — compare o mapa inteiro, não a contagem;
> - `GRID_TOO_LARGE` em 6.001 e sucesso em 6.000.
>
> Inclua também o **teste de propriedade** com `fast-check` (única dependência nova autorizada nesta sessão): para qualquer configuração válida, a soma dos spans de cada nível é igual a `tuples.length`, e o último nível tem exatamente `tuples.length` cabeçalhos.
>
> ### Critérios de aceite
> - Cobertura de `src/core/axes/` em 100% de linhas e branches.
> - O eixo aninhado do documento de exemplo produz 8 tuplas via `generateTuples`.
> - Todos os testes de §8 implementados e passando.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, tamanho dentro do orçamento.
>
> ### Fora do escopo
> Qualquer componente React. Comandos e undo (S04). Renderização do grid (S09).
>
> ### Se algo estiver ambíguo
> Pare e pergunte. A especificação foi escrita para não deixar decisão em aberto neste motor.
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push.
