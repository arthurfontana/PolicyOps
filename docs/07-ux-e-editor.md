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
- Barra de status no rodapé: nome do arquivo, `Salvo` / `Alterações não salvas` / `Salvando…` / `Erro`, revisão, quem detém o lock, a identidade (login do Windows no modo `SERVER`, nome digitado nos demais) e o **papel efetivo** no documento aberto (`READER`/`EDITOR`/`PUBLISHER`/`ADMIN` — `14-plataforma-local.md` §6, S29).
- `Ctrl+S` salva. `Ctrl+Shift+S` salva como. Isso é explícito: o usuário decide quando publicar o arquivo para o time.
- Ações que o papel efetivo não permite ficam desabilitadas com o motivo visível (`title` do botão e, nos casos mais visados — publicar, salvar —, um texto ao lado: *"Requer papel PUBLISHER — você é EDITOR."*). A sidebar ganha o item **Acesso** (§16) só para quem pode vê-lo.

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

## 10. Tela de vigência

- Seletor de data (padrão: hoje) e de projeto. Atalhos: Hoje · Início do mês · 30/90 dias atrás · Início do ano.
- Lista das matrizes com a versão vigente naquela data, janela de vigência e link direto.
- **Faixa de linha do tempo** por matriz: um segmento por versão publicada, largura proporcional à duração, marcador na data selecionada, clicável.
- Sem versão vigente: "sem política vigente em dd/mm/aaaa" — não é erro.
- **Visão de portfólio**: cards com miniatura do grid (células de 12px, só cor) de cada matriz na data. É a visão de comitê.
- Viewer de versão histórica: banner *"Você está vendo a versão 11, vigente de 01/03 a 12/07. Esta é uma versão histórica."* + marca d'água discreta.

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

## 17. Árvore da política (épico Governança — S33a ✅/S33b ✅)

> Normativo para as sessões S33a e S33b. O modelo por trás está em
> [`14-governanca-de-alteracoes.md`](14-governanca-de-alteracoes.md) §3.1 e §3.6. **§17.1–§17.3
> entregues na S33a** (ajustado ao que foi construído); **§17.4 e §17.5 entregues na S33b**.

A política deixa de ser "uma lista de matrizes num projeto" e passa a ser **um sumário navegável**:
seções, regras, listas e os nós que apontam as matrizes já existentes. O `Project` é a política
("Política de Crédito B2C"); a árvore é o corpo dela.

### 17.1 Onde a árvore vive

**A árvore é a tela do projeto, não um item da barra lateral.** Com ~101 nós de estrutura no
documento real mais os nós das matrizes já importadas, uma árvore de várias centenas de itens não
cabe nos 248px da sidebar (§2) sem virar rolagem infinita.

```
┌──────────┬────────────────────┬──────────────────────┬─────────────────┐
│ SIDEBAR  │  ÁRVORE ~360px     │  CONTEÚDO            │   INSPECTOR     │
│  248px   │ ┌────────────────┐ │ CMA › Fraude ›       │                 │
│ Política │ │🔎 buscar       │ │ Regra A              │ Tipo    RULE    │
│  B2C   ▾ │ │[tipo▾][revisão▾]│ │                      │ Código  FRD_A   │
│  ├ CMA   │ │                │ │ (breadcrumb + nome,  │ Tags    G1·Dig. │
│  ├ Grupos│ │▾ CMA        12 │ │  tipo, revisão,      │ Revisão ⚠ Pend. │
│  └ Modelo│ │ ▾ Fraude     3 │ │  contagem de filhos) │ Origem  B2C     │
│          │ │  • Regra A  ● │ │                       │                 │
│Matrizes  │ │  • Regra B  ⚠ │ │ (matrizes do projeto  │ [Mover][Duplic.]│
│Biblioteca│ │▾ Grupos      7 │ │  com facetas, §15 —   │ [Arquivar]      │
│Vigência  │ │▾ Modelo     84 │ │  tela padrão sem nó   │ (payload/versão │
└──────────┴─┴────────────────┴─┴  selecionado)─────────┴  desabilitados)─┘
```

- **A árvore vive dentro da tela do projeto (`ProjectDetail`), não numa rota própria.** O painel de
  360px (`PolicyTree`) fica à esquerda do conteúdo; a coluna de conteúdo mostra, por padrão (nenhum
  nó selecionado), a lista de matrizes com facetas do §15 **inalterada** — é a "porta" default, e é
  por isso que o critério "nenhuma regressão" se sustenta sem mover essa tela para outro lugar.
  Selecionar um nó não-`MATRIX` troca o conteúdo para o breadcrumb + o resumo do componente
  (`ComponentContentPanel`); selecionar um nó `MATRIX` navega direto para o grid (§17.2).
- **Sidebar**: o projeto aberto ganha, abaixo do próprio nome, os **dois primeiros níveis** da
  árvore como âncoras (`sidebarTreeAnchors`) — clicar leva à árvore já expandida naquele nó (ou ao
  grid, se for `MATRIX`). O resto das entradas (Matrizes, Biblioteca, Vigência, Rascunhos, Acesso)
  continua como está em §2.
- **Painel da árvore**: busca por nome e código, chips de filtro por tipo e por `reviewStatus`, e a
  faceta de tag (`TagFilterBar` do §15, reaproveitada) — contagem por seção (total de descendentes),
  expandir/recolher por nó. Estado de expansão e filtros vivem em `ui-store.componentTree`,
  escopado por projeto — interface, não documento, como o filtro de matrizes.
- **Filtro não achata a árvore**: ao filtrar, os ancestrais dos itens que sobraram permanecem
  visíveis, esmaecidos (`filterComponentTree` devolve `matchedIds` e `visibleIds` separados). Uma
  árvore filtrada que vira lista plana faz o usuário perder o lugar.
- **Breadcrumb clicável** no topo do conteúdo (`CMA › Regras de Fraude › Regra A`) — suporta os 6
  níveis possíveis (`componentPath`).
- **A ordem é de leitura, e a tela diz isso.** Nota permanente no rodapé do painel: *"A ordem
  reflete o documento de política. A sequência de avaliação do motor está descrita no texto de
  cada regra."* É o que impede a árvore de ser lida como fluxo de execução
  (`14-governanca-de-alteracoes.md` §3.6).

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
| Criar nó `MATRIX` | "Pendurar matriz" na barra da árvore, ou "Adicionar matriz…" no menu de um nó — seletor com busca e filtro por tag sobre as matrizes do projeto ainda não referenciadas (`AddMatrixNodeDialog`, I27) |

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
- Ação **"Publicar pendentes"** na barra da árvore (contador de pendentes no rótulo do botão):
  lista todo componente do projeto com rascunho em aberto, uma vigência para o lote inteiro
  (sugerida pela fundação), desmarcação item a item, e publica o que ficou marcado **tudo ou
  nada** (RN-GOV-05) — um comando puro só, `componentVersion/publishPending`, não N publicações em
  sequência (DEC-GOV-023).
- O aviso da RN-GOV-07 (publicação direta, sem DB) aparece **uma vez** no diálogo do lote, não uma
  vez por item; no diálogo de publicação individual, aparece normalmente para aquele item.

### 17.5 Inspector do componente — S33b ✅

- **Comum a todos os tipos, entregue na S33a** (`ComponentInspector`): nome (edição em linha),
  código (somente leitura, imutável), tipo (somente leitura, badge), tags (`ComponentTagsEditor`,
  mesmo padrão do §15), `origin` (fonte + locator), `reviewStatus` — um `Select` com os 4 estados,
  incluindo promover a `VALIDATED`, que é sempre uma escolha explícita do usuário, nunca efeito
  colateral de outra edição —, contagem de filhos diretos, e as ações estruturais (Mover, Duplicar,
  Arquivar).
- **Ciclo de vida, entregue na S33b**: "Criar rascunho" (sem componente ainda sem versão nasce com
  `businessDescription` pré-preenchido pelo nome do componente — nunca vazio, editado na hora) →
  formulário de payload editável (`ComponentPayloadFields`, commit por campo ao perder o foco) →
  "Publicar" (`PublishComponentDialog`, mesmo padrão visual do diálogo de matriz — vigência
  obrigatória, alerta de irreversibilidade; sem campo de notas, que `ComponentVersion` não tem,
  DEC-GOV-022) → "Descartar rascunho" (confirmação, mesmo padrão de `ConfirmDialog`). Sem rascunho
  aberto, o formulário mostra a versão vigente **somente leitura**, com "Criar rascunho a partir
  desta versão" para começar a próxima.
- **A timeline de versões no padrão visual da timeline de matriz (§10)**: `MatrixTimelineBar`
  reaproveitado sem alteração sobre `getComponentTimeline` (`src/core/queries.ts`) — um segmento
  por versão publicada/histórica, cor por estado, tooltip com o período.
- **`RULE`**: descrição de negócio, definição técnica, entradas, condições, resultado, reason
  codes, dependências e notas (`14-governanca-de-alteracoes.md` §3.2). Campos de lista
  (`inputs`/`reasonCodes`/`dependencies`) são texto separado por vírgula, não um editor
  chave-valor (DEC-GOV-024) — mais rápido de digitar no volume desta sessão.
- **`SECTION`**: a ação **"Documentar esta seção"**, que cria a primeira versão (payload `OTHER`)
  e dá à seção texto, vigência e timeline como qualquer outra (I29). Sem essa ação, a seção
  continua pasta pura, e nunca aparece como "sem política vigente" em `listComponentsEffectiveAt`
  (`src/core/queries.ts`).
- **`MATRIX`**: somente leitura, espelhando a matriz — entregue inteiramente na árvore (§17.2:
  badge de estado e vigência no próprio nó, clique navega direto para o grid); como a navegação já
  é direta, `MATRIX` nunca chega a abrir `ComponentInspector`.
- **`POLICY_VARIABLE`**: o formulário de payload é editável como os demais tipos; quando o
  componente espelha a Biblioteca (`variableId`), um card adicional mostra a variável (nome,
  contagem de domínios da versão publicada) **sem duplicá-los**, com o botão "Ir para a
  Biblioteca" — deep link para `VariablesScreen` via `editor-store.pendingVariableFocus`, mesmo
  padrão de `pendingResnapshot`.
- **`spec`** (documentação livre, `RichDoc`): placeholder somente leitura ("Editor de
  especificação livre — Sessão 34"); o editor de blocos em si é S34.
- **Relacionados** (`dependencies`, reason code compartilhado): fora do escopo desta sessão — o
  campo `RulePayload.dependencies` já existe e é editável (lista de codes), mas o inspector ainda
  não resolve o code para um link clicável; fica para quando o épico tiver DB citando os dois
  lados (S35+).

### 17.6 Carga por recorte — S40 ✅

`MarkdownImportDialog` (`src/components/import/markdown/`), aberto pela barra da árvore
("Carregar Markdown") ou pelo menu de um nó ("Carregar Markdown aqui…", pré-seleciona o destino) —
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
**Especificação** do inspector do componente (§17.5) — o placeholder da S33 morreu aqui — e a S35
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
