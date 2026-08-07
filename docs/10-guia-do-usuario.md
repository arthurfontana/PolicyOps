# Guia do Usuário — Policy Matrix Studio

> Para o time de política de crédito. Sem jargão de programação — se algo aqui parecer técnico demais, é falha do texto, não do leitor.

## 1. O que é isto

O Policy Matrix Studio (o arquivo `PolicyOps.html`) substitui as planilhas de Excel e os "cineminhas" de PowerPoint onde as matrizes de política de crédito viviam até agora. Você abre o arquivo no navegador, edita visualmente, publica uma versão, e a partir daí qualquer pessoa do time — ou uma auditoria — consegue ver exatamente qual era a política vigente em qualquer data, com histórico completo de quem mudou o quê e quando.

Não precisa instalar nada. O arquivo `.html` fica numa pasta do SharePoint; o navegador faz o resto.

## 2. Glossário

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

## 3. Como criar sua primeira matriz

1. Na tela inicial, abra o arquivo de dados do time (ou "Explore com dados de exemplo" para praticar sem risco).
2. No menu lateral, vá em **Projetos** e escolha (ou crie) o projeto onde a matriz vai morar — por exemplo, "Política PJ".
3. Clique em **Nova matriz**. Dê um código (`MTZ_ALGO`, maiúsculas e underscore) e um nome legível.
4. Escolha entre **Começar do zero** ou **Usar um template** — um template pré-preenche os eixos e algumas decisões, e pode economizar bastante trabalho se já existir um parecido.
5. Monte o eixo X (horizontal) e o eixo Y (vertical) escolhendo variáveis da biblioteca. Se a variável que você precisa ainda não existe, crie-a primeiro em **Biblioteca › Variáveis** — ela precisa ter pelo menos uma versão **publicada** para entrar num eixo.
6. A prévia mostra quantas combinações a matriz vai ter (`8 linhas × 6 colunas = 48 combinações`). Acima de 1.500 aparece um aviso; acima de 6.000 a criação é bloqueada — nesse caso, vale reconsiderar a granularidade dos critérios.
7. Confirme. A matriz nasce como rascunho v1, com todas as combinações em branco (pendentes).
8. Clique em cada célula (ou selecione várias de uma vez — veja a seção do inspector) e preencha decisão, oferta e limite pelo painel à direita.
9. Quando tudo estiver preenchido, publique (§5).

## 4. Como aninhar eixos

Um eixo pode ter até 3 variáveis empilhadas, uma dentro da outra — é o que permite algo como "Segmento › Faixa de Faturamento" no mesmo eixo Y, em vez de precisar de uma matriz por segmento.

1. No construtor de eixos (na criação da matriz, ou no inspector de uma matriz existente, sem seleção), clique em **Adicionar nível**.
2. Escolha a variável. Só aparecem variáveis com versão publicada e que ainda não estão em uso em nenhum dos dois eixos.
3. Se já houver outro nível no mesmo eixo, o construtor mostra se existe uma **regra de compatibilidade** entre os dois — por exemplo, "Regra Segmento × Faturamento aplicada — 8 de 15 combinações válidas". Sem regra, valem todas as combinações possíveis, o que às vezes é bem mais do que faz sentido no mundo real.
4. Se combinações não fazem sentido (Varejo não fatura acima de 1 milhão, por exemplo), crie uma regra de compatibilidade em **Biblioteca › Compatibilidade** antes de aninhar — ela evita que a matriz nasça com linhas que nunca vão ser usadas.
5. A ordem dos níveis importa: o primeiro nível forma os grupos maiores do cabeçalho (as faixas mais grossas na tela), o segundo os subgrupos.
6. Alterar os níveis de uma matriz **já existente** sempre mostra antes um resumo do impacto nas células — o que fica, o que se perde, e como o conteúdo antigo deve se comportar (replicar para as novas combinações, ou começar em branco).

## 5. Como versionar

Uma matriz sempre tem, no máximo, um rascunho em aberto por vez.

1. **Criar um rascunho**: a partir de uma versão publicada, clique em **Criar rascunho**. Ele nasce como cópia da vigente.
2. **Editar**: mude o que precisar. Cada alteração pode ser desfeita com `Ctrl+Z` enquanto o rascunho não for publicado.
3. **Publicar**: quando todas as combinações estiverem preenchidas (a aplicação avisa e ajuda a achar as que faltam), clique em **Publicar**. É obrigatório escrever uma nota curta dizendo o que mudou — isso vira parte do histórico permanente.
4. A partir da publicação, a versão anterior vira **histórica** e a nova é a **vigente**. Nenhuma das duas pode mais ser editada — só um rascunho novo pode.
5. Para consultar o passado, abra qualquer versão histórica pelo seletor de versões ou pela tela de **Vigência** (informe uma data e veja qual era a política válida naquele dia).

## 6. Como comparar duas versões

1. Na matriz aberta, clique em **Comparar** (ou **Comparar com a vigente**, se estiver num rascunho).
2. A tela mostra três modos:
   - **Sobreposto**: um grid só, com marca diagonal nas células alteradas — clique numa para ver o "antes → depois".
   - **Lado a lado**: dois grids com rolagem sincronizada.
   - **Lista**: uma tabela filtrável de tudo que mudou, exportável em CSV.
3. Um resumo no topo já conta o essencial em português: "12 células abertas, 8 fechadas, 4 ofertas alteradas".
4. O botão **Exportar** (no cabeçalho da tela) gera o CSV do que mudou — útil para levar a uma reunião de comitê sem precisar printar a tela.

## 7. Por que publicar uma variável não muda as matrizes já publicadas

Esta é a dúvida mais comum de quem vem do Excel, então vale explicar com calma.

Cada matriz, ao usar uma variável, **tira uma foto** dela — os domínios (as opções da variável) na hora em que a matriz foi montada ou atualizada. Essa foto (o "pin") fica gravada na versão da matriz para sempre.

Quando alguém edita a biblioteca — por exemplo, adiciona uma faixa nova ao Score HVI3 — isso só muda o **rascunho** daquela variável na biblioteca. Nenhuma matriz publicada é tocada, porque cada uma continua enxergando a foto que tirou no seu próprio momento.

Se uma matriz quiser adotar a evolução da variável, alguém precisa, deliberadamente, criar um rascunho da matriz e escolher **atualizar** aquele eixo para a versão nova — e mesmo assim, só o rascunho muda; a versão publicada anterior continua exatamente como estava.

Em outras palavras: **a biblioteca evolui livremente, mas nada publicado se move sozinho.** É o que garante que uma auditoria, olhando a v12 de uma matriz publicada em março, veja exatamente o que estava em vigor em março — não uma versão "atualizada" por engano.

## 8. Atalhos úteis

Aperte `?` a qualquer momento dentro da aplicação para ver a lista completa de atalhos de teclado.
