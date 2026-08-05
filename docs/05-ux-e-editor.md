# UX e Especificação do Editor

## 1. Shell da aplicação

Layout de três colunas, inspirado em Figma:

```
┌──────────┬────────────────────────────────────────┬─────────────────┐
│ SIDEBAR  │              CANVAS                     │   INSPECTOR     │
│  240px   │              flex-1                     │     320px       │
│          │                                         │                 │
│ Projetos │   ┌───────────────────────────────┐    │  Propriedades   │
│  Pol. PF │   │  Matriz de Limite PF   v12 ●  │    │                 │
│  Pol. PJ │   ├───────────────────────────────┤    │  (contextual)   │
│          │   │        R1  R2  R3  R4  R5     │    │                 │
│ Biblioteca│  │  SEM   ██  ██  ██  ██  ██     │    │                 │
│  Variáveis│  │  BAIXO ██  ██  ██  ██  ██     │    │                 │
│  Conteúdo │  │  MÉDIO ██  ██  ██  ██  ██     │    │                 │
│  Templates│  │  ALTO  ██  ██  ██  ██  ██     │    │                 │
│          │   └───────────────────────────────┘    │                 │
│ Vigência │                                         │                 │
└──────────┴────────────────────────────────────────┴─────────────────┘
```

- Sidebar e inspector colapsáveis (`[` e `]`).
- Barra superior do canvas: nome da matriz, badge de versão/estado, botões contextuais (Criar rascunho / Publicar / Descartar / Comparar / Exportar), e o seletor de versão.
- O inspector é **contextual**: sem seleção mostra propriedades da versão; com 1 célula mostra a célula; com N células mostra edição em massa.

## 2. Badges de estado (linguagem visual consistente)

| Estado | Badge | Cor |
|--------|-------|-----|
| DRAFT | `Rascunho` | âmbar |
| PUBLISHED vigente | `Vigente · v12` | verde |
| PUBLISHED agendado | `Agendado · a partir de 01/09` | azul |
| SUPERSEDED | `Histórico · 01/03 a 12/07` | cinza |
| ARCHIVED | `Descartado` | cinza riscado |

## 3. O grid

### 3.1 Renderização

CSS Grid em DOM puro. Sem canvas, sem biblioteca de terceiros.

- Cabeçalhos de coluna (domínios de X) fixos no topo; cabeçalhos de linha (domínios de Y) fixos à esquerda (`position: sticky`).
- Célula: mínimo 88×56 px, máximo 200×120 px, ajustada por zoom.
- Conteúdo da célula, em 3 linhas quando couber:
  1. rótulo curto da decisão (sempre visível);
  2. oferta (se houver);
  3. limite formatado em BRL (se houver).
- Indicador de observação: triângulo no canto superior direito.
- `isUnset`: hachura diagonal + ícone de interrogação.
- Zoom: `Ctrl + scroll`, botões, e `Ctrl+0` para reset. Faixa 50%–200%.

### 3.2 Engine de seleção

Este é o componente mais delicado do produto. Especificação exata:

| Interação | Comportamento |
|-----------|---------------|
| Clique na célula | Seleção única; define a âncora |
| Shift + clique | Seleciona o retângulo entre a âncora e a célula clicada |
| Ctrl/Cmd + clique | Alterna a célula na seleção; ela vira a nova âncora |
| Arrastar com o mouse | Marquee retangular; substitui a seleção |
| Ctrl/Cmd + arrastar | Marquee que **soma** à seleção existente |
| Clique no cabeçalho de coluna | Seleciona a coluna inteira |
| Clique no cabeçalho de linha | Seleciona a linha inteira |
| Shift + clique em cabeçalho | Estende de faixa de colunas/linhas |
| Ctrl/Cmd + clique em cabeçalho | Soma a coluna/linha à seleção |
| Clique no canto superior esquerdo | Seleciona tudo |
| Setas | Move a seleção única |
| Shift + setas | Expande o retângulo a partir da âncora |
| Ctrl/Cmd + A | Seleciona tudo |
| Esc | Limpa a seleção |
| Enter | Foca o primeiro campo do inspector |
| Delete/Backspace | Limpa os atributos das células selecionadas (vira `isUnset`) — com confirmação se > 20 células |

Estado da seleção no store: `Set<string>` com chave `"${x}::${y}"`, mais `anchor: {x,y} | null`. Sempre derivar o retângulo a partir dos índices de posição dos domínios, não da ordem alfabética dos códigos.

Feedback visual: borda azul de 2px na seleção, âncora com borda mais forte, contador flutuante "37 células selecionadas" no rodapé do canvas.

### 3.3 Edição em massa

Com N > 1 células selecionadas, o inspector mostra os mesmos campos da edição unitária, com estas regras:

- Campo cujo valor é igual em todas: mostra o valor.
- Campo com valores divergentes: mostra o placeholder `— vários —` e não altera nada se não for tocado.
- Alterar um campo aplica a **todas** as selecionadas, num único patch.
- Botão "Limpar campo" por campo (aplica `null`).
- Rodapé do inspector: "Aplicar a 37 células" com resumo do que muda.

Ações rápidas sempre visíveis acima do formulário: `Aprovar tudo`, `Reprovar tudo`, `Análise manual`, e os 5 itens de catálogo mais usados na matriz (atalho de um clique).

### 3.4 Undo / redo

Command stack no `editor-store`, profundidade 50.

```ts
type EditorCommand = {
  label: string;                 // "Atribuir Oferta 8 a 37 células"
  apply: CellPatch;              // já resolvido
  invert: CellPatch;             // patch inverso, calculado no momento da aplicação
};
```

- `Ctrl/Cmd + Z` desfaz, `Ctrl/Cmd + Shift + Z` refaz.
- A pilha é **local à sessão do editor** e é limpa ao trocar de versão ou recarregar. Não há undo depois de publicar — isso é deliberado e deve estar escrito na UI.
- Undo/redo enviam patches ao servidor como qualquer outra edição (e geram evento de auditoria próprio).

### 3.5 Persistência

Otimista: aplica no store, mostra imediatamente, dispara a Server Action com debounce de 600 ms agrupando patches consecutivos **do mesmo tipo de campo sobre o mesmo conjunto**. Em caso de erro: reverte, mostra toast com a mensagem pt-BR e marca a versão como "não salvo" na barra superior.

Indicador de estado de salvamento na barra: `Salvo` / `Salvando…` / `Erro ao salvar`. Sem salvamento manual — não existe botão "Salvar".

## 4. Inspector — campos

### 4.1 Sem seleção (propriedades da versão)

Nome da matriz, código, projeto, descrição (editável só em rascunho), eixos (variável + versão pinada + badge de defasagem + botão "Atualizar variável"), estatísticas (total de células, % preenchida, distribuição por decisão), notas da versão, ações de ciclo de vida.

### 4.2 Com seleção

| Campo | Controle |
|-------|----------|
| Decisão | Select com cores do catálogo (obrigatório para sair de `isUnset`) |
| Oferta | Combobox com busca |
| Limite | Combobox + campo "valor específico" (preenche `limitOverride`) |
| Cor | Swatches da paleta + "usar cor da decisão" (limpa o override) |
| Observação | Textarea |
| Atributos extras | Editor chave-valor, colapsado por padrão |

Cabeçalho do inspector mostra a coordenada legível: `R3 × Médio` (labels, não códigos), ou `37 células` na seleção múltipla.

## 5. Tela de comparação

Rota `/projects/[projectId]/matrices/[matrixId]/compare?a=<versionId>&b=<versionId>`.

Layout:

- Topo: dois seletores de versão + resumo semântico em cards ("12 células abertas", "8 fechadas", "4 ofertas alteradas", "2 limites modificados").
- Três modos de visualização, em tabs:
  1. **Sobreposto** (default): um único grid, cada célula alterada com marca diagonal e badge; hover mostra antes/depois.
  2. **Lado a lado**: dois grids sincronizados (scroll e hover espelhados).
  3. **Lista**: tabela de mudanças, filtrável por tipo, exportável em CSV.
- Legenda de cores do diff: adicionada (azul), removida (vermelho tracejado), modificada (âmbar), inalterada (opacidade 40%).
- Toggle "mostrar apenas alteradas".
- Se os eixos forem incomparáveis: banner explicativo e força o modo lado a lado.

## 6. Tela de vigência

Rota `/timeline`.

- Seletor de data (default: hoje) + seletor de projeto.
- Lista todas as matrizes do projeto com a versão vigente naquela data, estado e link direto para o viewer daquela versão.
- Cada matriz tem uma faixa horizontal de linha do tempo mostrando as janelas de vigência das versões; clicar num segmento navega para ele.
- Botão "Comparar com hoje".

## 7. Bibliotecas

### 7.1 Variáveis

Lista com busca, filtro por tipo, e para cada uma: nome, código, tipo, nº de domínios da versão publicada, e **em quantas matrizes está em uso** (contagem via `MatrixAxis`, separando versões vigentes de rascunhos).

Detalhe da variável: versões em timeline, editor de domínios (drag para reordenar, tipos RANGE com campos min/max e validação de contiguidade em tempo real), e a lista de matrizes impactadas com o aviso explícito:

> Publicar esta versão **não altera** nenhuma matriz já publicada. Rascunhos poderão adotar a nova versão manualmente.

### 7.2 Conteúdo (catálogo)

Abas por `kind`. Tabela editável com código, rótulo, cor, valor numérico (LIMIT), uso e ação de arquivar. Aviso ao editar rótulo:

> Renomear altera a exibição em **todas** as versões, inclusive históricas. Se o significado mudou, crie um item novo.

### 7.3 Templates

Lista + editor: escolher variáveis dos eixos, defaults e regras de pré-preenchimento com **preview ao vivo** do grid resultante.

## 8. Estados vazios e erros

Toda lista vazia tem estado próprio com ação primária ("Nenhuma matriz ainda — Criar a primeira" / "Criar a partir de um template"). Erros de domínio viram toast com a mensagem pt-BR do catálogo. Erro em publicação com `UNSET_CELLS_REMAIN` destaca as células pendentes no grid e oferece "Ir para a primeira pendente".

## 9. Paleta

`src/lib/colors.ts` exporta 12 cores de célula validadas para contraste AA em ambos os temas, mais as cores semânticas de decisão (verde/vermelho/âmbar/roxo do seed) e as cores de diff. Nenhuma cor hard-coded em componente.
