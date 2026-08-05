# Sessão 09 — Projetos, matrizes e grid aninhado

**Modelo: `Sonnet`** · **Depende de:** S03, S06, S07, S08

---

## Prompt

> Você está implementando a Sessão 09 do Policy Matrix Studio.
>
> **Leia antes de começar:** `docs/07-ux-e-editor.md` §2, §3, §4 e §7 (shell, badges, grid e construtor de eixos), `docs/04-eixos-aninhados.md` §4 (layout de cabeçalhos) e `docs/05-regras-de-negocio.md` §3 (cor da célula). O motor de eixos e os comandos de matriz **já existem** desde as sessões 03 e 04 — consuma, não reescreva.
>
> ### Objetivo
> Navegar de projeto → matriz → versão e **ver a matriz renderizada com cabeçalhos aninhados**, ainda somente leitura. É o momento em que o "cineminha" aparece na tela.
>
> ### Escopo
>
> #### 1. Projetos
> - Lista com nome, descrição, nº de matrizes, nº de rascunhos abertos. Criar/editar em Dialog. Arquivar com confirmação.
> - Detalhe do projeto: lista de matrizes com nome, código, **estrutura dos eixos** (`Score HVI3` × `Segmento › Faturamento`), badge da versão vigente, badge de rascunho aberto, data da última publicação.
> - Sidebar passa a listar os projetos de verdade, com o item ativo destacado.
>
> #### 2. Construtor de eixos — `src/components/editor/axis-builder.tsx`
> Componente reutilizável (usado aqui na criação e na S12 no inspector), conforme `docs/07-ux-e-editor.md` §7:
> - cada eixo é uma lista vertical de níveis, arrastáveis para reordenar;
> - "Adicionar nível" abre combobox com as variáveis que têm versão publicada e ainda não estão em nenhum eixo. **Máximo 3 por eixo**;
> - entre cada par adjacente, indicador de compatibilidade usando `getApplicableRule` da S07: *"Regra Segmento × Faturamento aplicada — 8 de 15 combinações válidas"* com link para a biblioteca, ou *"Sem regra — todas as 15 combinações"* com atalho para criar;
> - **preview ao vivo**: dimensões (`8 linhas × 6 colunas = 48 combinações`) e miniatura da estrutura de cabeçalhos, calculada com `generateTuples` e `computeHeaderLayout` de verdade;
> - alerta amarelo acima de 1.500 combinações, bloqueio acima de 6.000;
> - avisos de `TupleWarning` exibidos em português (ex.: "O domínio Corporate ficou sem nenhuma faixa permitida e não aparecerá no grid").
>
> #### 3. Criação de matriz
> Wizard em Dialog, 2 passos: identificação (projeto, nome, código sugerido a partir do nome e validado, descrição) e eixos (o construtor acima). Impedir a mesma variável em X e Y. Chama `matrix/create` e navega para o editor da v1.
>
> #### 4. Navegação de versão
> - Abrir uma matriz vai para a versão vigente; se não houver, para o rascunho; se não houver nenhuma, estado vazio.
> - Seletor de versão na barra superior, listando todas com estado e vigência.
>
> #### 5. O grid — `src/components/grid/`
> Conforme `docs/07-ux-e-editor.md` §4. **Este é o coração visual do produto.**
> - CSS Grid em DOM puro. **Sem canvas, sem biblioteca de grid de terceiros.**
> - **Cabeçalhos de X**: uma faixa por nível no topo, cada célula ocupando `span` colunas via `grid-column: span N`, com os spans vindos de `computeHeaderLayout`.
> - **Cabeçalhos de Y**: uma coluna por nível à esquerda, cada célula ocupando `span` linhas.
> - **Ambos `position: sticky`**, em múltiplos níveis. Rolar horizontalmente mantém a coluna Segmento/Faturamento fixa; rolar verticalmente mantém a faixa do Score fixa. **Sticky aninhado quebra com facilidade — teste isso manualmente e trate como critério de aceite.**
> - Canto superior esquerdo com os nomes das variáveis de cada nível.
> - Separadores mais fortes entre grupos de nível superior — é o que faz o olho ler "Varejo" como bloco.
> - Célula 88×56 px mínimo, até 3 linhas de conteúdo: rótulo curto da decisão, oferta, limite em BRL. Triângulo no canto quando há observação; hachura diagonal quando pendente.
> - Cor resolvida pela prioridade de `docs/05-regras-de-negocio.md` §3. Implemente `resolveCellColor` e `contrastText` em `src/lib/colors.ts`, com testes.
> - Zoom 50–200% (`Ctrl+scroll`, botões, `Ctrl+0`).
> - Tooltip no hover com o caminho legível completo: `Varejo › 100k–500k × R3`.
> - Rodapé: legenda das decisões usadas + contadores (`48 combinações · 45 preenchidas · 3 pendentes`).
>
> **Nenhuma seleção ou edição nesta sessão** — isso é S10/S11. O grid é componente de apresentação puro: recebe a saída de `getEditorView` e renderiza, sem acessar o store.
>
> #### 6. Inspector somente leitura
> Propriedades da versão conforme `docs/07-ux-e-editor.md` §6.1: eixos com a pilha de níveis, variável e versão pinada de cada um, badge de defasagem, contagem de tuplas e supressões, estatísticas, notas, autor e datas. Botões de ciclo de vida **desabilitados com tooltip "disponível na próxima entrega"**.
>
> ### Testes
> - `resolveCellColor`: cada nível da prioridade, incluindo pendente e fallback neutro.
> - `contrastText`: preto sobre claro, branco sobre escuro, no limiar 0,55.
> - Componente: renderizar `MTZ_LIMITE_PJ` do exemplo produz **8 linhas** (não 15), com cabeçalhos de nível 0 tendo spans 3, 3, 2.
> - Componente: renderizar `MTZ_LIMITE_PF` produz o grid simples de 1 nível corretamente.
> - Cabeçalhos aparecem na ordem de `position`, não em ordem alfabética.
> - E2E: abrir exemplo → projeto PJ → matriz → grid aninhado visível com 48 células; rolar e verificar que os cabeçalhos permanecem fixos.
>
> ### Critérios de aceite
> - `MTZ_LIMITE_PJ` renderiza com Varejo cobrindo 3 linhas, Atacado 3 e Corporate 2.
> - Criar uma matriz nova com eixo Y = `SEGMENTO › FAT` produz o mesmo formato, todo hachurado.
> - Sticky funciona nos dois eixos com múltiplos níveis, verificado manualmente.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes, tamanho no orçamento.
>
> ### Fora do escopo
> Seleção, edição, publicação, comparação. Operações de nível (S12).
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push.
