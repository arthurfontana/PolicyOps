# Guia do Usuário — Policy Matrix Studio

> Para o time de política de crédito. Sem jargão de programação — se algo aqui parecer técnico demais, é falha do texto, não do leitor.

## 1. O que é isto

O Policy Matrix Studio (o arquivo `PolicyOps.html`) substitui as planilhas de Excel e os "cineminhas" de PowerPoint onde as matrizes de política de crédito viviam até agora. Você abre o arquivo no navegador, edita visualmente, publica uma versão, e a partir daí qualquer pessoa do time — ou uma auditoria — consegue ver exatamente qual era a política vigente em qualquer data, com histórico completo de quem mudou o quê e quando.

Não precisa instalar nada para usar — o arquivo `.html` abre no navegador. Como abrir e salvar depende de como você chegou até a aplicação; veja a seção seguinte.

## 2. Como abrir e salvar

A tela inicial sempre diz, numa faixa colorida abaixo dos botões, qual dos três modos está ativo — a aplicação nunca deixa isso por adivinhar.

**Modo servidor** (recomendado, quando disponível): dois cliques em `iniciar.bat`, na pasta `_app\` publicada pela TI dentro da pasta de rede do time (na primeira vez em cada máquina, antes, um clique em `instalar.bat` — leva menos de um minuto e só precisa ser feito uma vez). Um servidor sobe na sua própria máquina e abre a aplicação por um endereço como `http://127.0.0.1:.../`. Chegando por esse endereço, o documento da pasta de rede do time abre **sozinho** — sem escolher arquivo, sem a pergunta "como você quer ser identificado?" (o servidor já sabe quem você é pelo seu login) — e **salvar** grava direto na pasta, avisando na hora se outra pessoa salvou por cima enquanto você editava. É o único modo sem nenhum download: nunca existe um arquivo baixado para você colocar de volta na pasta na mão. Para encerrar, feche a janela que o `iniciar.bat` abriu. (O detalhe de operação da pasta compartilhada está em `docs/11-operacao.md`, para quem cuida dela.)

**Modo completo**: quando a aplicação é aberta por um endereço `https://` (por exemplo, uma biblioteca do SharePoint sincronizada) e o navegador sabe escolher/gravar arquivos direto. Abrir e salvar acontecem no mesmo arquivo escolhido, com aviso se alguém mais salvar por cima enquanto você edita.

**Modo somente download**: o modo universal — o que sempre funciona, mesmo sem servidor e sem `https`. É o que entra quando o `.html` é aberto por duplo clique. Abrir é por um seletor de arquivo (ou arrastando o arquivo para a janela); **salvar baixa um arquivo novo**, que você mesmo precisa colocar de volta na pasta compartilhada. Neste modo a aplicação não consegue saber se outra pessoa mexeu no arquivo enquanto você editava — salve com frequência e combine com o time quem está mexendo em cada matriz.

Identificação: no modo servidor, quem editou é resolvido pelo próprio servidor (seu login), e não há nada para configurar. Nos outros dois modos, a aplicação pergunta seu nome na primeira vez ("Como você quer ser identificado?") e usa isso para carimbar o histórico de cada matriz — não é senha nem controle de acesso, só identificação; dá para trocar depois pela barra de status.

## 3. Glossário

| Termo | O que significa |
|---|---|
| **Matriz** | Uma tabela de decisão — por exemplo, "Limite de Crédito PJ". Cruza um ou mais critérios no eixo horizontal (X) com um ou mais no eixo vertical (Y), e cada cruzamento tem uma decisão. |
| **Variável** | Um critério reutilizável, como "Score HVI3" ou "Segmento". Vive numa biblioteca central e pode ser usada em várias matrizes ao mesmo tempo. |
| **Nível** | Uma variável dentro de um eixo. Um eixo pode ter até 3 níveis empilhados — por exemplo, o eixo Y de "Segmento › Faturamento" tem 2 níveis. |
| **Tupla** | Uma combinação específica de níveis num eixo — por exemplo, "Varejo, até 100 mil" é uma tupla do eixo Y acima. Cada célula da matriz é o cruzamento de uma tupla de X com uma tupla de Y. |
| **Versão** | Uma "foto" completa de uma matriz num momento — eixos, células, tudo. Toda matriz tem um histórico de versões numeradas (v1, v2, v3…). |
| **Rascunho** | Uma versão ainda em edição, que ninguém fora do time vê como oficial. Pode ser alterada e descartada livremente. |
| **Publicar** | Transformar um rascunho na versão oficial. A partir daí ela é **imutável** — nunca mais muda. |
| **Vigência** | O período em que uma versão publicada vale, do dia em que foi publicada até o dia em que outra a substitui (ou até hoje, se ainda for a atual). |
| **Snapshot** | Quando uma matriz usa uma variável, ela "tira uma foto" da versão daquela variável naquele momento — os domínios (as opções) ficam congelados na matriz, mesmo que a variável evolua depois na biblioteca. |
| **Pin** | O apontamento de uma matriz para uma versão específica de uma variável (o resultado do snapshot). "Esta matriz está pinada na v2 do Score HVI3." |
| **Domínio** | Uma opção dentro de uma variável — por exemplo, "Varejo" é um domínio da variável Segmento. |

## 4. Como criar sua primeira matriz

1. Na tela inicial, abra o arquivo de dados do time (ou "Explore com dados de exemplo" para praticar sem risco).
2. No menu lateral, vá em **Projetos** e escolha (ou crie) o projeto onde a matriz vai morar — por exemplo, "Política PJ".
3. Clique em **Nova matriz**. Dê um código (`MTZ_ALGO`, maiúsculas e underscore) e um nome legível.
4. Escolha entre **Começar do zero** ou **Usar um template** — um template pré-preenche os eixos e algumas decisões, e pode economizar bastante trabalho se já existir um parecido.
5. Monte o eixo X (horizontal) e o eixo Y (vertical) escolhendo variáveis da biblioteca. Se a variável que você precisa ainda não existe, crie-a primeiro em **Biblioteca › Variáveis** — ela precisa ter pelo menos uma versão **publicada** para entrar num eixo.
6. A prévia mostra quantas combinações a matriz vai ter (`8 linhas × 6 colunas = 48 combinações`). Acima de 1.500 aparece um aviso; acima de 6.000 a criação é bloqueada — nesse caso, vale reconsiderar a granularidade dos critérios.
7. Confirme. A matriz nasce como rascunho v1, com todas as combinações em branco (pendentes).
8. Clique em cada célula (ou selecione várias de uma vez — veja a seção do inspector) e preencha decisão, oferta e limite pelo painel à direita.
9. Quando tudo estiver preenchido, publique (§6).

## 5. Como aninhar eixos

Um eixo pode ter até 3 variáveis empilhadas, uma dentro da outra — é o que permite algo como "Segmento › Faixa de Faturamento" no mesmo eixo Y, em vez de precisar de uma matriz por segmento.

1. No construtor de eixos (na criação da matriz, ou no inspector de uma matriz existente, sem seleção), clique em **Adicionar nível**.
2. Escolha a variável. Só aparecem variáveis com versão publicada e que ainda não estão em uso em nenhum dos dois eixos.
3. Se já houver outro nível no mesmo eixo, o construtor mostra se existe uma **regra de compatibilidade** entre os dois — por exemplo, "Regra Segmento × Faturamento aplicada — 8 de 15 combinações válidas". Sem regra, valem todas as combinações possíveis, o que às vezes é bem mais do que faz sentido no mundo real.
4. Se combinações não fazem sentido (Varejo não fatura acima de 1 milhão, por exemplo), crie uma regra de compatibilidade em **Biblioteca › Compatibilidade** antes de aninhar — ela evita que a matriz nasça com linhas que nunca vão ser usadas.
5. A ordem dos níveis importa: o primeiro nível forma os grupos maiores do cabeçalho (as faixas mais grossas na tela), o segundo os subgrupos.
6. Alterar os níveis de uma matriz **já existente** sempre mostra antes um resumo do impacto nas células — o que fica, o que se perde, e como o conteúdo antigo deve se comportar (replicar para as novas combinações, ou começar em branco).

## 6. Como versionar

Uma matriz sempre tem, no máximo, um rascunho em aberto por vez.

1. **Criar um rascunho**: a partir de uma versão publicada, clique em **Criar rascunho**. Ele nasce como cópia da vigente.
2. **Editar**: mude o que precisar. Cada alteração pode ser desfeita com `Ctrl+Z` enquanto o rascunho não for publicado.
3. **Publicar**: quando todas as combinações estiverem preenchidas (a aplicação avisa e ajuda a achar as que faltam), clique em **Publicar**. É obrigatório escrever uma nota curta dizendo o que mudou — isso vira parte do histórico permanente.
4. A partir da publicação, a versão anterior vira **histórica** e a nova é a **vigente**. Nenhuma das duas pode mais ser editada — só um rascunho novo pode.
5. Para consultar o passado, abra qualquer versão histórica pelo seletor de versões ou pela tela de **Vigência** (informe uma data e veja qual era a política válida naquele dia).

## 7. Como comparar duas versões

1. Na matriz aberta, clique em **Comparar** (ou **Comparar com a vigente**, se estiver num rascunho).
2. A tela mostra três modos:
   - **Sobreposto**: um grid só, com marca diagonal nas células alteradas — clique numa para ver o "antes → depois".
   - **Lado a lado**: dois grids com rolagem sincronizada.
   - **Lista**: uma tabela filtrável de tudo que mudou, exportável em CSV.
3. Um resumo no topo já conta o essencial em português: "12 células abertas, 8 fechadas, 4 ofertas alteradas".
4. O botão **Exportar** (no cabeçalho da tela) gera o CSV do que mudou — útil para levar a uma reunião de comitê sem precisar printar a tela.

## 8. Por que publicar uma variável não muda as matrizes já publicadas

Esta é a dúvida mais comum de quem vem do Excel, então vale explicar com calma.

Cada matriz, ao usar uma variável, **tira uma foto** dela — os domínios (as opções da variável) na hora em que a matriz foi montada ou atualizada. Essa foto (o "pin") fica gravada na versão da matriz para sempre.

Quando alguém edita a biblioteca — por exemplo, adiciona uma faixa nova ao Score HVI3 — isso só muda o **rascunho** daquela variável na biblioteca. Nenhuma matriz publicada é tocada, porque cada uma continua enxergando a foto que tirou no seu próprio momento.

Se uma matriz quiser adotar a evolução da variável, alguém precisa, deliberadamente, criar um rascunho da matriz e escolher **atualizar** aquele eixo para a versão nova — e mesmo assim, só o rascunho muda; a versão publicada anterior continua exatamente como estava.

Em outras palavras: **a biblioteca evolui livremente, mas nada publicado se move sozinho.** É o que garante que uma auditoria, olhando a v12 de uma matriz publicada em março, veja exatamente o que estava em vigor em março — não uma versão "atualizada" por engano.

## 9. Como anexar uma evidência (DB, ofício, estudo)

Serve para deixar junto da política o arquivo que a justifica — o DB que originou a mudança, o
ofício do regulador, a planilha do estudo. **Só funciona quando a aplicação foi aberta pelo
`iniciar.bat`** (o servidor local é quem grava na pasta de rede); nos outros modos a seção
aparece explicando isso.

1. Abra o alvo: a **versão** da matriz (o caso mais comum), a **matriz** inteira, ou o **projeto**
   — cada um tem sua própria seção **Evidências**.
2. Escreva uma nota curta, se ajudar (opcional), e clique em **Anexar arquivo**.
3. O arquivo é **copiado** para a pasta de rede, em `_evidencias\{projeto}\{matriz}\v{n}\`, com o
   nome original e a data na frente: `2026-08-14_DB 513 - Ajuste.docx`. O original na sua máquina
   não é usado nem referenciado — pode movê-lo ou apagá-lo depois.
4. **Salve o documento** (`Ctrl+S`) para registrar o vínculo. O arquivo já está na pasta antes
   disso; salvar é o que grava quem anexou, quando e a que ele pertence.

Alguns pontos que costumam gerar dúvida:

- **Anexar a uma versão já publicada é normal e permitido.** A evidência quase sempre chega
  depois da publicação, e anexá-la **não altera** a versão publicada em nada — o histórico da
  política continua exatamente como estava.
- **Os arquivos são encontráveis sem a aplicação.** Abra a pasta de rede no Explorer, entre em
  `_evidencias` e navegue: projeto, matriz, versão. Estão lá, em claro, com o nome de sempre. É
  proposital: se a aplicação um dia sair do ar, as evidências continuam acessíveis.
- **Não renomeie nem mova nada dentro de `_evidencias`.** A aplicação confere o conteúdo de cada
  anexo por uma "impressão digital" gravada no momento em que ele foi anexado. Se o arquivo for
  trocado por fora, abrir pela aplicação avisa que ele não confere mais — que é o ponto: uma
  evidência só vale como prova enquanto ninguém a alterou.
- **Desanexar não apaga.** O vínculo sai do documento (e `Ctrl+Z` desfaz, enquanto você não
  salvou); no salvamento seguinte, o arquivo é movido para `_evidencias\_lixeira\`, mantendo a
  mesma estrutura de pastas. Esvaziar a lixeira é decisão manual de quem cuida da pasta.
- **Limite de 50 MB por arquivo.** A aplicação não lê nem indexa o conteúdo do anexo — ela o
  guarda e garante que ele continua íntegro.

## 10. Como carregar um capítulo da política em Markdown

Serve para quem já tem a política inteira num Word (*Filtros e Critérios de Crédito B2C*, por
exemplo) e quer trazê-la para dentro da ferramenta mais rápido do que digitando componente por
componente. **É opcional** — a forma normal de montar a árvore é digitando à mão (seção 4.2 acima)
— e vale a pena quando o gargalo virar digitação, não a decisão sobre o que é seção e o que é
regra. Funciona **por capítulo**: você sobe um pedaço de cada vez, na seção que escolher, no seu
ritmo — nunca precisa importar a política inteira de uma só vez.

### 10.1 Converter o Word em Markdown

Isto acontece **fora** da ferramenta — ela nunca faz requisição de rede nem chama IA sozinha.
Cole o prompt abaixo, junto com o trecho do documento de política, numa IA de sua confiança, confira
o resultado, e guarde o `.md` gerado.

O documento real tem uma anatomia constante que o prompt apenas transcreve, sem inventar estrutura:

| No Word | Vira |
|---|---|
| Título 1 (`4.2 Regras Duras e Prevenção a Fraude`) | Seção |
| Título 2 (`Bloqueios por Dívida`, `Prevenção a Fraude`) | Seção — agrupamento temático, sem semântica de processo |
| Título 3 (`Dívida Acima de R$ 5.000`) | Regra |
| parágrafo solto abaixo do título | Descrição de negócio |
| `Definição técnica: …` | Definição técnica |
| `Observação: Reason code DV01 — reprovado, Oferta = 0.` | Reason codes + Resultado + Notas |
| Anexos A/C/D (faixas, reason codes, listas) | **não viram componentes** — já existem na ferramenta como Biblioteca de Variáveis e catálogo |

```text
Converta o documento de política de crédito em anexo para Markdown estruturado, seguindo
exatamente estas regras:

1. A hierarquia do documento vira hierarquia de headings (#, ##, ###, ####), no máximo 6 níveis.
   Um heading que só agrupa outros é uma seção; não invente seções que não existem no documento.
2. Cada regra, lista, reason code ou variável de política vira um heading próprio, seguido de um
   parágrafo em linguagem de negócio descrevendo o que ela faz hoje (o comportamento vigente).
3. Logo abaixo desse parágrafo, acrescente as linhas de marcador que o documento sustentar —
   nunca invente conteúdo, omita o marcador se a informação não estiver no documento:
   > Tipo: SECTION | RULE | LIST | REASON_CODE | POLICY_VARIABLE | OTHER
   > Código: IDENTIFICADOR_EM_MAIUSCULAS_COM_UNDERLINE
   > Definição técnica: a condição como aparece no documento
   > Entradas: variáveis ou campos usados, separados por vírgula
   > Condições: quando a regra é avaliada
   > Resultado: Aprovar | Reprovar | Derivar para Mesa | Continuar | ...
   > Reason code: códigos citados, separados por vírgula
   > Dependências: códigos de outros itens deste mesmo documento
   > Fonte: nome do documento e página/seção de origem
   > Notas: qualquer ressalva relevante
4. Matrizes e tabelas de corte NÃO devem virar tabelas Markdown: crie o heading com
   "> Tipo: OTHER" e descreva em uma frase o que a tabela decide, citando a fonte. As matrizes
   entram na ferramenta por outro caminho.
5. Não resuma nem reescreva a política: preserve os números, os nomes e os termos do documento.
   Se algum trecho estiver ambíguo, mantenha o texto original e acrescente "> Notas: revisar".
6. Quando o documento trouxer um parágrafo iniciado por "Definição técnica:", use-o em
   "> Definição técnica:". Quando trouxer "Observação:", distribua o conteúdo: os códigos citados
   em "> Reason code:", o veredito (Aprovado/Negado/Continue/Derivar) em "> Resultado:", e o
   restante da frase em "> Notas:".
7. Anexos de catálogo (faixas de score por regional, catálogo de reason codes, catálogo de listas)
   NÃO devem virar headings de componente: eles já existem na ferramenta como Biblioteca de
   Variáveis e catálogo. Ignore-os na conversão e mencione ao final quais anexos você ignorou.
8. Saída: um único bloco de Markdown, sem comentários seus antes ou depois. Mantenha os capítulos
   em blocos claramente separados — o arquivo será usado em recortes, um capítulo por vez.
```

O arquivo gerado serve tanto para colar bloco a bloco na digitação manual (seção 4.2, "Colar bloco
de texto") quanto para a carga por recorte abaixo — e nos dois casos, **você revisa antes de
qualquer coisa entrar na política**.

### 10.2 Subir o capítulo na ferramenta

1. Abra o projeto (a política) e, na árvore, clique em **Carregar Markdown** (barra de cima) para
   entrar na raiz, ou, com o botão direito numa seção específica, **Carregar Markdown aqui…** para
   entrar dentro dela — é assim que um recorte que começa em `### Dívida Acima de R$ 5.000` cai
   dentro da seção `Bloqueios por Dívida` que você já tinha criado à mão, sem precisar reconstruir
   os títulos por cima dela.
2. **Destino e texto**: confira (ou troque) o destino, e cole o Markdown do capítulo — ou clique em
   **Selecionar arquivo…** e escolha o `.md`.
3. **Revisão**: cada heading do recorte vira uma linha, com o tipo que a ferramenta reconheceu
   (editável, se ela chutou errado) e o código derivado do nome. Uma linha com uma bolinha
   "heurística" é uma regra que não trouxe `> Tipo:` explícito — confira se faz sentido. Desmarque
   a caixinha de uma linha para deixá-la de fora (e os itens abaixo dela também ficam de fora). Uma
   linha em vermelho tem um problema que bloqueia — o mais comum é código repetido, quando o mesmo
   capítulo já foi carregado antes; desmarque-a ou volte e ajuste a origem.
4. **Confirmação**: confira a vigência (já vem sugerida pela vigência da fundação do projeto, se
   você a preencheu nas propriedades do projeto) e clique em **Confirmar carga**. Cada componente
   nasce já publicado nessa vigência, marcado como "Aguardando revisão" — promover para "Validado"
   é um passo seu, depois, quando conferir cada um.
5. Nada entra sem passar pela revisão do passo 3, e **desfazer** (`Ctrl+Z`, logo em seguida)
   remove a carga inteira de uma vez — os componentes, as versões, tudo.

### 10.3 Cadastrando muitas regras direto na árvore, só de teclado

Quando não há um Markdown pronto para carregar (seção 10 acima), a árvore da política também é
feita para digitar em volume — ~50 seções e regras à mão sem abrir um diálogo para cada uma:

1. Selecione o nó onde a primeira regra deve nascer (ou nenhum, para nascer na raiz) e aperte
   `Shift+Enter` — nasce um irmão, do tipo Regra, já em edição de nome. `Enter` sozinho nasce um
   irmão herdando o tipo do nó de origem (útil para seções).
2. Digite o nome e aperte `Enter`: a regra é criada e a **próxima** caixa de criação já abre
   encadeada, do mesmo tipo — repita para cada regra da lista. `Tab`/`Shift+Tab` antes de gravar
   desce/sobe um nível, se alguma precisar entrar dentro da anterior em vez de ficar irmã dela.
   `Esc` descarta a última caixa (vazia) quando a lista acabar.
3. Navegue pela árvore só de teclado: `↑`/`↓` movem o foco entre os nós visíveis, `→`/`←`
   expandem/recolhem (`←` num nó já recolhido salta para o pai), `Home`/`End` vão para o primeiro/
   último nó visível, e digitar as primeiras letras do nome pula direto para o nó (typeahead).
   `F2` renomeia, `Ctrl/Cmd+D` duplica como irmã logo abaixo, `Delete` arquiva (com confirmação).
4. Abra cada regra (clique ou `Enter` para ir à página do componente), preencha a descrição de
   negócio e o resto do conteúdo, e siga para a próxima com `Alt+↓` (ou `Alt+↑` para voltar) — sem
   passar pela árvore de novo.
5. Quando todas as regras da leva tiverem rascunho preenchido, publique de uma vez: o contador
   **"n pendentes"** na barra de ferramentas soma tudo que ainda tem rascunho aberto ou está
   marcado como "Aguardando revisão"; clique nele (ou em "Publicar pendentes") para abrir o
   diálogo, escolha a vigência do lote e confirme — é tudo ou nada, não item a item.
   `Ctrl+Shift+N` pula para o próximo item pendente da política a qualquer momento, dando a volta
   quando chega no fim (e não faz nada se não houver nenhum pendente).

## 11. Atalhos úteis

Aperte `?` a qualquer momento dentro da aplicação para ver a lista completa de atalhos de teclado,
agora organizada por região da tela. Os mais usados no dia a dia da árvore:

| Atalho | Ação |
|---|---|
| `Enter` / `Shift+Enter` | Nova seção / nova regra, irmã do nó selecionado |
| `↑` `↓` `Home` `End` | Move o foco entre os nós visíveis da árvore |
| `→` `←` | Expande / recolhe (`←` num nó recolhido salta para o pai) |
| Digitar letras | Typeahead: pula para o nó cujo nome começa com o texto |
| `F2` | Renomear o nó em foco |
| `Ctrl/Cmd+D` | Duplicar o nó como irmão |
| `Delete` | Arquivar o nó em foco (com confirmação) |
| `Ctrl+Shift+P` | Publicar pendentes do projeto |
| `Ctrl+Shift+N` | Ir para o próximo componente pendente, dando a volta |
| `Alt+↑` `Alt+↓` | Na página do componente, vai para o irmão anterior/próximo |

## 12. Como gerar o Pacote para a Fábrica

O Pacote para a Fábrica é o documento que vai para a fábrica no lugar do Word manual — gerado a
partir do DB, nunca redigitado. Ele é sempre **derivado**: toda vez que você clica em "Gerar
pacote", o documento é montado na hora, a partir do estado atual do DB — não existe uma cópia
salva para editar depois. Editar o DB e gerar de novo é o jeito de corrigir o pacote.

### 12.1 Configurar o boilerplate uma vez por política

Antes do primeiro pacote, vale preencher o conteúdo fixo que se repete em todo DB (checklist
Serasa, comunicados, contatos):

1. Abra "Editar projeto" nas configurações do projeto.
2. Em **Boilerplate do Pacote para a Fábrica**, escreva o texto fixo com o editor rico de sempre
   (títulos, listas, tabela, imagem).
3. Em **Contatos**, adicione uma linha por pessoa — nome, papel livre (`Solicitante`,
   `Interessado`, ou qualquer outro rótulo que a política use) e e-mail opcional.

Isso é opcional: um DB sem boilerplate configurado no projeto gera o pacote normalmente, só sem a
seção "Boilerplate".

### 12.2 Gerar o pacote de um DB

O botão **Gerar pacote** aparece na tela do DB a partir do status Aprovado (antes disso o escopo
ainda pode mudar demais para valer a pena gerar). Duas opções:

- **Imprimir (HTML)** — abre uma janela nova já pronta para `Ctrl+P` → salvar como PDF (o mesmo
  hábito usado para imprimir a matriz). As imagens do texto (motivação, especificação,
  boilerplate) ficam embutidas na página.
- **Baixar Markdown (.md)** — baixa o mesmo conteúdo em Markdown. Como o `.md` não carrega bytes de
  imagem, cada imagem aparece referenciada pelo nome do anexo, com um aviso no topo do arquivo
  explicando que as imagens estão só no HTML/impressão.

O pacote segue sempre a mesma ordem: identificação, registro de versão, contatos, boilerplate,
contexto e objetivo, escopo (cada item com "hoje" e "proposto" lado a lado), impactos, critérios de
aceite, testes, vigência e anexos.

### 12.3 Gerar todos os pacotes de uma release

Na tela da release, o botão **Gerar pacotes** faz o mesmo para todos os DBs da release que já estão
Aprovados ou além — os que ainda não chegaram lá ficam de fora, sem erro. As mesmas duas opções
(imprimir todos em HTML, baixar todos em Markdown) disparam um pacote por DB elegível.
