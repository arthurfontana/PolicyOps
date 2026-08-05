# UX e Especificação do Editor

## 1. Tela inicial

Antes de haver documento aberto:

- **Abrir arquivo** (botão principal) — seletor ou arrastar-e-soltar em qualquer lugar da janela.
- **Arquivos recentes** — lista guardada em `localStorage` (nome, data, tamanho). No modo `FULL`, reabre pelo handle persistido no IndexedDB, sem novo seletor; se a permissão tiver expirado, pede reconfirmação com um clique.
- **Novo documento em branco**.
- **Explorar com dados de exemplo** — carrega `createSampleDocument()` em memória, sem arquivo. Ideal para conhecer a ferramenta sem risco.
- **Faixa de modo**: informa se está em `FULL` ou `DOWNLOAD_ONLY`, o que muda, e o navegador recomendado.
- Diálogo de identificação na primeira abertura: "Como você quer ser identificado no histórico?" — texto deixando claro que é identificação, não login.

## 2. Shell

```
┌──────────┬────────────────────────────────────────┬─────────────────┐
│ SIDEBAR  │              CANVAS                     │   INSPECTOR     │
│  248px   │              flex-1                     │     340px       │
│          │  Matriz de Limite PJ    v12 ● Vigente   │                 │
│ Projetos │ ┌─────────────────────────────────────┐ │  Propriedades   │
│  Pol. PF │ │              Score HVI3             │ │                 │
│  Pol. PJ │ │        R1   R2   R3   R4   R5   R6  │ │  (contextual)   │
│          │ ├────────┬──────┬──────────────────────┤ │                 │
│Biblioteca│ │        │até100│ ██  ██  ██  ██ ██ ██ │ │                 │
│ Variáveis│ │ Varejo │100-5 │ ██  ██  ██  ██ ██ ██ │ │                 │
│ Compatib.│ │        │500-1M│ ██  ██  ██  ██ ██ ██ │ │                 │
│ Conteúdo │ ├────────┼──────┼──────────────────────┤ │                 │
│ Templates│ │        │500-1M│ ██  ██  ██  ██ ██ ██ │ │                 │
│          │ │Atacado │1M-10M│ ██  ██  ██  ██ ██ ██ │ │                 │
│ Vigência │ │        │>10M  │ ██  ██  ██  ██ ██ ██ │ │                 │
│ Rascunhos│ └────────┴──────┴──────────────────────┘ │                 │
└──────────┴────────────────────────────────────────┴─────────────────┘
```

- Sidebar e inspector colapsáveis (`[` e `]`).
- Barra de status no rodapé: nome do arquivo, `Salvo` / `Alterações não salvas` / `Salvando…` / `Erro`, revisão, e quem detém o lock.
- `Ctrl+S` salva. `Ctrl+Shift+S` salva como. Isso é explícito: o usuário decide quando publicar o arquivo para o time.

## 3. Badges de estado

| Estado | Badge | Cor |
|---|---|---|
| DRAFT | `Rascunho` | âmbar |
| PUBLISHED vigente | `Vigente · v12` | verde |
| PUBLISHED agendado | `Agendado · a partir de 01/09` | azul |
| SUPERSEDED | `Histórico · 01/03 a 12/07` | cinza |
| ARCHIVED | `Descartado` | cinza riscado |

## 4. O grid com cabeçalhos aninhados

### 4.1 Renderização

CSS Grid em DOM puro. Sem canvas, sem biblioteca de terceiros.

- **Cabeçalhos de X**: uma faixa por nível, empilhadas no topo, `position: sticky`. Cada célula de cabeçalho ocupa `span` colunas (`grid-column: span N`), calculado por `computeHeaderLayout`.
- **Cabeçalhos de Y**: uma coluna por nível, à esquerda, sticky. Cada célula ocupa `span` linhas.
- O canto superior esquerdo mostra os nomes das variáveis de cada nível, e é clicável para selecionar tudo.
- Separadores mais fortes entre grupos de nível superior — é o que faz o olho ler "Varejo" como bloco.
- Célula: 88×56 px mínimo, ajustada por zoom (50–200%, `Ctrl+scroll`, `Ctrl+0` reseta).
- Conteúdo da célula em até 3 linhas: rótulo curto da decisão (sempre), oferta, limite em BRL.
- Triângulo no canto quando há observação. Hachura diagonal quando pendente.
- Rodapé: legenda das decisões usadas + contadores (`48 combinações · 45 preenchidas · 3 pendentes`).

### 4.2 Rolagem

Cabeçalhos sticky em ambos os eixos, incluindo múltiplos níveis. Numa matriz grande, rolar horizontalmente mantém a coluna "Varejo/Atacado" fixa, e rolar verticalmente mantém a faixa "Score HVI3" fixa. Testar isso é critério de aceite — sticky aninhado quebra com facilidade.

### 4.3 Virtualização

Apenas acima de 2.000 combinações visíveis, e apenas por linha. Abaixo disso, DOM completo. Não vale a complexidade antes.

## 5. Engine de seleção

Estado: `Set<string>` de chaves `xPath::yPath`, mais `anchor` e `focus`.

**Regra estrutural:** todo retângulo é calculado sobre os **índices nos arrays `tuples`**, nunca sobre ordem alfabética de códigos nem ordem de inserção no `Set`.

| Interação | Comportamento |
|---|---|
| Clique na célula | Seleção única; define a âncora |
| Shift + clique | Retângulo entre a âncora e a célula clicada |
| Ctrl/Cmd + clique | Alterna a célula; ela vira a nova âncora |
| Arrastar | Marquee retangular; **substitui** a seleção |
| Ctrl/Cmd + arrastar | Marquee que **soma** à seleção |
| Clique em cabeçalho de X | Seleciona todas as combinações sob aquele caminho — **em qualquer nível** |
| Clique em cabeçalho de Y | Idem |
| Shift + clique em cabeçalho | Estende a faixa de cabeçalhos do mesmo nível |
| Ctrl/Cmd + clique em cabeçalho | Soma ao que já está selecionado |
| Clique no canto superior esquerdo | Seleciona tudo |
| Setas | Move a seleção única, na ordem visual das tuplas |
| Shift + setas | Expande o retângulo a partir da âncora (encolhe ao inverter a direção) |
| Ctrl/Cmd + A | Seleciona tudo |
| Esc | Limpa a seleção |
| Enter | Foca o primeiro campo do inspector |
| Delete / Backspace | Limpa as células selecionadas; confirmação acima de 20 |

**Clicar em "Varejo" no nível 0 seleciona as 3 linhas de Varejo inteiras** — é o pedido de "selecionar tudo que é um segmento". Cabeçalho totalmente contido na seleção aparece destacado.

Feedback: borda azul 2px na seleção, âncora com borda distinta, contador flutuante ("18 células selecionadas" ou `Varejo › 100k–500k × R3` quando for uma só).

Acessibilidade: `role="grid"`, `aria-selected`, roving tabindex, `aria-live` anunciando a seleção. Atalhos só agem com foco no grid — não sequestram teclas enquanto o usuário digita no inspector.

## 6. Inspector

### 6.1 Sem seleção — propriedades da versão

Nome, código, projeto, descrição (editável só em rascunho). **Eixos**: para cada eixo, a pilha de níveis com variável, versão pinada, badge de defasagem e botão "Atualizar"; ações de adicionar / remover / reordenar nível; contagem de tuplas e de supressões manuais. Estatísticas (combinações, % preenchida, distribuição por decisão). Notas, autor, datas. Ações de ciclo de vida.

### 6.2 Com seleção

| Campo | Controle |
|---|---|
| Decisão | Select com as cores do catálogo |
| Oferta | Combobox com busca |
| Limite | Combobox + campo "valor específico" |
| Cor | Swatches + "usar cor da decisão" |
| Observação | Textarea |
| Atributos extras | Editor chave-valor, colapsado |

**Semântica de três estados** em seleção múltipla: campo uniforme mostra o valor; campo divergente mostra `— vários —`; campo intocado **não entra no patch**. O formulário mantém um `Set` explícito de campos tocados — `dirtyFields` não basta, porque o valor inicial de um campo divergente é sintético.

Cada campo tem botão "Limpar" (marca como tocado com `null`).

Ações rápidas sempre visíveis: `Aprovar tudo`, `Reprovar tudo`, `Análise manual`, e os 5 itens de catálogo mais usados na matriz.

Rodapé: "Aplicar a 18 células" com resumo do que muda.

## 7. Construtor de eixos

Componente reutilizado na criação da matriz e no inspector.

- Cada eixo é uma lista vertical de níveis, arrastáveis para reordenar.
- "Adicionar nível" abre um combobox com as variáveis que têm versão publicada e ainda não estão em nenhum eixo. Máximo 3.
- Ao lado de cada par adjacente, indicador de compatibilidade: *"Regra Segmento × Faturamento aplicada — 8 de 15 combinações válidas"*, com link para a biblioteca. Sem regra: *"Sem regra — todas as 15 combinações"*, com atalho para criar.
- **Preview ao vivo**: dimensões (`8 linhas × 6 colunas = 48 combinações`) e miniatura da estrutura de cabeçalhos. Alerta em amarelo acima de 1.500, bloqueio acima de 6.000.
- Alterar níveis numa matriz existente **sempre** passa por diálogo de preview com o impacto em células (§5.1/§5.2 de `04-eixos-aninhados.md`), incluindo a escolha de `REPLICATE`/`CLEAR` e `KEEP_FIRST`/`KEEP_IF_UNANIMOUS`.

## 8. Supressão manual

No inspector, com combinações selecionadas: "Marcar como inexistente". Elas somem do grid, deixam de contar como pendentes, e aparecem numa lista "3 combinações suprimidas" com botão de restaurar. Um aviso sugere, se o padrão se repetir, criar uma regra de compatibilidade na biblioteca.

## 9. Tela de comparação

Rota interna `compare?a=&b=`.

- Topo: dois seletores de versão + cards do resumo semântico ("12 células abertas", "8 fechadas", "4 ofertas alteradas").
- **Sobreposto** (padrão): um grid, células alteradas com marca diagonal e badge; clicar mostra antes → depois no inspector.
- **Lado a lado**: dois grids com rolagem e hover sincronizados.
- **Lista**: tabela filtrável e exportável.
- Legenda: adicionada (azul), removida (vermelho tracejado), modificada (âmbar), inalterada (opacidade 40%).
- Toggle "mostrar apenas alteradas".
- Banner quando incomparável (pilhas de variáveis diferentes), forçando lado a lado.
- O mesmo componente é reutilizado no conflito de salvamento (`06-persistencia-e-concorrencia.md` §5).

## 10. Tela de vigência

- Seletor de data (padrão: hoje) e de projeto. Atalhos: Hoje · Início do mês · 30/90 dias atrás · Início do ano.
- Lista das matrizes com a versão vigente naquela data, janela de vigência e link direto.
- **Faixa de linha do tempo** por matriz: um segmento por versão publicada, largura proporcional à duração, marcador na data selecionada, clicável.
- Sem versão vigente: "sem política vigente em dd/mm/aaaa" — não é erro.
- **Visão de portfólio**: cards com miniatura do grid (células de 12px, só cor) de cada matriz na data. É a visão de comitê.
- Viewer de versão histórica: banner *"Você está vendo a versão 11, vigente de 01/03 a 12/07. Esta é uma versão histórica."* + marca d'água discreta.

## 11. Bibliotecas

**Variáveis** — lista com busca, filtro por tipo, contagem de uso (vigentes × rascunhos). Detalhe: timeline de versões, editor de domínios com drag para reordenar, campos de faixa com validação de contiguidade em tempo real, e painel "Impacto" com o aviso literal:

> Publicar esta versão **não altera** nenhuma matriz já publicada. Rascunhos poderão adotar a nova versão manualmente.

**Compatibilidade** — lista de regras por par. Editor em **matriz de marcação**: domínios do pai nas linhas, do filho nas colunas, caixas de seleção. Ações de linha ("todos"/"nenhum"), contador de combinações válidas, e preview do eixo resultante. Aviso do mesmo teor sobre não afetar publicadas.

**Conteúdo** — abas por kind, tabela editável, reordenação por drag, toggle de arquivados, e ao renomear item em uso:

> Renomear altera a exibição em **todas** as versões, inclusive históricas. Se o significado mudou, crie um item novo.

**Templates** — lista + editor com construtor de eixos e construtor de regras de pré-preenchimento, com preview ao vivo do grid resultante.

## 12. Estados vazios, erros e ajuda

- Toda lista vazia tem estado próprio com ação primária.
- Erros de domínio viram toast com a mensagem pt-BR. Nenhum código cru na interface.
- `UNSET_CELLS_REMAIN` na publicação: barra dedicada "12 combinações ainda não preenchidas" com "Ir para a primeira" e "Selecionar todas as pendentes".
- Diálogo de atalhos com `?`.
- Indicador permanente de alterações não salvas; `beforeunload` quando houver.

## 13. Paleta

`src/lib/colors.ts` exporta 12 cores de célula validadas para contraste AA nos dois temas, as cores semânticas de decisão e as de diff. Nenhuma cor hard-coded em componente.
