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
┌────────────────────────────────────────────────────────────────────────────────┐
│ ☰ PolicyOps │ + Seção · + Regra · Matriz · Markdown · Publicar (1) │🔎 Filtrar│☾⌨▥│
├───────────────┬─────────────────────────────────────────────┬──────────────────┤
│ NAVEGAÇÃO     │                  CENTRO                     │ INSPECTOR        │
│ 248–480px     │                  flex-1                     │ 340px            │
│ (arrastável)  │                                             │ (só grade e      │
│               │ Política de Crédito B2C › CMA ›             │  comparação)     │
│ Projetos      │ ▸ Bloqueios por Dívida   BLOQUEIOS_POR_DIV. │                  │
│ ▾ Pol. B2C 85 │ ┌─────────────────────────────────────────┐ │                  │
│  ▾ CMA     17 │ │ Rascunho v2 · [Publicar] [Descartar] ⋯   │ │                  │
│   • Bloqueios │ ├─────────────────────────────────────────┤ │                  │
│   • Dívida ≥5k│ │ Tags · Origem · Revisão                 │ │                  │
│  ▸ Decisões 12│ │ Descrição de negócio ▌                  │ │                  │
│  ▸ Modelo  84 │ │ Definição técnica ▌                     │ │                  │
│               │ │ Entradas · Condições · Resultado        │ │                  │
│ Biblioteca    │ │ Especificação (editor rico)             │ │                  │
│ Vigência      │ │ Vigência e versões                      │ │                  │
│ Diário de Bord│ └─────────────────────────────────────────┘ │                  │
├───────────────┴─────────────────────────────────────────────┴──────────────────┤
│ politicas.json · Alterações não salvas · revisão 16 │ Bloqueio · A0050462 ADMIN │
└────────────────────────────────────────────────────────────────────────────────┘
```

Três regiões, três papéis, e nenhuma repete o papel da outra:

| Região | Papel | Regra |
|---|---|---|
| **Navegação** (esquerda) | onde as coisas estão | **Uma árvore só na aplicação**: a árvore da política (§17.1) é esta barra, não um segundo painel dentro da tela. Largura arrastável de 248 a 480px |
| **Centro** | onde se lê e se escreve | Todo objeto com conteúdo próprio — componente (§17.5), matriz, DB, release — se edita aqui, em largura útil. Nunca em painel lateral |
| **Inspector** (direita) | propriedades de uma **seleção dentro** do centro | Só existe onde há seleção: células do grid (§6) e célula do diff (§9). Componente não é seleção dentro de uma tela, é a tela — por isso não tem inspector (DEC-UX-002) |

- Sidebar e inspector colapsáveis (`[` e `]`). A largura da sidebar é arrastada pela borda direita (alça de 4px dentro do próprio `aside`, `role="separator"`, `aria-label="Ajustar largura da navegação"`, `aria-valuenow/min/max`, setas ←/→ movem 16px quando ela tem foco), respeita o intervalo 248–480px, volta ao padrão (288px) com duplo clique na alça e é lembrada por usuário em `localStorage` (`policyops.sidebarWidth`, valor fora do intervalo ou corrompido cai no padrão na leitura) — é interface, nunca documento (DEC-UX-005). **Entregue na S41**, com a árvore da política dentro da navegação (§17.1).
- Nas telas sem seleção (política, bibliotecas, vigência, DB, releases) o inspector **não é renderizado** e o botão `▥` do cabeçalho fica desabilitado com o motivo no `title` ("Esta tela não tem propriedades de seleção"). Não existe painel direito vazio dizendo "nada selecionado".
- Barra de status no rodapé: nome do arquivo, `Salvo` / `Alterações não salvas` / `Salvando…` / `Erro`, revisão, quem detém o lock, a identidade (login do Windows no modo `SERVER`, nome digitado nos demais) e o **papel efetivo** no documento aberto (`READER`/`EDITOR`/`PUBLISHER`/`ADMIN` — `14-plataforma-local.md` §6, S29).
- `Ctrl+S` salva. `Ctrl+Shift+S` salva como. Isso é explícito: o usuário decide quando publicar o arquivo para o time.
- Ações que o papel efetivo não permite ficam desabilitadas com o motivo visível (`title` do botão e, nos casos mais visados — publicar, salvar —, um texto ao lado: *"Requer papel PUBLISHER — você é EDITOR."*). A sidebar ganha o item **Acesso** (§16) só para quem pode vê-lo.

### 2.1 Barra de ferramentas contextual

Uma faixa de **40px, uma linha só**, abaixo do título da aplicação — o lugar de todas as ações de
tela. Ação de tela não mora dentro de painel: painel é conteúdo, barra é comando (DEC-UX-003).
**Entregue na S41** para a tela da política; as demais telas entram na sessão que as tocar.

| Grupo | Posição | Conteúdo |
|---|---|---|
| **Criação** | esquerda | O que a tela cria (na política: Nova seção · Nova regra · Pendurar matriz · Carregar Markdown) |
| **Publicação** | após criação, separador antes | O que a tela publica em lote (na política: Publicar pendentes com o contador no rótulo) |
| **Busca e filtro** | centro-direita | Campo de busca da tela + botão **Filtrar** com o número de filtros ativos no rótulo, abrindo popover com os chips de tipo, revisão e tag (§17.1) e "Limpar filtros" |
| **Alvo** | direita, antes dos ícones globais | Chip `em: … › CMA › Fraude` — o nó onde a criação vai acontecer, pelas duas últimas pontas do caminho (o caminho inteiro fica no `title`). Clicar abre os ancestrais e rola a árvore até ele; sem nó selecionado o chip diz `em: raiz da política` |

Regras da barra:

- **Só o que a tela faz.** Um item desabilitado só aparece quando a ação existe naquela tela e está
  bloqueada por papel ou estado (com o motivo no `title`). Ação de outra tela não fica na barra
  esmaecida "para constar".
- **Cabe numa linha.** Abaixo de ~1100px de largura — **ou** sempre que o conteúdo não couber na
  linha, medido — os itens de criação além do primeiro colapsam num botão `⋯ Mais` com os mesmos
  rótulos; os ícones globais (tema, atalhos, inspector) nunca colapsam. Medir, e não só olhar a
  largura da janela, porque a barra não tem sempre o mesmo conteúdo: a mesma janela cabe a barra de
  uma tela e não cabe a de outra (`useToolbarCompact`, com histerese para não oscilar no arrasto).
- **A barra é um slot do shell** (`ToolbarSlot`/`ToolbarPortal`, `src/components/shell/Toolbar.tsx`),
  preenchido pela tela ativa por portal — sem guardar `ReactNode` em store (DEC-UX-006). Tela que
  ainda não preencheu o slot mantém o cabeçalho próprio que já tem, e **a faixa nem é renderizada**:
  o contêiner só ganha altura, borda e `role="toolbar"` quando alguém o preenche. A migração é por
  tela, não um big-bang: a tela da política é a primeira (S41), e as demais entram na sessão que as
  tocar. Na política quem preenche o slot é a própria `PolicyTree` — ela é a dona do estado de
  criação e dos diálogos —, e só enquanto a tela da política está na frente.
- **Teclado**: as mesmas ações têm atalho e o atalho aparece no `title` (`Nova seção` = `Enter` na
  árvore, `Nova regra` = `Shift+Enter`, `Publicar pendentes` = `Ctrl+Shift+P`). O diálogo de
  atalhos (§12) lista a barra inteira.
- **Transitório da S41**: o seletor `Ver como em…` e o atalho para comparar datas continuam na
  barra da política enquanto a fotografia for um estado da árvore. Os dois saem na S43, quando a
  consulta histórica virar tela (DEC-UX-004).

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

O painel direito existe onde há **seleção dentro** de uma tela — células do grid e célula do diff
(§2). Componente de política não passa por aqui: ele tem página própria no centro (§17.5).

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

### 6.3 Evidências (sessão 30)

Seção "Evidências" em três lugares, uma por alvo (`14-plataforma-local.md` §7): no inspector da
versão (duas seções — "Evidências da versão N" e "Evidências da matriz") e na tela do projeto.

| Elemento | Comportamento |
|---|---|
| Lista | Nome original, quem anexou, quando, tamanho, nota, e o caminho completo no Explorer (`\\rede\Politicas\_evidencias\…`) — é por ele que se acha o arquivo sem a aplicação |
| Anexar | Campo de nota (opcional) + seletor de arquivo. O arquivo é copiado para o acervo **antes** de o vínculo entrar no documento; o aviso ao lado diz que o conteúdo não é lido nem indexado, e qual é o limite (50 MB) |
| Abrir | Baixa o arquivo com o hash conferido pelo servidor. Divergência não vira download: vira aviso (§ abaixo) |
| Desanexar | Confirmação citando a lixeira e o `Ctrl+Z`: o vínculo sai agora e o arquivo só se move no próximo salvamento |

Anexar a uma **versão publicada** é permitido e não altera o snapshot — é o caso típico (a
evidência chega depois da publicação). Fora do modo `SERVER` a seção aparece com o motivo no
lugar dos controles ("Evidências exigem o servidor local…"), e o que já estiver anexado continua
listado, só sem abrir nem desanexar.

Os três erros da API têm texto próprio em português, sempre com o caminho esperado dentro:
arquivo acima de 50 MB (recusado antes de subir), hash divergente ("o conteúdo … não confere com
o hash registrado … não vale mais como prova até alguém restaurar o arquivo original") e arquivo
movido à mão (`404`, com o caminho esperado e a lembrança de olhar em `_evidencias\_lixeira`).

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

## 9b. Board de comparação (matrizes lado a lado)

Rota interna `board` (`#/board`). Diferente da tela de comparação do §9 — que compara **duas
versões da mesma matriz** —, o board compara **qualquer conjunto de matrizes inteiras**: o caso de
uso é levar 2 a 6 "cineminhas" (ex.: os riscos de um cluster em canais diferentes) para uma reunião
executiva, lado a lado, sem montagem manual em PowerPoint.

- **Fixar**: botão "Adicionar à comparação" (ícone alfinete) na tela de matriz e em cada linha da
  lista de matrizes do projeto. Fixa a matriz com a versão aberta/vigente no momento; alfinete vira
  "Na comparação" enquanto fixada. Item da sidebar **Comparação** mostra a contagem, visível de
  qualquer tela do documento.
- **Teto de 6** matrizes fixadas por vez (`MAX_BOARD_ITEMS`) — acima disso a leitura lado a lado
  deixa de caber sem rolagem horizontal excessiva; tentar fixar a sétima mostra um toast e não faz
  nada.
- **O board**: uma coluna por matriz fixada, cada uma com cabeçalho (nome, código, versão, badge de
  estado, vigência — mesma frase do export PNG do §12) e o grid inteiro, somente leitura, com zoom
  compartilhado entre as colunas. Remoção individual pelo X do cabeçalho da coluna; "Limpar tudo"
  esvazia o board sem afetar nenhuma matriz ou versão (é só estado de interface, como
  `compareVersionIds`).
- **Modo apresentação**: esconde todo o chrome do shell (topo, sidebar, inspector, barra de status)
  — só o board em tela cheia. `Esc` ou o botão "Sair da apresentação" volta ao normal.
- **Exportar imagem**: captura o board inteiro (todas as colunas visíveis) como PNG via
  `html-to-image`, mesmo mecanismo do export de matriz única (§12) — pronto para colar num slide já
  pronto.

## 10. Tela de vigência — a política inteira em qualquer data

É a tela de leitura do passado: **toda a estrutura do projeto na data escolhida**, não só as
matrizes. Seções, regras, listas, variáveis de política e matrizes aparecem juntas, cada uma com o
que era naquele dia (DEC-UX-004). É aqui que mora o antigo "ver como em…" da barra da árvore.

- Seletor de data (padrão: hoje) e de projeto. Atalhos: Hoje · Início do mês · 30/90 dias atrás · Início do ano.
- Três visões, em abas, sobre a **mesma** data:

| Aba | O que mostra |
|---|---|
| **Estrutura** (padrão) | A árvore do projeto como estava na data: `v{n}` da versão vigente (de componente ou de matriz), *"sem política vigente em dd/mm/aaaa"* no conteúdo sem versão ali, e `estrutura` na seção pura (I29 — pasta nunca aparece como regra que caducou). O que não existia na data some junto com a subárvore (`05-regras-de-negocio.md` §6.2) |
| **Matrizes** | A lista de hoje: matriz, versão vigente na data, janela de vigência, faixa de linha do tempo (um segmento por versão publicada, largura proporcional à duração, marcador na data, clicável) e link direto para o grid |
| **Portfólio** | Cards com miniatura do grid (células de 12px, só cor) de cada matriz na data. É a visão de comitê |

- Selecionar um nó da aba **Estrutura** abre, ao lado, o **conteúdo daquela versão em somente
  leitura** — payload campo a campo e especificação rica —, com o banner *"Você está vendo a
  versão 3, vigente de 01/03 a 12/07. Esta é uma versão histórica."* e marca d'água discreta. Nó
  `MATRIX` abre o grid da versão vigente na data, com o mesmo banner.
- **Nada se edita aqui.** Editar é sempre no presente: o botão **"Abrir no editor (hoje)"** leva ao
  mesmo componente na tela da política, fora da fotografia. É o que dispensa bloquear edição campo
  a campo na árvore lateral — a árvore da esquerda é sempre hoje (DEC-UX-004).
- **"Comparar com outra data"** abre a tela de comparação (§20.3) com a data atual da tela já
  preenchida de um lado.
- Busca e filtro por tipo/revisão/tag da aba **Estrutura** usam a mesma barra de ferramentas
  contextual (§2.1) — filtrar o passado é leitura.

## 11. Bibliotecas

**Variáveis** — lista com busca, filtro por tipo, contagem de uso (vigentes × rascunhos). Estado vazio e cabeçalho da lista trazem, junto de "Nova variável", a ação **"Criar a partir de existente"**: abre um seletor de variável + versão de origem, pede código/nome/descrição da nova, e chama `variable/duplicate` — a variável nasce com os domínios (cor, faixas e agrupamentos, se houver, inclusive) já copiados, pronta para ajustar em vez de montar do zero.

Detalhe: timeline de versões, editor de domínios com drag para reordenar, campos de faixa com validação de contiguidade em tempo real, e painel "Impacto" com o aviso literal:

> Publicar esta versão **não altera** nenhuma matriz já publicada. Rascunhos poderão adotar a nova versão manualmente.

**Colar tabela — importação genérica de domínios (qualquer tipo, só em `DRAFT`).** É a primeira ação sugerida no editor de domínios, disponível **sempre**, não só para `RANGE`: "Colar tabela" abre uma caixa de texto onde o usuário cola direto do Excel. O contrato (`05-regras-de-negocio.md` §5.6.2) é deliberadamente mínimo — uma linha de cabeçalho, uma linha por combinação — para caber tanto no caso mais simples (`Domínio | Mínimo | Máximo`) quanto no mais hierárquico (`Regional | Porte | Domínio | Mínimo | Máximo`), sem o usuário escolher um "modo" antes de colar:

- a caixa mostra, ao lado do campo de texto, um **exemplo inline** com 3-4 linhas do formato esperado, e dois botões de download: **"Baixar modelo simples (.csv)"** (`Domínio, Mínimo, Máximo, Cor`) e **"Baixar modelo com agrupamentos (.csv)"** (`Agrupamento 1, Agrupamento 2, Domínio, Mínimo, Máximo, Cor`) — arquivos gerados no cliente (`Blob`, sem rede), prontos para abrir no Excel, preencher e colar de volta;
- ao colar, o sistema **infere tudo**: quantas colunas de agrupamento existem (pelas colunas à esquerda de `Domínio` que não batem com um nome reconhecido), se a tabela é sobre `RANGE` (presença de `Mínimo`/`Máximo`) ou só sobre identidade/cor, e os nomes/opções de cada agrupamento a partir do próprio cabeçalho e dos valores colados — nenhuma configuração manual é pedida antes;
- o resultado aparece como **preview** — a lista de domínios (e, se houver, a estrutura de agrupamento detectada) pronta para revisão, com avisos de linha vazia ou combinação incompleta e erros de formato apontando a linha do texto colado, sem fechar a caixa;
- ao confirmar, o preview substitui o conteúdo do editor — nada é gravado sem passar pelo Salvar normal (§5.6.3: domínios de mesmo `code` já existentes preservam automaticamente qualquer atributo — cor, faixa — que a colagem não trouxe coluna para atualizar);
- o aviso de Impacto (acima) continua valendo: colar uma tabela nunca afeta versões de matriz já publicadas — só o rascunho da variável.

**Continuidade automática de faixas (só `RANGE`, só em `DRAFT`).** O editor padrão pede só **mínimo e máximo** de cada faixa — sem checkbox de "mín. inclusivo"/"máx. inclusivo" visível. O sistema assume `[mín, máx]` com passo 1 (`boundaryMode: 'INCLUSIVE_INTEGER'`, o default — valores inteiros, o máximo de uma faixa mais 1 é o mínimo da seguinte) e valida continuidade/sobreposição/lacuna em tempo real, apontando a mensagem inline na faixa e na vizinha envolvida — aviso não bloqueante (I9, `03-modelo-do-documento.md` §9): salvar e publicar continuam permitidos com o problema em aberto. Os dois casos-limite que motivavam os checkboxes manuais ficam atrás de um link **"Opções avançadas"**, colapsado por padrão:

- **"Faixas decimais/meio-abertas"** (`boundaryMode: 'HALF_OPEN'`, `05-regras-de-negocio.md` §5.6.0) — para quando a faixa não é inteiro-fechado-fechado (ex.: cortes decimais, ou o máximo de uma faixa não deve pertencer à seguinte); ligado, a validação volta a exigir `atual.máx == próxima.mín` sem checar inteiros;
- override manual de inclusão por faixa, disponível só com `HALF_OPEN` ligado — para o caso raro em que uma faixa isolada precisa ficar fechada nos dois lados dentro de uma versão `HALF_OPEN` — reexibe os checkboxes "mín. inclusivo"/"máx. inclusivo" só quando o usuário abre essa opção. Numa versão `INCLUSIVE_INTEGER` (o default) não há override por faixa: todas seguem `[mín, máx]` igualmente.

A ordem das linhas (por `position`, a mesma do drag) pode crescer ou decrescer — cortes de score às vezes são digitados/colados "melhor faixa primeiro" (`R01: 704–999`, `R02: 685–703`, …). A validação detecta a direção sozinha, pelo primeiro par de mínimos distintos, e não pede escolha manual nem trava com `RANGE_NOT_CONTIGUOUS` só por causa do sentido.

**Agrupamentos hierárquicos (só `RANGE`, só em `DRAFT`).** Generaliza o toggle "regional" da sessão 18: no topo do editor de domínios, uma lista dos agrupamentos configurados na versão (nome + contagem de opções), reordenável por drag — a ordem vira a ordem das colunas na colagem e a leitura da hierarquia (Regional › Porte › Tipo de Empresa). Populada principalmente por "Colar tabela" (acima); um editor manual complementar permite renomear um agrupamento, reordenar, remover (com confirmação — apaga as faixas daquele nível) ou adicionar um agrupamento vazio antes de colar.

Com 1 ou mais agrupamentos configurados, a tabela de domínios deixa de ser o grid pivotado da sessão 18 (uma coluna mín/máx por regional) e passa a ser uma **tabela tidy**: uma linha por combinação `(agrupamento…, domínio, mín, máx)`, igual ao formato colado — o pivô parava de generalizar a partir de 2 níveis, porque hierarquias reais são assimétricas (nem toda Regional tem MEI) e um grid bidimensional não representa isso sem colunas vazias. A tabela é:

- agrupada visualmente por caminho (path), com o cabeçalho de cada grupo mostrando a combinação (`São Paulo › MEI`);
- editável linha a linha (adicionar/remover combinação, editar mín/máx/cor inline);
- validada em tempo real **por caminho distinto** — a mensagem de contiguidade aponta o caminho e o par de faixas com problema, nunca confunde um erro de "São Paulo › MEI" com um de "Sul › MEI"; aviso não bloqueante, como toda validação de domínio (I8/I9/I19, `03-modelo-do-documento.md` §9);
- avisada (não bloqueada) quando um domínio existe em alguns caminhos mas está ausente de outros que têm faixas para os demais domínios — o caso provável de "esqueci de colar uma linha" (`03-modelo-do-documento.md` §9, nota após I19).

O aviso de Impacto continua valendo: mudar os agrupamentos de uma variável nunca afeta versões de matriz já publicadas — só o rascunho da variável, e a matriz nunca sabe que agrupamento existe (§5.6 de `05-regras-de-negocio.md`).

**Paletas de cor (só `RANGE`/`CATEGORICAL`/`ORDINAL`, coluna Cor do editor de domínios).** Botão **"Aplicar paleta"** ao lado da lista de domínios: abre um seletor com as paletas oficiais (`Risco R01–R20`, `Risco simplificado` — `05-regras-de-negocio.md` §5.6.4) e aplica a cor de cada domínio cujo código/rótulo bater, mostrando quantos bateram. Domínios novos, criados sem cor explícita (digitando ou colando sem coluna `Cor`), já nascem com a cor sugerida quando o código/rótulo bate com uma paleta oficial — continua um campo comum, editável a qualquer momento.

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

`src/lib/color-palettes.ts` exporta as paletas oficiais de cor de **domínio** (`Risco R01–R20`, `Risco simplificado` — `05-regras-de-negocio.md` §5.6.4), usadas pelo botão "Aplicar paleta" e pela sugestão automática do editor de domínios (§11). É um conjunto separado das 12 cores de célula acima — domínio e célula têm resoluções de cor independentes (`05-regras-de-negocio.md` §3).

## 14. Assistente de carga

Rota interna `import`, acionada por **"Carregar tabela"** na tela de Projetos e no cabeçalho da lista de matrizes. São seis passos (arquivo · colunas · biblioteca · conteúdo · plano · aplicar), navegáveis para trás, e **nada é gravado antes do último**. O desenho completo das telas, com o que cada passo mostra e bloqueia, está em [`12-carga-de-matrizes.md`](12-carga-de-matrizes.md) §6 — não é repetido aqui.

O que o assistente **reaproveita** do que já existe, em vez de recriar:

- expandir a linha de uma matriz do plano lista `plan.changes` (célula, campo, antes/depois) direto,
  e **"Ver diff" abre o `CompareView` de §9** num painel do assistente: o par de versões que ele
  exige é montado a partir do plano, num documento descartável em memória (DEC-CARGA-015). O plano
  é dry-run (RN-13), então nenhuma das duas versões existe no documento aberto — quem as sintetiza
  é `src/components/import/plan-preview.ts`, reusando `getEditorView` e `diffVersions` sem duplicar
  nem uma nem outra;
- a fila de revisão pós-carga é a tela de Rascunhos filtrada por `importRunId`, com as ações "Marcar
  como revisado" e "Publicar" por item e "Publicar revisados" em lote, que publica **só** os
  marcados, com a nota da carga, para no primeiro erro e informa o que já foi publicado. "Revisado"
  é estado de interface, não campo do documento (DEC-CARGA-016);
- as pendências de biblioteca do passo 3 abrem os mesmos editores de §11 (`DomainsEditor`,
  `CompatibilityMapEditor`), com o valor do arquivo já preenchido, e gravam pelos mesmos comandos
  que esses editores já usam;
- mapear uma coluna de eixo (passo 2) para uma variável que ainda não existe abre o mesmo
  `CreateVariableDialog` da tela de Variáveis, ali mesmo, sem sair do passo;
- a barra de status e o indicador de alterações não salvas continuam valendo — uma carga aplicada é uma alteração como qualquer outra, sujeita ao `Ctrl+S`.

O passo 1 arrasta-e-solta com uma zona própria (`FileDropZone`), **não** o `DropTarget` global de
§2 — aquele sempre tenta abrir o arquivo solto como documento, e um `.csv` não é isso
(DEC-CARGA-014).

O passo 5 é a tela onde a carga é decidida: seleção por matriz e em massa por estado, filtros por
estado e por tag, busca por código e ordenação por número de células alteradas, com as inalteradas
recolhidas por padrão. Matriz `STRUCTURAL`, `BLOCKED` ou `ABSENT_IN_FILE` aparece com o motivo e a
ação sugerida, e **sem** caixa de seleção — não há caminho de tela que leve a aplicar o que a
regra proíbe. O passo 6 exige a nota da carga (mínimo de 10 caracteres, que vira a nota padrão de
cada publicação daquela carga), diz em números o que vai acontecer — *"cria 2 rascunhos. Não
publica nada."* — e, ao concluir, mostra o relatório com o atalho para a fila de revisão e a opção
de salvar o mapeamento como perfil.

Um rascunho criado por carga exibe, na tela de Rascunhos e no inspector da versão, a origem: *"Criado pela carga CINEMINHA_20260708 em 10/08/2026"*. É a única marca visual que distingue rascunho de carga de rascunho feito à mão — em tudo o mais eles são idênticos, inclusive na edição e no descarte.

## 15. Tags e filtro de matrizes

Um projeto com mais de algumas dezenas de matrizes não é navegável por lista. As tags (`03-modelo-do-documento.md` §5) resolvem isso sem congelar uma hierarquia:

- **No inspector da matriz**: campo de tags com autocompletar sobre o catálogo de kind `TAG`, mostrando o grupo de cada sugestão, e criação inline — digitar um nome que não existe oferece *"criar tag «Prioritária»"* com seletor de grupo (ou grupo novo). Criar tag pelo inspector cria o `CatalogItem` correspondente; remover a tag da matriz **não** apaga o item do catálogo.
- **Na lista de matrizes**: uma faixa de filtro com uma linha por grupo de tags. Dentro de um grupo, marcar duas tags é `OU` (`Canal: Digital` ou `URA`); entre grupos é `E` (`Canal: Digital` **e** `Cluster: G4`). Cada tag mostra a contagem de matrizes, e o filtro ativo aparece como chips removíveis com um "limpar tudo".
- **Na barra lateral**: o projeto exibe a contagem filtrada (`102 matrizes · 17 no filtro`) e o mesmo conjunto de chips, para que o filtro sobreviva à navegação entre telas.
- **Na tela de Conteúdo** (§11): a aba `TAG` ganha a coluna **Grupo**, editável em linha, e a contagem de uso passa a somar matrizes marcadas, não só células.
- Tag arquivada some dos filtros e do autocompletar, mas continua visível nas matrizes que já a têm, com a marca de arquivada — mesma regra dos demais itens de catálogo (`05-regras-de-negocio.md` §5.5).

O filtro é estado de interface (`ui-store`), não do documento: ele não é salvo no `.json` nem viaja entre pessoas.

## 16. Tela de acesso (ACL)

Rota `#/acl`, atrás do papel `ADMIN` (`14-plataforma-local.md` §6, S29) — item **Acesso** na
sidebar, visível só para `ADMIN`, e também em **modo aberto** (nenhuma ACL ainda, ou uma sem
nenhum `ADMIN`), porque alguém precisa poder criar o primeiro `ADMIN`. Fora dessas duas
condições, a rota mostra "Requer papel ADMIN — você é X" em vez do conteúdo.

- **Lista de usuários**: login (`username`) e papel por linha, adicionar por formulário (login +
  seletor de papel), remover por linha. Sem confirmação por linha — a mudança só grava ao clicar
  em "Salvar lista de acesso"; "Descartar alterações" volta ao que está no documento.
- **`defaultRole`**: seletor `READER`/`EDITOR` — o papel de quem não está na lista.
- **A invariante "nunca sem ADMIN" trava no próprio botão de salvar**, não só avisa depois: se a
  lista em edição tem usuários mas nenhum `ADMIN`, "Salvar" fica desabilitado com o motivo. Login
  duplicado na lista em edição tem o mesmo efeito.
- **Texto honesto** (mesma frase de `14-plataforma-local.md` §6, sempre visível no topo da tela):
  isto é organização, não segurança — quem tem acesso de escrita à pasta de rede sempre pode
  editar o arquivo do documento na mão, por fora da aplicação.
- Zerar a lista de usuários e salvar volta o documento ao modo aberto (`meta.acl` removida, não
  uma ACL com `users: []` — mesmo efeito para `resolveRole`, mas mantém o arquivo limpo).

## 17. Árvore da política (épico Governança — S33a ✅/S33b ✅; layout de §17.1 — S41 ✅, §17.5 — S42 🔮)

> O modelo por trás está em [`14-governanca-de-alteracoes.md`](14-governanca-de-alteracoes.md)
> §3.1 e §3.6. O comportamento de estrutura, cadastro e versionamento é o entregue nas S33a/S33b;
> **§17.1 (árvore na barra lateral) foi entregue na S41** e **§17.5 (página do componente no
> centro) descreve o layout alvo da S42** — DEC-UX-001 e DEC-UX-002.

A política deixa de ser "uma lista de matrizes num projeto" e passa a ser **um sumário navegável**:
seções, regras, listas e os nós que apontam as matrizes já existentes. O `Project` é a política
("Política de Crédito B2C"); a árvore é o corpo dela.

### 17.1 Onde a árvore vive — S41 ✅

**A árvore da política É a barra lateral esquerda** (§2) — não existe um segundo painel de árvore
dentro da tela (DEC-UX-001). Com ~101 nós de estrutura mais os nós das matrizes, duas listas
hierárquicas na mesma tela (a sidebar com dois níveis e o painel de 360px com a árvore inteira)
disputavam o mesmo trabalho e comiam metade da largura útil: o painel morreu e a sidebar recebeu a
árvore inteira, com largura arrastável.

```
┌───────────────┬──────────────────────────────────────────┬──────────────────┐
│ Projetos      │  BARRA DE FERRAMENTAS (§2.1)             │                  │
│ ▾ Pol. B2C 85 │  Política de Crédito B2C › CMA           │                  │
│  ▾ CMA     17 │  ▸ Bloqueios por Dívida                  │  (sem inspector) │
│   • Bloqueios │  (página do componente — §17.5)          │                  │
│   • Dívida≥5k │                                          │                  │
│  ▸ Decisões12 │                                          │                  │
│ Biblioteca    │                                          │                  │
│ Vigência      │                                          │                  │
└───────────────┴──────────────────────────────────────────┴──────────────────┘
```

- **A sidebar é uma coisa só**: `Projetos` → o projeto aberto se expande na **árvore inteira**
  (todos os níveis, não os dois primeiros) → abaixo dela, Biblioteca, Vigência, Diário de Bordo,
  Releases, Templates, Rascunhos, Comparação e Acesso, como em §2. Fechar o projeto recolhe a
  árvore inteira. A árvore acompanha o **projeto selecionado**, não a tela: clicar num nó estando na
  Biblioteca ou nas Releases leva de volta à tela da política com aquele nó selecionado.
- **Linha do nó**: chevron, ícone do tipo, nome, badge de estado/vigência (§3), `⚠` de revisão
  pendente, contagem de descendentes na seção e o menu `⋯` (visível no hover e sempre no nó
  selecionado). O `code` aparece à direita **a partir de 340px** de largura da sidebar — abaixo
  disso ele fica só no `title` e na página do componente, porque nome truncado é pior que código
  ausente.
- **O menu `⋯` do nó é a fonte única de ações estruturais**: Novo filho · Nova regra · Adicionar
  matriz… · Renomear (`F2`) · Mover para… · Duplicar (`Ctrl+D`) · Carregar Markdown aqui… ·
  Arquivar. As mesmas ações estão na barra de ferramentas (§2.1) aplicadas ao nó selecionado; a
  árvore e a barra chamam os mesmos comandos, nunca dois caminhos com regras diferentes. No menu,
  "Novo filho" e "Nova regra" nascem **dentro** do nó; na barra, "Nova seção" e "Nova regra" nascem
  **irmãs** do nó selecionado — a mesma semântica do `Enter`/`Shift+Enter` na árvore —, e sem
  seleção nascem na raiz da política.
- **Abrir e fechar em bloco**: `Recolher tudo` / `Expandir tudo` no cabeçalho da árvore na sidebar;
  `Alt+clique` no chevron abre/fecha a subárvore inteira daquele nó (o `*` com o nó em foco entra na
  S44, com o resto do teclado da árvore). Estado de expansão e filtros continuam em
  `ui-store.componentTree`, escopados por projeto — interface, não documento.
- **Busca e filtros vivem na barra de ferramentas** (§2.1), não dentro da árvore: campo de busca +
  botão `Filtrar (n)` abrindo um popover com os chips de tipo, `reviewStatus` e tag (`TagFilterBar`
  do §15) e "Limpar filtros". A árvore ganha altura útil de volta quando ninguém está filtrando: o
  primeiro nó aparece logo abaixo do cabeçalho do projeto, não a ~230px do topo.
- **Filtro não achata a árvore**: ao filtrar, os ancestrais dos itens que sobraram permanecem
  visíveis, esmaecidos (`filterComponentTree` devolve `matchedIds` e `visibleIds` separados). Uma
  árvore filtrada que vira lista plana faz o usuário perder o lugar.
- **A ordem é de leitura, e a tela diz isso** — a nota *"A ordem reflete o documento de política. A
  sequência de avaliação do motor está descrita no texto de cada regra."* fica no `title` do
  cabeçalho do projeto (e no do cabeçalho da árvore) e no diálogo de atalhos (§12), não ocupando
  duas linhas fixas no rodapé da navegação (`14-governanca-de-alteracoes.md` §3.6).
- **Centro sem nó selecionado**: a tela do projeto continua sendo a lista de matrizes com facetas
  do §15, **inalterada** — é a porta default (§17.2). Selecionar um nó não-`MATRIX` abre a página
  do componente (§17.5); selecionar um nó `MATRIX` navega direto para o grid. *Na S41 o componente
  selecionado continua em `ComponentContentPanel` (centro) + `ComponentInspector` (direita); a
  página do §17.5 é a S42.*
- **Breadcrumb clicável** no topo do centro (`Política de Crédito B2C › CMA › Bloqueios por
  Dívida`) — suporta os 6 níveis possíveis (`componentPath`).

### 17.2 Duas portas para a mesma matriz

A tela de matrizes com filtro por facetas (§15) **continua existindo e não é substituída**. A regra
de convivência, dita na interface:

> **A árvore diz onde a matriz mora. A lista com facetas diz como achá-la.**

- Um nó `MATRIX` aponta **uma** matriz já existente no projeto (as matrizes vêm do épico Carga —
  a árvore nunca as cria). Um capítulo como "Canal Digital" é uma **seção** com N nós `MATRIX`
  filhos, um por matriz.
- O nó exibe o badge de estado e vigência da matriz espelhada (§3) e navega para o grid.
- Criar o nó = escolher, num seletor com busca e filtro por tag, entre as matrizes do projeto
  **ainda não referenciadas** (I23).
- O editor de matriz mostra o caminho na árvore no breadcrumb, venha o usuário da árvore ou da
  lista.

### 17.3 Cadastrar em volume é o caso de uso, não o caso de borda ✅

A primeira versão da política é digitada à mão, incrementalmente
(`14-governanca-de-alteracoes.md` §4, US-GOV-01). São ~50 seções e ~50 regras: a diferença entre
um formulário modal e um fluxo de teclado é a diferença entre duas tardes e duas semanas.

| Ação | Comportamento |
|---|---|
| `Enter` num nó | Cria um **irmão** logo abaixo, já em edição de nome, com um seletor compacto de tipo (`SECTION` por padrão, herdando o tipo do nó de origem) |
| `Tab` / `Shift+Tab` na criação | Desce / sobe **um nível** relativo ao nó onde `Enter` foi pressionado (filho dele / irmão do pai dele) — reparenta antes de gravar, validando profundidade (I28) |
| `Ctrl/Cmd+D` | `component/duplicate`: duplica o nó como irmão logo abaixo, com sufixo `_COPIA` no `code`; copia `tags`/`origin`; se havia versão, o payload mais recente vira rascunho 1 da cópia — sem herdar `PUBLISHED`. `MATRIX` não duplica (espelho único) |
| Arrastar, ou menu "Mover para…" | Drag-and-drop no próprio painel (antes/depois/dentro, conforme a posição do ponteiro na linha) ou diálogo com busca + Início/Fim; os dois chamam `component/move`, que valida ciclo e profundidade (I28) |
| Criar nó `MATRIX` | "Pendurar matriz" na barra de ferramentas (§2.1), ou "Adicionar matriz…" no menu `⋯` de um nó — seletor com busca e filtro por tag sobre as matrizes do projeto ainda não referenciadas (`AddMatrixNodeDialog`, I27) |

**Entregue na S33b**: colar bloco de texto no inspector reconhecendo prefixo de linha (parágrafo
solto → `businessDescription`; `Definição técnica:` → `technicalDefinition`; `Observação:` →
`reasonCodes` + `outcome` + `notes`), com **preview antes de aplicar** — botão "Colar bloco de
texto" no formulário de `RULE` (`PasteRuleDialog`, `recognizeRulePaste` em
`src/core/versioning/rule-paste.ts`). Reconhecimento de prefixo simples, deliberadamente menor que
o vocabulário do Markdown convertido de `14-governanca-de-alteracoes.md` §9.1 — é o texto **cru**
do documento Word, não o Markdown já estruturado da carga por recorte opcional (S40, DEC-GOV-024).

### 17.4 Vigência da fundação — S33b ✅

Publicar ~100 componentes que **já vigoram** não custa ~100 diálogos de publicação.

- Nas propriedades do projeto (diálogo "Editar projeto"): **"Vigência da fundação"** — uma data,
  opcional, `Project.foundationEffectiveFrom` (RN-GOV-09), definida uma vez e sempre editável.
- O diálogo de publicação da **primeira** versão de um componente já vem com essa data sugerida no
  campo de vigência — e continua editável antes de confirmar.
- Ação **"Publicar pendentes"** na barra de ferramentas (§2.1, contador de pendentes no rótulo do botão):
  lista todo componente do projeto com rascunho em aberto, uma vigência para o lote inteiro
  (sugerida pela fundação), desmarcação item a item, e publica o que ficou marcado **tudo ou
  nada** (RN-GOV-05) — um comando puro só, `componentVersion/publishPending`, não N publicações em
  sequência (DEC-GOV-023).
- O aviso da RN-GOV-07 (publicação direta, sem DB) aparece **uma vez** no diálogo do lote, não uma
  vez por item; no diálogo de publicação individual, aparece normalmente para aquele item.

### 17.5 Página do componente — o centro da tela

O componente é o objeto mais editado do produto: é onde a política é escrita. Por isso ele ocupa o
**centro**, em coluna de leitura larga (máx. 960px, centralizada), e não um painel de 340px
(DEC-UX-002). Um documento que rola, na ordem em que se trabalha — identidade, conteúdo,
especificação, histórico —, sem abas: quem digita a regra precisa ver a definição técnica e a
especificação na mesma rolagem.

```
Política de Crédito B2C › CMA › Bloqueios por Dívida         ‹ anterior  próximo ›
📄 Bloqueios por Dívida   BLOQUEIOS_POR_DIVIDA   [Regra] [Validado] [Rascunho v2]
┌────────────────────────────────────────────────────────────────────────────┐
│ Rascunho v2 · desde 30/09/2025      [Publicar] [Descartar rascunho]    ⋯   │ ← grudenta
├────────────────────────────────────────────────────────────────────────────┤
│ Tags [G1 ×][Digital ×] +      Origem  [Filtros…docx] [seção 4.2]           │
│ Revisão [Validado ▾]          Itens filhos 0                               │
├────────────────────────────────────────────────────────────────────────────┤
│ Descrição de negócio *                                                     │
│ ┌────────────────────────────────────────────────────────────────────────┐ │
│ │                                                                        │ │ ≥6 linhas
│ └────────────────────────────────────────────────────────────────────────┘ │
│ Definição técnica            │ Resultado                                   │
│ Entradas [chip][chip] +      │ Reason codes [chip] +                       │
├────────────────────────────────────────────────────────────────────────────┤
│ Especificação (editor rico §18)                                            │
├────────────────────────────────────────────────────────────────────────────┤
│ Vigência e versões  ▉▉▉▉▉▉▉▉▉▉▏  v1 30/09/2025 → hoje   [Ver a política…] │
└────────────────────────────────────────────────────────────────────────────┘
```

| Faixa | Conteúdo |
|---|---|
| **Cabeçalho** | Breadcrumb clicável; ícone do tipo; **nome em edição inline** (clique ou `F2`, `Enter` confirma, `Esc` cancela); `code` em fonte mono (somente leitura, imutável); badges de tipo, revisão e estado da versão; `‹ anterior` / `próximo ›` navegam entre **irmãos** na ordem da árvore (`Alt+↑` / `Alt+↓`) |
| **Barra de ações grudenta** | Fica colada abaixo do cabeçalho ao rolar. Estado do conteúdo à esquerda (`Sem conteúdo` · `Rascunho v2` · `Vigente v1 desde …`), ações de ciclo de vida no meio (**Criar rascunho** / **Publicar** / **Descartar rascunho**, ou **Documentar esta seção** numa `SECTION` pura) e `⋯` com Mover para…, Duplicar e Arquivar |
| **Identidade** | Tags (`ComponentTagsEditor`), origem (fonte + locator), `reviewStatus` (`Select` com os 4 estados, incluindo promover a `VALIDATED`, sempre escolha explícita) e contagem de filhos — em grade de 2 colunas, largura total |
| **Conteúdo da versão** | Os campos do payload por tipo (abaixo), em largura útil: campos longos ocupam a coluna inteira com no mínimo 6 linhas visíveis e crescem com o texto; campos curtos pareiam 2 por linha; campos de lista (`inputs`, `reasonCodes`, `dependencies`) são **chips** — digitar e `Enter` (ou vírgula) adiciona, `Backspace` no campo vazio remove o último, colar texto separado por vírgula vira N chips |
| **Especificação** | O editor rico (§18) na mesma coluna, com "Comparar com a publicada" quando há rascunho sobre versão publicada |
| **Vigência e versões** | `MatrixTimelineBar` sobre `getComponentTimeline`, um segmento por versão, tooltip com o período, e **"Ver a política inteira nesta data"**, que abre a tela de Vigência (§10) naquela data |

Campos por tipo (`14-governanca-de-alteracoes.md` §3.2), inalterados desde a S33b — o que muda é
o espaço que eles ocupam:

| Tipo | Campos |
|---|---|
| `RULE` | Descrição de negócio (obrigatória) · Definição técnica · Entradas · Condições · Resultado · Reason codes · Dependências · Notas |
| `SECTION` | Pasta pura por padrão; **"Documentar esta seção"** cria a primeira versão (payload `OTHER`) e dá à seção texto, vigência e histórico como qualquer outra (I29) |
| `LIST`, `REASON_CODE`, `POLICY_VARIABLE`, `OTHER` | O payload do tipo, com o mesmo tratamento de campo longo/curto/chips |

Regras de comportamento:

- **Commit por campo ao perder o foco**, como hoje; a barra grudenta mostra `Salvando…`/`Salvo`
  junto ao estado da versão, para que quem rola 800px de formulário não precise ir ao rodapé
  conferir.
- **Sem rascunho aberto**, os campos aparecem **somente leitura** com o aviso *"Versão 1 vigente
  desde 30/09/2025 — crie um rascunho para editar"* e o botão **"Criar rascunho a partir desta
  versão"**. Nunca campos editáveis que descartam o que foi digitado.
- **`MATRIX`** continua sem página própria: o nó navega direto para o grid (§17.2).
- **`POLICY_VARIABLE`** espelhando a Biblioteca mostra o card da variável (nome, contagem de
  domínios da versão publicada) com "Ir para a Biblioteca", sem duplicar os domínios.
- **Nenhum inspector à direita** nesta tela — o painel não é renderizado (§2).

### 17.6 Carga por recorte — S40 ✅

`MarkdownImportDialog` (`src/components/import/markdown/`), aberto pela barra de ferramentas (§2.1,
"Carregar Markdown") ou pelo menu `⋯` de um nó ("Carregar Markdown aqui…", pré-seleciona o destino) —
diálogo, não uma rota própria, porque o destino já é o contexto de onde o usuário estava
(DEC-GOV-027). Três passos, no padrão visual do assistente de carga de matrizes (§14):

1. **Destino e texto**: seletor de destino igual ao de "Mover para…" (busca + "Raiz da política"),
   e uma área de texto para colar o Markdown (ou **Selecionar arquivo…** para um `.md`/`.txt`).
2. **Revisão**: a árvore proposta, achatada em linhas indentadas por profundidade — checkbox para
   incluir/excluir (excluir leva a subárvore junto), `Select` de tipo por linha (os seis tipos que
   o Markdown pode produzir, `MATRIX` fora), badge "heurística" quando o tipo não veio de
   `> Tipo:` explícito, e a mensagem de cada problema da linha (aviso ou bloqueio, este último em
   vermelho — duplicata de `code`, profundidade além de I28). "Avançar" só libera sem bloqueio.
3. **Confirmação**: vigência da carga (sugerida pela vigência da fundação do projeto, RN-GOV-09,
   sempre editável) e o resumo do que vai acontecer; "Confirmar carga" aplica
   `component/importMarkdown` em lote e mostra o total criado. Fechar depois do sucesso expande o
   destino na árvore.

Nada entra sem passar pelo passo 2, e desfazer (`Ctrl+Z`) logo em seguida remove a carga inteira —
o undo é dedicado, não a composição genérica de inversos que a carga de matrizes usa, porque
publicar é irreversível por natureza (DEC-GOV-026).

## 18. Editor rico de especificação (épico Governança — S34 ✅)

Contrato do modelo em `14-governanca-de-alteracoes.md` §7 e `03-modelo-do-documento.md` §12.3;
núcleo em `src/core/richdoc/`, componentes em `src/components/richdoc/`. O editor aparece no campo
**Especificação** da página do componente (§17.5) — o placeholder da S33 morreu aqui — e a S35
o pluga nos campos de texto do Diário de Bordo.

### 18.1 Um `contentEditable` por linha, nunca um global

Cada bloco de texto é uma linha editável própria; cada item de lista é a sua. Célula de tabela é um
campo comum (`<input>`), porque no modelo ela é texto puro. Nada de um `contentEditable` único
envolvendo o documento inteiro: com um só, o browser decide sozinho o que é parágrafo, e o que
volta do DOM deixa de casar com o modelo.

**Cada tecla vira comando** (`richdoc/apply`, `08-camada-de-comandos.md` §3). Não existe "salvar o
texto" no editor: o documento em memória já está atualizado quando a tecla sobe, e é por isso que
nada digitado se perde ao trocar de tela, salvar por `Ctrl+S` ou fechar a aba. O que impede a pilha
de undo de virar uma entrada por caractere é a coalescência (`coalesceKey`, DEC-GOV-028): digitação
contígua no mesmo bloco é **uma** entrada.

### 18.2 Atalhos e gestos

| Gesto | O que acontece |
|---|---|
| Digitar | Vira comando na hora; a sequência no mesmo bloco coalesce numa entrada de undo |
| `Ctrl+Z` / `Ctrl+Shift+Z` (ou `Ctrl+Y`) | Desfaz/refaz **dentro do editor** — interceptado ali para não disparar o desfazer nativo do `contentEditable`, que mexeria no DOM sem passar pelo documento |
| `Ctrl+B` / `Ctrl+I` | Negrito/itálico no trecho **selecionado** (com o cursor sem seleção, o editor avisa em vez de marcar) |
| `Enter` | Divide o bloco no cursor. Em título, a segunda metade nasce parágrafo; em lista, divide o item; em tabela/imagem, cria um parágrafo depois do bloco |
| `Backspace` no início | Item de lista funde com o item anterior; primeiro item vira parágrafo antes do resto da lista; título/citação/destaque viram parágrafo (tira o formato antes de fundir); parágrafo funde com o bloco de texto anterior. Sem nada atrás, não faz nada |
| `↑` / `↓` nas bordas | Move o cursor para a linha anterior/seguinte (fim/começo dela) |
| `/` numa linha vazia | Abre o menu de inserção da linha — mesma lista do botão "+" |
| Colar | Sanitiza (§18.3): texto vira parágrafo, tabela HTML vira bloco `table`, o resto vira texto puro |

A barra do editor tem negrito, itálico, código, link e o menu **Inserir**; cada bloco mostra, ao
passar o mouse ou receber foco, os controles de inserir abaixo, mover para cima/baixo e remover.
Bloco de tabela ganha ainda os botões de linha/coluna. Link abre um campo de endereço na própria
barra e aplica a marca `link` ao trecho selecionado — intranet, arquivo ou pasta de rede, já que a
aplicação não fala com a internet (regra 5).

### 18.3 Colar do Word e do Excel

O que sobrevive é **estrutura**; o que morre é **formatação** (DEC-GOV-030). Tabela do Excel vira
bloco `table` com a primeira linha como cabeçalho e o corpo retangular (linha curta ganha célula
vazia, sobra é cortada). Lista do Word — que chega como parágrafos começando com `·` — vira
`bulletList`; `1.`/`a)` viram `numberList`. Um parágrafo colado dentro de uma linha entra **no
cursor**, sem criar bloco; um colar com vários blocos entra depois do bloco corrente, ou no lugar
dele quando ele está vazio. Colar imagem não é suportado nesta fase: anexar é explícito.

### 18.4 Imagens

Menu **Inserir → Imagem** abre o seletor de arquivo; o cliente reduz a imagem para no máximo
1600 px no maior lado e reencoda (PNG primeiro quando a origem é PNG; JPEG com qualidade em degraus
quando precisa caber). Teto de **300 KB por imagem** — acima disso o erro é `E-GOV-05`, com o
tamanho e o teto na mensagem. Passando de **3 MB** de anexos no documento, um aviso aparece; é
aviso, não bloqueio. A imagem vira um `INLINE_IMAGE` em `attachments` (`03-modelo-do-documento.md`
§8.1) e um bloco `image` com legenda opcional; remover o bloco leva o anexo junto quando ele fica
órfão (DEC-GOV-031).

### 18.5 Diff por bloco

`RichDocDiffView` mostra base à esquerda e comparada à direita, uma linha por mudança, com o
`Badge` dizendo o que aconteceu — mesmo vocabulário visual do diff de matriz (§9). Blocos idênticos
ficam fora por padrão. O diff é **por bloco**, sem realce dentro do parágrafo, e enxerga movimento
(DEC-GOV-029). No inspector do componente, o botão **Comparar com a publicada** troca o editor pelo
diff entre o rascunho e a versão vigente; a S36/S39 reusam a mesma peça para "hoje × proposto" e
para a fotografia histórica.

## 19. Diário de Bordo — DB, fila e pendências (épico Governança — S35 ✅/S36 ✅/S37 ✅)

Contrato do modelo em `14-governanca-de-alteracoes.md` §3.3/§4/§5; `src/components/change-requests/`.
Uma `View` própria (`'change-requests'`, hash `#/db`), item fixo da barra lateral com o mesmo
padrão visual de "Rascunhos" (badge com a contagem de `awaitingReview`, §19.3) — não uma sub-rota
de `ProjectDetail`, porque a fila de aprovação (US-GOV-04) cruza projetos e a lista document-wide já
resolve o filtro "por projeto" (§19.1) sem precisar herdar a árvore da barra lateral (§17.1).

### 19.1 Lista de DBs

`ChangeRequestsScreen`: busca por código/título, `Select` de projeto/status/prioridade e um
`Combobox` de componente — os quatro filtros passam direto para `listChangeRequests`
(`src/core/document/change-requests.ts`), que deriva "projeto do DB" dos componentes dos itens
(`ChangeRequest` não guarda `projectId`, DEC-GOV-032). Cada linha mostra código, título, badge de
status (uma cor por estado, `src/lib/change-request-labels.ts`), prioridade e solicitante; clicar
abre o detalhe no lugar da lista (`editor-store.selectedChangeRequestId`, mesmo padrão de
`selectedComponentId`). **A fila de aprovação (US-GOV-04) é esta mesma lista**, filtrada por status
`SUBMITTED`/`IN_REVIEW`: abrir qualquer DB nesse filtro já mostra a especificação completa e as
ações de decisão (§19.3) — não existe uma segunda tela.

### 19.2 Criar e editar

"Novo DB" abre um diálogo mínimo — título e código, sugerido sequencialmente a partir do maior
`DB_<n>` do documento e sempre editável (I26, `suggestNextChangeRequestCode`, DEC-GOV-032) — e nasce
em `DRAFT`. O resto entra no detalhe (`ChangeRequestDetail`), sem wizard: motivadores primeiro,
depois itens, impactos, critérios, testes e vigência — a ordem do fluxo é a ordem vertical da tela,
não passos de um assistente:

- **Motivadores**: `CatalogChipPicker` — escolher entre `CatalogItem` de kind `MOTIVATOR` ou criar
  inline, mesmo padrão de `ComponentTagsEditor` (S23) generalizado sem grupo.
- **Itens**: "Adicionar item" abre `AddChangeRequestItemDialog` (busca sobre `filterComponentTree`
  do projeto — mesmo esqueleto de busca+lista clicável de `AddMatrixNodeDialog`, §17.2), filtrado
  pelos componentes que ainda não estão no DB (RN-GOV-02). Ao escolher, `currentSummary` nasce do
  `businessDescription` da versão vigente (`getComponentCurrentSummary`, `src/core/queries.ts`) —
  ou "Não existe — sem versão vigente hoje." sem versão —, `changeType` nasce `UPDATE`/`CREATE`
  conforme houver versão vigente, e `proposedSummary` nasce com o placeholder "A definir." (o
  schema exige não-vazio: um item nunca entra sem texto algum, mesmo que ainda por editar) — o
  analista edita os três campos por blur em `ChangeRequestItemRow`. Antes do primeiro item, um
  `Select` de projeto escopa a busca (estado só de UI — o DB em si não guarda projeto, §19.1); a
  partir do primeiro item, o projeto trava no dele.
- **Impactos/critérios/testes**: `ImpactsEditor`/`AcceptanceCriteriaEditor`/`TestScenariosEditor`
  — linha em digitação fica **fora** do array até os campos obrigatórios estarem preenchidos
  (`given`/`then` do critério, `kind`/`description` do teste, `category` do impacto), porque
  `changeRequest/update` não valida conteúdo campo a campo — quem impede string vazia é a tela.
  Categoria de impacto usa o mesmo catálogo/criação inline dos motivadores, mas como `Select` (uma
  só por linha, não multi-chip).
- **Motivação e especificação**: `RichDocEditor` (§18) nos dois campos — `RichDocTarget` ganhou
  `CR_MOTIVATION`/`CR_SPEC` (`src/core/richdoc/commands.ts`, extensão prevista desde a S34,
  DEC-GOV-032), editável enquanto o DB não estiver fechado (mesmo critério de
  `changeRequest/update`, não o congelamento de itens de I30 — motivação/especificação continuam
  editáveis depois de `APPROVED`, só param em `PUBLISHED`/`REJECTED`/`CANCELLED`).

### 19.3 Workflow na tela

Os botões de transição vêm de `allowedTransitions(status)` (`src/core/document/cr-workflow.ts`,
grafo de docs/14 §5), um por destino — exceto o trio de `IN_REVIEW`, que usa sempre os comandos de
decisão (nunca `changeRequest/transition` puro, docs/14 §5.1 item 4):

- **`DRAFT`**: um aviso lista o que falta para `SUBMITTED` (`missingForSubmit`, RN-GOV-03) sempre
  que houver pendência; "Submeter" fica visível de qualquer forma — clicar sem tudo pronto volta o
  erro `E-GOV-03` pronto do catálogo (`src/core/error-messages.ts`) num toast, em vez de travar o
  botão silenciosamente.
- **`IN_REVIEW`**: três botões — Aprovar / Devolver / Rejeitar — abrem `DecisionDialog`, com
  comentário **obrigatório só na devolução** (US-GOV-04) e o aviso de RN-GOV-04 ("aprovar não
  publica nada") sempre visível no corpo do diálogo de aprovação e, depois, como alerta permanente
  quando o status é `APPROVED`.
- **Demais estados não terminais**: botão genérico "Mover para `<estado>`" por transição permitida
  — inclusive a cadeia `IN_DEVELOPMENT → IN_VALIDATION → READY_FOR_RELEASE → SCHEDULED`, que não
  depende de nenhuma feature da S36+ (são transições puras do grafo).
- **"Publicar"** (S36): habilitado a partir de `READY_FOR_RELEASE` (os dois estados de
  `RELEASE_READY_STATUSES`), abrindo `PublishChangeRequestDialog` (§19.5). Antes disso o botão
  aparece **desabilitado**, com tooltip dizendo em que estado o DB está e a partir de qual ele
  publica — desabilitar sem explicar é o que faz o usuário procurar o botão em outro lugar.
- **"Cancelar DB"**: quando `CANCELLED` está entre as transições permitidas, com confirmação
  (`ConfirmDialog`).
- Itens ficam desabilitados a partir de `APPROVED` (I30, `isChangeRequestFrozen`) — os campos
  continuam visíveis, só param de aceitar edição; "Adicionar item"/"Remover item" somem, e com eles
  (S36) "Vincular rascunho" e "Desvincular". O que **não** some é "Ver rascunho" e o comparativo: um
  DB aprovado continua sendo lido, e é justamente aí que o gestor confere o que aprovou.

A trilha (`ChangeRequestEventLog`) lista `changeRequest.events` mais recente primeiro, ícone por
tipo de evento (só os cinco `CR_*` chegam ali, DEC-GOV-019) e "ver dados" para o `payload` bruto —
mesmo esqueleto visual do histórico de versão de matriz (`VersionHistoryDialog`), sem o dropdown de
filtro (a trilha é de um DB só, não do documento inteiro).

### 19.4 Painel de pendências (US-GOV-10)

`ChangeRequestPendingPanel`, na tela do documento (`DocumentScreen`) — "ao abrir o documento" do
enunciado da história é a tela que aparece assim que o arquivo carrega, não uma tela nova. Três
filas (`getChangeRequestPendingSummary`, `src/core/document/change-requests.ts`): **aguardando
revisão** (`SUBMITTED`/`IN_REVIEW`), **devolvidos** (`CHANGES_REQUESTED`) e **aprovados sem
release** (passou de `APPROVED`, não fechou, sem `releaseId`). O painel some quando as três estão
vazias. Um checkbox "Só as minhas" filtra por `requestedBy`/`owner`/autor de alguma decisão
batendo com o nome digitado (`useActor`) — texto fixo no painel deixa explícito que isso é filtro,
não controle de acesso: papéis são declarativos e qualquer pessoa vê e age sobre qualquer DB
(DEC-GOV-004). Clicar numa linha abre o DB direto no detalhe (mesma navegação de §19.1).

### 19.5 Vínculo do rascunho e publicação (S36)

O item do DB ganhou uma faixa própria (`ChangeRequestItemRow`), abaixo do "hoje × proposto", com o
**rascunho vinculado** — o conteúdo exato que vai entrar em vigor, em oposição ao texto do
"proposto", que é a intenção declarada. Os dois convivem de propósito: um é a promessa, o outro é o
que está escrito no rascunho.

- **Badge de estado**: "Vinculado" ou "Sem rascunho". Sem rascunho, uma linha explica o que aquilo
  significa **para aquele tipo de alteração** — pendência que trava a publicação em `UPDATE`/`CREATE`
  (`E-GOV-04`), esperado em `MOVE`/`DEACTIVATE`/`REACTIVATE`, opcional em `DOC_ONLY`.
- **"Vincular rascunho"** dispara `changeRequest/linkDraft`: cria ou adota o rascunho e abre o
  comparativo. Em componente sem versão nenhuma (o caso do item `CREATE`), o texto do "proposto" vira
  a descrição de negócio da v1 — o rascunho precisa nascer com conteúdo, e digitar duas vezes a mesma
  frase é trabalho que o produto não deve pedir.
- **"Editar rascunho"** navega para onde ele se edita de verdade: a árvore da política (§17) para
  componente, o grid (§4) para matriz. Nada de um segundo editor dentro do DB.
- **"Desvincular"** abre `UnlinkDraftDialog`, que existe por uma regra só: **desvincular não descarta
  sem confirmação** (docs/14 §3.3). O padrão é soltar e deixar o trabalho no componente; descartar é
  uma caixa a marcar, e o botão muda de rótulo e de cor quando ela está marcada.
- **"Ver atual × proposto"** abre `ChangeRequestItemDiff`, o comparativo rico de US-GOV-08: diff de
  payload **campo a campo** (rótulos em pt-BR, mesmo vocabulário de badge do diff de matriz), diff da
  especificação **por bloco** (`RichDocDiffView` da §18.5, sem alteração) e — para item de espelho
  `MATRIX` — um botão que leva à tela de comparação de versões (§9) com o par já escolhido, porque
  matriz não se compara em lista de campos.

**Publicar** (`PublishChangeRequestDialog`) é o espelho fiel da validação do núcleo, e não uma
segunda opinião sobre ela:

1. **O plano**: uma linha por item dizendo o que vai acontecer — "Publica a versão 2", "Arquiva o
   componente", "Sem efeito na publicação". Item que não faz nada aparece dizendo isso, em vez de
   sumir e deixar a dúvida.
2. **As pendências** (`E-GOV-04`): a lista inteira num alerta, e o botão travado. A mesma lista que o
   comando devolveria — o usuário não descobre uma por vez.
3. **A base desatualizada** (`E-GOV-02`): um cartão por componente, com "Rever contra a nova
   vigente" — que abre o comparativo do rascunho contra a versão que **passou a ser** a vigente, não
   contra a base declarada — e uma caixa de reconfirmação que só habilita depois de o comparativo ter
   sido aberto. É uma decisão por item, nunca um "confirmar tudo".
4. **A vigência não se edita aqui**: é a do DB, e mudá-la é editar o DB. O diálogo diz a data e
   lembra que publicar não pode ser desfeito.

Publicado, o DB vira `PUBLISHED` (estado final), a trilha ganha "publicou a solicitação …", e a
timeline de cada componente afetado passa a mostrar o DB como origem da versão nova — em matriz, pelo
carimbo no evento de publicação (docs/14 §10, CT-GOV-06).

### 19.6 Release: conteúdo, status por DB e publicação em lote (S37)

Duas telas próprias na sidebar — "Diário de Bordo" (§19.1–19.5), "Releases" e "Linha do tempo do DB"
(§19.7) — em vez de abas dentro da tela do DB: as três respondem perguntas diferentes (o que fazer com
*este* DB; o que entra *nesta* subida; o que mudou *ao longo do tempo*), e nenhuma delas é sub-rota
das outras. `ReleasesScreen`/`ReleaseDetail` (`src/components/change-requests/`), `View` própria
(`'releases'`, hash `#/releases`), `editor-store.selectedReleaseId` no mesmo padrão de
`selectedChangeRequestId`.

- **Lista** (`ReleasesScreen`): busca por código/nome, badge do **status conjunto**
  (`deriveReleaseJointStatus`, `src/core/document/releases.ts`) — derivado dos DBs vinculados, não o
  `Release.status` bruto: `EMPTY` (sem DB), `IN_PROGRESS` (tem DB, algum não pronto), `READY` (todos
  prontos para publicar), ou o terminal `PUBLISHED`/`CANCELLED` do próprio `Release.status`, que vence
  a composição. "Nova release" pede só o código (rótulo de calendário, "2026.09.01" — I31, sem a
  máscara de `code` de DB/componente); nome, data planejada e observação são opcionais e entram no
  detalhe.
- **Detalhe** (`ReleaseDetail`): nome/data planejada/observação editáveis enquanto a release estiver
  aberta (`PLANNED`/`IN_DEVELOPMENT`); data planejada × publicada lado a lado (`publishedAt`/
  `publishedBy`, escritos só por `release/publish`). "O que entra na subida" lista os DBs vinculados
  (`listReleaseChangeRequests`) com status individual e vigência própria — clicar numa linha abre o DB
  no detalhe (§19.1); "Adicionar DB" abre `AddChangeRequestToReleaseDialog`, que já filtra a lista para
  DB **≥ `APPROVED`**, aberto e sem release — a regra de verdade é do comando
  (`changeRequest/setRelease`, docs/14 §3.4), a tela só evita oferecer um clique que ele recusaria.
  Tirar um DB (`X` na linha) não tem essa exigência: sai livremente enquanto o DB continuar aberto —
  "até a publicação" é o próprio DB fechar, não a release.
- **Publicar** (`PublishReleaseDialog`) é o mesmo espelho fiel de `PublishChangeRequestDialog`
  (§19.5), uma camada acima: um bloco por DB com o resumo do plano; pendências (`E-GOV-04`) e bases
  desatualizadas (`E-GOV-02`) vêm **agregadas de todos os DBs juntos**, cada uma carimbada com o código
  do DB de origem — não existe diff embutido aqui (a release pode ter muitos DBs); o botão "Rever o
  comparativo" leva direto ao DB para reconfirmar de lá, e a caixa de reconfirmação libera o botão só
  depois disso. Publicar chama `release/publish` (`src/core/document/release-publish.ts`), que roda
  `changeRequest/publish` **por DB, na mesma transação** (DEC-GOV-008) — reaproveitar a publicação do
  DB, não reescrevê-la, é o que garante que a atomicidade e o rebase de RN-GOV-02 continuam valendo
  sem duplicar lógica. **Cada DB publica com a sua própria vigência** — não existe data única de
  release (docs/14 §3.4). Papel mínimo `PUBLISHER`, mesma linha de `changeRequest/publish` (docs/08
  §6).
- **Cancelar release** (`release/cancel`, já da S32b) fica no detalhe; não mexe nos DBs vinculados,
  que continuam apontando a release cancelada até alguém os mover.
- O detalhe do DB (`ChangeRequestDetail`) ganhou um selo "release `<code>`" ao lado do status, quando
  `changeRequest.releaseId` estiver definido — link direto para o detalhe da release, mesma direção
  contrária de navegação que a lista de DBs da release já oferece.

### 19.7 Linha do tempo do Diário de Bordo (US-GOV-08 parcial, S37)

`ChangeRequestTimelineScreen` (`View` `'db-timeline'`, hash `#/db-timeline`) — mesmo padrão visual da
tela de Vigência (`TimelineScreen`, §10, S15): cartão por entrada, filtro no cabeçalho, sem abas. A
régua aqui é diferente da de Vigência: não é "a política numa data", é "a história das mudanças" —
`getChangeRequestTimeline` (`src/core/queries.ts`) lista os DBs **publicados**, mais recente primeiro
por `proposedEffectiveDate` (a vigência que de fato valeu), com:

- os **componentes afetados** (chips com ícone por tipo, `COMPONENT_TYPE_ICONS`);
- a **release** de origem, quando publicado em lote — chip clicável para `ReleaseDetail` (§19.6); DB
  publicado individualmente (sem release, RN-GOV-07 continua valendo em cima disso) não mostra chip
  nenhum;
- "Abrir o DB" para o detalhe completo (§19.1–19.5).

Filtros: projeto (um componente afetado daquele projeto — mesmo critério de
`changeRequestProjectIds`, já usado no filtro de projeto da lista de DBs, DEC-GOV-032) e período
(`from`/`to` sobre a vigência, inclusive nas duas pontas). Nenhum dos dois é obrigatório; sem filtro,
a timeline inteira aparece. DB **não publicado** nunca entra — é a fila de pendências (§19.4) que
mostra o que ainda está em andamento; esta tela é só o que já virou fato.

A comparação entre duas datas e a comparação release × release ficaram para a S39 e são a §20.

## 20. Fotografia e comparação da política (épico Governança — S39 ✅)

Duas telas para as duas perguntas de auditoria da US-GOV-07/08: "qual era a política vigente em
15/05?" e "o que mudou desde março?". Nenhuma regra mora nelas — `getPolicyAt` e
`diffPolicySnapshots` (`05-regras-de-negocio.md` §6.2/§6.3) fazem a consulta, as telas leem e
desenham.

### 20.1 A fotografia é uma tela, não um estado da árvore

Perguntar "o que valia em 15/05?" é **leitura**, e leitura tem tela própria: a de Vigência (§10),
que mostra a estrutura inteira do projeto na data — regras, listas, variáveis e matrizes juntas.

A árvore da barra lateral (§17.1) é **sempre hoje**: é por onde se navega e se edita, e não entra
em modo somente leitura (DEC-UX-004). Isso elimina o estado duplo que existia antes — árvore
"congelada" com botões sumindo, menus inertes e inspector bloqueado —, sem perder nenhuma das
leituras do passado, que agora vivem todas na tela de Vigência:

- `v{n}` da versão vigente naquela data, *"sem política vigente em dd/mm/aaaa"* no conteúdo sem
  versão ali e `estrutura` na seção pura (I29);
- o que não existia na data some junto com a subárvore; o arquivado depois daquele dia continua
  aparecendo (`05-regras-de-negocio.md` §6.2);
- conteúdo daquela versão em somente leitura ao selecionar o nó, com banner de versão histórica;
- **"Abrir no editor (hoje)"** em qualquer nó, para sair da consulta e editar no presente.

### 20.2 Salto a partir da timeline do componente (§17.5)

Na faixa de vigência da página do componente, clicar num segmento — ou o botão **"Ver a política
inteira nesta data"** — abre a tela de Vigência na data em que aquela versão passou a vigorar. É a
continuação natural: a pergunta depois de "quando esta regra mudou?" é sempre "e o que mais valia
naquele dia?".

### 20.3 Tela de comparação (`View` `'policy-compare'`, hash `#/politica/comparar`)

`PolicyCompareScreen` — seletor de projeto, duas abas e **dois seletores**:

- **Data × data**: dois campos de data, com os mesmos atalhos da tela de Vigência (§10). A ordem
  não importa: a base é sempre a mais antiga (§9).
- **Release × release**: dois seletores de release publicada. Cada release vira data pela sua janela
  de vigência (DEC-GOV-040) — a base entra pelo instante *antes* dela, a comparada pelo instante
  *depois* da sua. **A mesma release dos dois lados** (o padrão, com a mais recente pré-selecionada)
  responde "o que esta release mudou". Sem release publicada, a aba diz o que falta em vez de
  mostrar uma tela vazia.

O cabeçalho do resultado traz as duas pontas, os totais (adicionados · alterados · removidos), os
contadores do período da US-GOV-07 (vigentes no fim, DBs publicados no período, DBs em andamento) e
dois atalhos **"Ver a política em …"**, que abrem a tela de Vigência (§10) na data de cada ponta.

Abaixo, as mudanças **agrupadas por seção** da árvore (raiz do projeto por último). Cada cartão traz
nome, código, tipo, o rastro de versão (`v1 → v2`, "não existia" / "não vigora mais") e o detalhe
conforme a origem:

- **componente**: o payload campo a campo (só os campos que mudaram, `antes → depois`) e, quando há
  especificação rica, a contagem de blocos novos/alterados/removidos/movidos (§18.5);
- **matriz**: o resumo semântico do diff existente (§9), não as células — com **"Abrir a comparação
  célula a célula"**, que leva à tela de comparação de versões já existente.

Clicar no nome abre o componente na árvore (ou a matriz no grid, quando o nó é uma matriz sem
espelho — DEC-GOV-039).

Editar na consulta histórica continua fora de escopo — o caminho é "Abrir no editor (hoje)" (§10).
Exportar a comparação e indicadores/analytics de mudança também não existem ainda.

## 21. Fluxo do dia a dia — histórias e cenários do layout

O layout de §2/§2.1/§17 existe para servir a quatro rotinas reais. As histórias abaixo são o
critério pelo qual qualquer mudança de layout é julgada; os cenários marcados `CT-UX` são os que
dependem de estado e sequência, e por isso viram teste.

| ID | História |
|---|---|
| **US-UX-01** | Como analista de política, quero navegar a hierarquia inteira numa lista só, para não decidir a cada clique qual das duas árvores da tela é a certa |
| **US-UX-02** | Como analista, quero escrever a regra na largura da tela, para digitar definição técnica e especificação sem escrever dentro de uma coluna de 340px |
| **US-UX-03** | Como analista cadastrando ~50 regras, quero criar, renomear e publicar sem tirar as mãos do teclado, para que o volume não vire duas semanas |
| **US-UX-04** | Como gerente, quero ver a política inteira como estava numa data — regras, listas e matrizes — numa tela de consulta, sem congelar a tela em que eu edito |
| **US-UX-05** | Como usuário em notebook de 1366px, quero ajustar a largura da navegação, porque os nomes das minhas seções não cabem em 248px |

Critérios de aceitação transversais: nenhuma ação existente hoje pode desaparecer sem substituta na
barra (§2.1) ou no menu `⋯` do nó (§17.1); nenhuma tela pode exibir duas árvores da mesma política;
nenhum campo de texto longo pode ficar abaixo de 480px de largura útil.

```gherkin
CT-UX-01 (US-UX-01)
  Dado um projeto com seções em 4 níveis
  Quando eu abro o projeto
  Então a barra lateral mostra a árvore inteira, com todos os níveis expansíveis
  E não existe nenhum segundo painel de árvore na tela

CT-UX-02 (US-UX-02)
  Dado um componente RULE com rascunho aberto
  Quando eu abro o componente pela árvore
  Então a página dele ocupa o centro da tela
  E o painel direito não é renderizado
  E o campo "Descrição de negócio" tem pelo menos 6 linhas visíveis

CT-UX-03 (US-UX-03)
  Dado o nó "CMA" selecionado na árvore
  Quando eu pressiono Enter
  Então um irmão de CMA nasce em edição de nome
  E o chip de alvo na barra de ferramentas diz "em: CMA"

CT-UX-04 (US-UX-04)
  Dado que a versão 1 da regra vigora desde 30/09/2025 e a versão 2 desde 01/03/2026
  Quando eu clico no segmento da versão 1 na faixa de vigência da página do componente
  Então a tela de Vigência abre em 30/09/2025 na aba Estrutura
  E a árvore da barra lateral continua mostrando o estado de hoje, editável

CT-UX-05 (US-UX-05)
  Dado que arrastei a borda da navegação até 420px
  Quando eu recarrego a aplicação
  Então a navegação continua com 420px
  E arrastar além de 480px ou aquém de 248px não passa dos limites
```
