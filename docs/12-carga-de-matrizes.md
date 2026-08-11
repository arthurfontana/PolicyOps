# Carga de Matrizes

> **Estado**: 🔮 Planejado (sessões S21–S25)
> **DECs relacionadas**: DEC-CARGA-001 a DEC-CARGA-010 (`13-decisoes.md`)
> **Documento normativo.** O motor vive em `src/core/import/` como TypeScript puro.

## 1. O que é e para quem

A política de crédito já existe fora do PolicyOps: ela é extraída de um sistema interno como
uma tabela larga, uma linha por combinação de perfil, com uma coluna por canal de venda. Hoje
essa tabela vira planilha, a planilha vira "cineminha", e o cineminha vira decisão operacional
sem que ninguém consiga responder, seis meses depois, **o que mudou, quando e em qual pedaço**.

A carga é o caminho que traz essa tabela para dentro do documento e a mantém viva ao longo do
tempo. Ela serve dois momentos com **o mesmo mecanismo**, e isso é o ponto central do desenho:

- **carga inicial** — o documento está vazio de matrizes; o arquivo cria todas elas;
- **atualização periódica** — o documento já tem as matrizes publicadas; o arquivo novo é
  comparado contra o que está vigente, e **só as matrizes que realmente mudaram ganham uma
  versão nova**. As que vieram idênticas não são tocadas: nenhum rascunho, nenhuma versão,
  nenhum evento.

É essa assimetria que produz o lastro. Depois de doze cargas mensais, a linha do tempo de cada
matriz mostra em quais meses aquele pedaço da política de fato mudou — em vez de doze versões
idênticas em todas elas, que é o que acontece quando a carga recria tudo sempre.

Quem usa: a pessoa responsável pela política de crédito, que recebe a extração, confere o que
mudou e decide o que publicar. Não é um processo automático de máquina para máquina — **a carga
propõe, uma pessoa revisa e publica** (RN-10).

O caso que originou a funcionalidade é o `CINEMINHA_20260708.csv`: 6.678 linhas, 12 colunas,
que se decompõem em 17 grids × 6 canais = **102 matrizes** e 40.068 células.

## 2. Histórias de usuário

### US-01 — Carregar a tabela interna sem digitar nada
**Como** responsável pela política, **quero** apontar o arquivo da extração e ver a estrutura
reconhecida, **para** não recriar 102 matrizes na mão.

**Critérios de aceitação:**
- Aceita `.csv` e `.tsv` por seleção de arquivo, arrastar-e-soltar ou colagem de texto.
- Detecta sozinho separador (`;` `,` `TAB` `|`), presença de BOM, quebra de linha (LF/CRLF) e
  linha de cabeçalho; todos os quatro continuam editáveis pelo usuário.
- Arquivo com até 20.000 linhas × 30 colunas é lido em menos de 300 ms.
- Mostra as 20 primeiras linhas já separadas em colunas, com a contagem total de linhas.
- Nenhum byte sai do navegador e nada é gravado no documento neste passo.
- Arquivo sem cabeçalho reconhecível, ou com número de colunas inconsistente entre as linhas →
  erro `IMPORT_PARSE_ERROR` apontando a **linha e a coluna** do problema, e o assistente
  permanece no passo 1.

### US-02 — Declarar o papel de cada coluna uma vez só
**Como** responsável pela política, **quero** dizer quais colunas identificam a matriz, quais
formam cada eixo e quais carregam conteúdo, **para** que o mesmo formato seja reconhecido
sozinho nas próximas cargas.

**Critérios de aceitação:**
- Cada coluna recebe exatamente um papel: `PARTITION`, `AXIS` (com eixo X/Y e nível),
  `VALUE`, `CHECK` ou `IGNORE` (§5.2).
- O assistente calcula ao vivo quantas matrizes e quantas células o mapeamento produz, e
  bloqueia o avanço se alguma matriz passar de 6.000 combinações (I16).
- Colunas de valor podem ser **desdobradas** numa dimensão derivada do cabeçalho (§5.3): as 6
  colunas de oferta viram 6 matrizes por partição, e o nome de cada coluna vira o valor daquela
  dimensão ("Canal").
- Código e nome das matrizes vêm de um padrão com marcadores (`MTZ_{CLUSTER_GRUPO}_{CEP_RISCO}_{CANAL}`),
  com prévia dos códigos gerados e detecção de colisão antes de qualquer gravação.
- O mapeamento completo pode ser salvo como **perfil** nomeado dentro do documento (US-08).

### US-03 — Ligar os valores do arquivo à biblioteca
**Como** responsável pela política, **quero** ver quais valores do arquivo ainda não existem na
biblioteca, **para** resolver isso antes de carregar, sem descobrir no meio do caminho.

**Critérios de aceitação:**
- Para cada coluna de eixo, o assistente lista os valores distintos do arquivo e casa cada um
  com um domínio da variável pinada, por código e por rótulo, normalizando maiúsculas, acentos e
  prefixos de ordenação (`a.RISCO BAIXO` casa com `RISCO_BAIXO`).
- Valor sem correspondência aparece numa lista de pendências com três saídas: mapear para um
  domínio existente, criar o domínio (US-04) ou ignorar as linhas que o contêm.
- **Valor não mapeado nunca é carregado em silêncio**: enquanto houver um, o plano fica bloqueado
  (`IMPORT_UNMAPPED_VALUE`).
- O mesmo vale para as colunas de valor: cada valor distinto (`0`, `3`, `5`, `8`, `12`, `15`) casa
  com um item de catálogo do kind certo.

### US-04 — Montar a biblioteca a partir do próprio arquivo
**Como** responsável pela política, **quero** que o arquivo crie as variáveis, os domínios, a
regra de compatibilidade e os itens de catálogo que faltam, **para** não transcrever 28 domínios
e um mapa de compatibilidade à mão na carga inicial.

**Critérios de aceitação:**
- O assistente propõe, a partir dos valores distintos do arquivo: domínios faltantes de cada
  variável de eixo (com código normalizado, rótulo original e cor sugerida pela paleta oficial),
  itens de catálogo faltantes, e o **mapa de compatibilidade** entre dois níveis adjacentes do
  mesmo eixo, deduzido dos pares que de fato aparecem no arquivo.
- Toda proposta é exibida como lista revisável, item a item, com o que já existe marcado como
  "existe" e intocado.
- Aplicar as propostas usa os comandos normais da biblioteca (`variable/createDraft`,
  `variable/saveDomains`, `variable/publish`, `compat/*`, `catalog/create`) — a carga não tem
  caminho privilegiado para escrever na biblioteca.
- **A carga nunca cria domínio nem variável durante a aplicação das células** (RN-17): ou a
  biblioteca já está pronta, ou este passo é executado antes, explicitamente.
- Cortes numéricos de faixa (`rangeMin`/`rangeMax`) **não** são exigidos aqui: a carga cria a
  identidade do domínio (código, rótulo, cor), e as faixas entram depois por "Colar tabela"
  (`07-ux-e-editor.md` §11) sem invalidar nenhuma matriz, porque o snapshot do eixo só carrega
  identidade (`03-modelo-do-documento.md` §6.1).

### US-05 — Ver o que vai mudar antes de mudar
**Como** responsável pela política, **quero** um plano da carga com uma linha por matriz,
**para** decidir o que aplicar sabendo exatamente o impacto.

**Critérios de aceitação:**
- Cada matriz do plano recebe um dos estados: `NOVA`, `ALTERADA`, `INALTERADA`, `ESTRUTURA
  DIVERGENTE`, `AUSENTE NO ARQUIVO` ou `BLOQUEADA` (§5.5).
- Matriz `ALTERADA` mostra a contagem de células alteradas e o resumo semântico pronto
  ("12 células fechadas, 4 ofertas alteradas"), reaproveitando `src/core/diff/`.
- Expandir uma matriz abre o diff célula a célula na mesma tela de comparação já existente
  (`07-ux-e-editor.md` §9), sem sair do assistente.
- Filtros por estado e por tag, e busca por código, sobre as 102 linhas.
- O plano é **dry-run puro**: nada é gravado no documento até o passo de aplicação (RN-13).
- Plano de 102 matrizes e 40.000 células é calculado em menos de 1 s.

### US-06 — Versionar só o que mudou
**Como** responsável pela política, **quero** que a carga crie rascunho apenas nas matrizes
alteradas, **para** que a linha do tempo mostre quais pedaços da política mudaram em cada mês.

**Critérios de aceitação:**
- Matriz `INALTERADA` não recebe rascunho, não recebe evento e não tem `revision` de versão
  incrementada — **nada** acontece com ela.
- Matriz `ALTERADA` recebe um rascunho v(n+1) derivado da versão publicada, com as células já
  aplicadas, e **para aí** — a publicação é ato separado (US-07).
- Matriz `NOVA` é criada com v1 em `DRAFT`, células aplicadas, eixos montados a partir do
  mapeamento, e as tags do perfil.
- Matriz existente ausente do arquivo é listada e **não é tocada nem arquivada**.
- Carregar duas vezes o mesmo arquivo sobre o mesmo documento produz, na segunda vez,
  "nenhuma alteração" em todas as matrizes (RN-05).

### US-07 — Revisar e publicar matriz a matriz
**Como** responsável pela política, **quero** revisar o diff de cada rascunho criado pela carga
antes de publicar, **para** que nada entre em vigor sem alguém ter olhado.

**Critérios de aceitação:**
- Ao fim da aplicação, o assistente abre a **fila de revisão**: os rascunhos criados por aquela
  carga, com estado "a revisar" / "revisado".
- Cada item abre o diff contra a versão vigente e tem as ações "Marcar como revisado" e
  "Publicar".
- "Publicar revisados" publica em lote **somente** os itens marcados como revisados, com a nota
  da carga como nota padrão de cada versão (editável, mínimo de 10 caracteres — `NOTES_REQUIRED`).
- Fechar o assistente não perde nada: os rascunhos continuam na tela de Rascunhos, marcados com
  a origem "Carga <perfil> de dd/mm/aaaa".
- Nenhuma publicação automática existe no fluxo (RN-10).

### US-08 — Reaproveitar o mapeamento na carga seguinte
**Como** responsável pela política, **quero** que a próxima carga reconheça o formato sozinha,
**para** que a atualização mensal seja "abrir o arquivo, olhar o plano, publicar".

**Critérios de aceitação:**
- O perfil é salvo **dentro do documento** (`importProfiles`, `03-modelo-do-documento.md` §7.1) e
  viaja com o arquivo de políticas para qualquer pessoa do time.
- Ao abrir um arquivo cujo cabeçalho é idêntico ao `signature` de um perfil salvo, o assistente
  reconhece, informa qual perfil aplicou e **pula direto para o plano** (US-05).
- Cabeçalho parecido mas diferente (coluna nova, coluna renomeada, ordem trocada) não é
  reconhecido silenciosamente: o assistente mostra a diferença e pede confirmação para seguir
  com o mapeamento manual.
- Editar um perfil existente não altera nenhuma carga já aplicada.

### US-09 — Filtrar 102 matrizes por tag
**Como** responsável pela política, **quero** marcar as matrizes com tags e filtrar por elas,
**para** achar "o canal Digital" ou "tudo do G4" numa lista de 102 itens.

**Critérios de aceitação:**
- Toda matriz tem uma lista de tags (`Matrix.tags`), livremente criadas pelo usuário e
  registradas no catálogo (`CatalogItem` de kind `TAG`), com **grupo** opcional
  (`Canal`, `Cluster`, `Risco CEP`).
- A carga aplica as tags do perfil automaticamente a partir das colunas de partição e da dimensão
  desdobrada, sem apagar tags aplicadas manualmente (RN-12).
- A lista de matrizes e a barra lateral filtram por tag, com facetas por grupo e combinação `E`
  entre grupos diferentes (`Canal: Digital` **e** `Cluster: G4`).
- Renomear uma tag reflete em todas as matrizes; arquivar uma tag a esconde dos filtros sem
  removê-la das matrizes que já a têm.

### US-10 — Auditar a carga depois
**Como** auditor da política, **quero** ver na linha do tempo que houve uma carga e o que ela
produziu, **para** rastrear qualquer célula até o arquivo que a originou.

**Critérios de aceitação:**
- Cada aplicação gera um evento `IMPORT_RUN` com: perfil, nome do arquivo, hash do conteúdo,
  contagem de linhas, e os totais por estado (novas, alteradas, inalteradas, ignoradas).
- Todo rascunho criado pela carga carrega `importRunId` no payload do seu `DRAFT_CREATED`, e o
  patch de células carrega o mesmo id no `CELLS_UPDATED`.
- O resumo em pt-BR aparece pronto na linha do tempo: *"Arthur carregou CINEMINHA_20260708.csv:
  3 de 102 matrizes alteradas, 99 inalteradas."*

## 3. Cenários de teste (Gherkin)

### CT-01 — Segunda carga do mesmo arquivo não muda nada (cobre US-06)
```gherkin
Dado   um documento onde a carga do arquivo A já foi aplicada e publicada
Quando o usuário carrega exatamente o mesmo arquivo A
Então  todas as matrizes aparecem como INALTERADA
  E    o total de células alteradas é zero
  E    o botão de aplicar fica desabilitado com a mensagem "nenhuma alteração a aplicar"
  E    nenhum rascunho é criado
```

### CT-02 — Só a matriz alterada é versionada (cobre US-06)
```gherkin
Dado   um documento com 102 matrizes publicadas na versão 1
  E    um arquivo idêntico ao anterior exceto por 5 células do canal Digital do G4 Risco Alto
Quando o usuário aplica a carga
Então  a matriz MTZ_G4_RISCO_ALTO_DIGITAL ganha um rascunho v2 com as 5 células aplicadas
  E    as outras 101 matrizes continuam apenas com a versão 1
  E    nenhuma das 101 recebe evento algum
  E    o evento IMPORT_RUN registra 1 alterada e 101 inalteradas
```

### CT-03 — Linha do arquivo fora da estrutura do eixo (cobre US-05)
```gherkin
Dado   uma matriz publicada cujo eixo Y não contém a faixa R26
  E    um arquivo que traz linhas com MOD_ADC = R26 para essa matriz
Quando o plano é calculado
Então  a matriz aparece como ESTRUTURA DIVERGENTE
  E    o detalhe lista a tupla nova e as linhas do arquivo que a produzem
  E    a matriz não pode ser selecionada para aplicação
  E    nenhuma outra matriz do plano é afetada por isso
```

### CT-04 — Combinação do grid sem linha no arquivo (cobre US-05)
```gherkin
Dado   uma matriz publicada com 567 combinações
  E    um arquivo que traz apenas 560 delas
Quando o plano é calculado
Então  a matriz aparece como ALTERADA ou INALTERADA conforme as 560 comparadas
  E    um aviso informa "7 combinações sem linha no arquivo — conteúdo atual preservado"
  E    as 7 células permanecem exatamente como estavam na versão publicada
```

### CT-05 — Chave duplicada com conteúdo conflitante (cobre US-01)
```gherkin
Dado   um arquivo com duas linhas para a mesma combinação e ofertas diferentes
Quando o plano é calculado
Então  o resultado é o erro IMPORT_DUPLICATE_KEY apontando as duas linhas
  E    nenhuma matriz do plano é aplicável
  E    nada é gravado no documento
```

### CT-06 — Chave duplicada com conteúdo idêntico (cobre US-01)
```gherkin
Dado   um arquivo com duas linhas idênticas para a mesma combinação
Quando o plano é calculado
Então  a duplicata vira aviso, não erro
  E    a linha é contada uma vez só
```

### CT-07 — Valor de eixo não mapeado bloqueia o plano (cobre US-03)
```gherkin
Dado   um arquivo cuja coluna MOD_ADC traz o valor "R30", inexistente na variável
  E    que o usuário não mapeou esse valor nem mandou ignorá-lo
Quando o usuário tenta avançar para o plano
Então  o avanço é bloqueado com IMPORT_UNMAPPED_VALUE
  E    a mensagem nomeia a coluna, o valor e a primeira linha em que ele aparece
```

### CT-08 — Decisão derivada da oferta (cobre US-05)
```gherkin
Dado   a regra de decisão "oferta OFERTA_0 → REPROVADO, demais → APROVADO"
Quando uma linha traz 0 na coluna do canal URA
Então  a célula correspondente da matriz do canal URA nasce com decision REPROVADO e offer OFERTA_0
  E    uma linha com 15 nasce com decision APROVADO e offer OFERTA_15
  E    nenhuma célula da carga fica sem decisão
```

### CT-09 — Desdobramento das colunas de valor (cobre US-02)
```gherkin
Dado   um arquivo com as colunas OFERTA, OFERTA_GERAL, OFERTA_DIGITAL, OFERTA_URA, OFERTA_PAP e OFERTA_OUTBOUND
  E    o perfil que as desdobra na dimensão "Canal"
Quando o plano é calculado sobre as 6.678 linhas
Então  o plano contém 102 matrizes
  E    cada linha do arquivo produz exatamente 6 células, uma por matriz de canal
  E    a matriz do canal Digital do G4 Risco Alto tem 567 combinações
```

### CT-10 — Matriz com rascunho aberto (cobre US-06)
```gherkin
Dado   uma matriz que já tem um rascunho em edição
Quando o plano é calculado e essa matriz teria alterações
Então  ela aparece como BLOQUEADA com o motivo "já existe rascunho aberto"
  E    a ação sugerida é publicar ou descartar o rascunho antes de recarregar
  E    as demais matrizes seguem aplicáveis normalmente
```

### CT-11 — Documento mudou entre o plano e a aplicação (cobre US-05)
```gherkin
Dado   um plano calculado e revisado pelo usuário
  E    que outra ação alterou o documento antes da confirmação
Quando o usuário confirma a aplicação
Então  a aplicação falha com IMPORT_PLAN_STALE
  E    o assistente recalcula o plano e mostra o que mudou
  E    nenhuma alteração parcial é gravada
```

### CT-12 — Perfil reconhecido pelo cabeçalho (cobre US-08)
```gherkin
Dado   um documento com o perfil CARGA_CINEMINHA salvo
Quando o usuário abre um arquivo com exatamente o mesmo cabeçalho
Então  o assistente informa "Perfil CARGA_CINEMINHA reconhecido" e vai direto ao plano
Quando o usuário abre um arquivo com uma coluna a mais
Então  o assistente mostra a diferença de cabeçalho e pede confirmação antes de seguir
```

### CT-13 — Tags aplicadas pela carga não apagam as manuais (cobre US-09)
```gherkin
Dado   uma matriz que recebeu manualmente a tag "Prioritária"
Quando uma nova carga aplica as tags Canal_Digital, Cluster_G4 e Risco_Alto na mesma matriz
Então  a matriz fica com as quatro tags
  E    nenhuma tag é duplicada
```

### CT-14 — Aplicação parcial por seleção (cobre US-06)
```gherkin
Dado   um plano com 8 matrizes alteradas
Quando o usuário desmarca 3 delas e aplica
Então  5 rascunhos são criados
  E    as 3 desmarcadas permanecem sem rascunho e sem evento
  E    o evento IMPORT_RUN registra as 3 como ignoradas por escolha do usuário
```

### CT-15 — Publicação em lote só dos revisados (cobre US-07)
```gherkin
Dado   uma fila de revisão com 5 rascunhos criados pela carga
  E    3 deles marcados como revisados
Quando o usuário aciona "Publicar revisados"
Então  as 3 versões são publicadas com a nota da carga
  E    os 2 restantes continuam como rascunho
  E    cada versão publicada carrega o importRunId no evento
```

### CT-16 — Matriz nova nasce sem pendência artificial (cobre US-06)
```gherkin
Dado   uma variável de modelo adicional com 6 domínios e a compatibilidade publicada
  E    um arquivo cujo recorte G1 usa apenas os modelos BHV do G1 e Restritivos
Quando a carga cria a matriz MTZ_G1_SEM_RISCO_DIGITAL
Então  o eixo Y nasce com 22 tuplas efetivas, das 110 que o produto geraria
  E    as 88 tuplas de Y que o arquivo não traz nascem em manualSuppressions
  E    a matriz tem zero combinações pendentes e pode ser publicada
  E    o plano informa "88 combinações marcadas como inexistentes"
```

## 4. Regras de negócio e invariantes

| # | Regra | Consequência da violação |
|---|---|---|
| RN-01 | A carga **nunca** altera uma versão publicada. Só cria matriz nova, rascunho novo e células dentro de rascunho | Corromperia o registro histórico — é a garantia I3 |
| RN-02 | Matriz sem nenhuma diferença de célula não recebe rascunho, versão nem evento | Perde-se o lastro: toda carga versionaria tudo e a linha do tempo deixaria de informar o que mudou |
| RN-03 | A comparação é feita sobre o conteúdo da célula (`decision`, `offer`, `limit`, `limitOverride`, `color`, `note`, `attrs`), campo a campo, e ignora a ordem das linhas do arquivo | Falso positivo de alteração |
| RN-04 | A chave da célula vem do valor **mapeado** (código de domínio), nunca do texto bruto do arquivo | Célula órfã, quebra I5 |
| RN-05 | Idempotência: aplicar o mesmo arquivo duas vezes sobre o mesmo documento produz zero alterações na segunda | É o teste ácido de RN-02 e RN-03 |
| RN-06 | Linha do arquivo cuja tupla não existe nos eixos da matriz torna a **matriz inteira** `ESTRUTURA DIVERGENTE`; a carga não aplica parte dela | Aplicação parcial silenciosa deixaria a matriz num estado que ninguém pediu |
| RN-07 | Combinação existente no grid sem linha correspondente no arquivo segue a política `missingRowPolicy` do perfil: `KEEP` (padrão, preserva e avisa) ou `CLEAR` (esvazia a célula) | Apagar por omissão é o pior desfecho possível — por isso o padrão é preservar |
| RN-08 | Chave de célula repetida no arquivo com conteúdo divergente é erro; com conteúdo idêntico é aviso | Ambiguidade não resolvida vira dado arbitrário |
| RN-09 | Matriz existente no documento e ausente do arquivo permanece intocada; nunca é arquivada nem esvaziada pela carga | Um arquivo parcial apagaria política vigente |
| RN-10 | A carga não publica. Rascunhos criados por ela são publicados pelo fluxo normal, com nota (`NOTES_REQUIRED`), após revisão | Política em vigor sem revisão humana |
| RN-11 | Toda célula produzida pela carga sai com `decision` preenchida, derivada pela tabela de regras do perfil | I6 impediria a publicação, e a matriz nova nasceria impublicável |
| RN-12 | Tags aplicadas pela carga são acrescentadas; tags manuais nunca são removidas por uma carga | Perda de classificação feita à mão |
| RN-13 | O plano é dry-run puro: `planImport` não escreve no documento, e nada é gravado antes da confirmação do último passo | Efeito colateral em passo de leitura |
| RN-14 | Na aplicação o plano é recalculado sobre o documento corrente; divergência do plano revisado → `IMPORT_PLAN_STALE`, sem gravar nada | Aplicar um plano obsoleto sobrescreve trabalho de outra pessoa |
| RN-15 | Matriz com rascunho aberto fica `BLOQUEADA` (I1 permite um rascunho por matriz) | `DRAFT_ALREADY_EXISTS` no meio da aplicação, com parte do lote já gravada |
| RN-16 | Valor de arquivo sem mapeamento bloqueia o plano; nunca é ignorado em silêncio | Célula faltando sem ninguém perceber |
| RN-17 | A aplicação de células nunca cria variável, domínio ou item de catálogo. O bootstrap da biblioteca (US-04) é um passo explícito e anterior | Biblioteca crescendo sozinha, com códigos que ninguém revisou |
| RN-18 | Matrizes criadas pela carga respeitam I13 (1–3 níveis por eixo) e I16 (6.000 combinações) | Erro de validação com o lote já pela metade |
| RN-19 | Um perfil é reconhecido automaticamente apenas quando o cabeçalho do arquivo é **idêntico** ao `signature` salvo — mesmos nomes, mesma ordem | Mapear coluna errada por semelhança de nome |
| RN-20 | O hash do arquivo gravado no evento é calculado sobre o texto normalizado (sem BOM, com quebras de linha em LF) | Mesmo arquivo com hash diferente por detalhe de codificação |
| RN-21 | Numa matriz **nova**, com `suppressUnobserved`, toda **tupla** de eixo cujas combinações não aparecem em nenhuma linha do arquivo nasce em `manualSuppressions` — "não existe neste cineminha", não "pendente". Tupla parcialmente observada nunca é suprimida: as combinações que faltam viram pendência normal. Não vale para matriz existente, onde a ausência de linha segue RN-07 | Sem isso, uma matriz nasce com centenas de combinações pendentes que nunca serão preenchidas, e I6 impede a publicação para sempre |

**Por que RN-21 existe.** A variável do nível externo de um eixo é uma só para todas as matrizes — no caso real, um `MODELO_ADICIONAL` com seis modelos. Cada cineminha usa um ou dois deles: o G1 usa o BHV do G1 e os Restritivos; o G6 usa só o HVI4. O produto de eixos geraria 110 linhas em toda matriz, e o arquivo traz 22 no G1 e 21 no G6 — as outras não estão faltando, elas **não existem** naquele recorte. A supressão manual (`04-eixos-aninhados.md` §5.4) é exatamente o mecanismo para isso, é explícita, aparece na interface como "88 combinações suprimidas" e entra na auditoria. A alternativa — uma variável de modelo por cluster — multiplicaria a biblioteca e quebraria a comparabilidade entre cineminhas.

## 5. Especificação técnica

### 5.1 Módulos

```
src/core/import/
  ├── issues.ts          # catálogo de códigos e severidade do ImportIssue
  ├── parse-table.ts     # texto delimitado → matriz de células (puro, sem dependência)
  ├── profile.ts         # tipos + Zod do ImportProfile; normalização de valores
  ├── resolve.ts         # perfil + tabela → linhas resolvidas (matriz, xPath, yPath, célula)
  ├── plan.ts            # planImport: estado por matriz, diff, totais
  ├── library-gaps.ts    # o que falta na biblioteca (domínios, catálogo, compatibilidade)
  ├── apply.ts           # comando import/apply (S24)
  ├── hash.ts            # hash estável do conteúdo e do plano (FNV-1a, puro)
  └── index.ts           # o barril que o assistente e a aplicação consomem
```

`src/core/` continua TypeScript puro: nada aqui usa `window`, `File`, `TextDecoder` de stream nem
`crypto.subtle`. A leitura do arquivo (seleção, drag-and-drop, decodificação) fica em
`src/storage/`, e entrega **texto** ao motor.

### 5.2 Papéis de coluna

| Papel | Significado | Restrições |
|---|---|---|
| `PARTITION` | Compõe a identidade da matriz. Cada combinação distinta de valores das colunas de partição é uma matriz | 1 a 4 colunas |
| `AXIS` | Um nível de um eixo. Declara `role: 'X' \| 'Y'`, `level` (0 = mais externo) e a `variableId` pinada | 1 a 3 níveis por eixo (I13); níveis contíguos a partir de 0 |
| `VALUE` | Conteúdo da célula. Declara o campo alvo (`offer`, `limit`, `note`, `attr:<nome>`) | ao menos 1 |
| `CHECK` | Coluna de conferência: o perfil declara o valor esperado; divergência vira aviso no plano | opcional |
| `IGNORE` | Ignorada | — |

`CHECK` existe para colunas descritivas redundantes, como `DS_MOD_PRC` (sempre `HVI3`): se um dia
o arquivo trouxer outro modelo principal, a carga acusa em vez de carregar o dado como se fosse
o mesmo score.

### 5.3 Desdobramento de colunas de valor (unpivot)

Quando o arquivo traz **uma coluna por variação da mesma medida** — o caso das 6 colunas de
oferta —, o perfil declara uma `UnpivotDimension`: o nome de cada coluna vira o valor de uma
dimensão implícita, e cada valor dessa dimensão entra na identidade da matriz.

```
CLUSTER_GRUPO=G4, CEP_RISCO=c.RISCO ALTO, OFERTA=15, OFERTA_DIGITAL=15, OFERTA_URA=0, …
   ↓ desdobra em
MTZ_G4_RISCO_ALTO_TETO      célula ← OFERTA          = 15
MTZ_G4_RISCO_ALTO_DIGITAL   célula ← OFERTA_DIGITAL  = 15
MTZ_G4_RISCO_ALTO_URA       célula ← OFERTA_URA      = 0
…
```

Sem `unpivot`, as colunas de valor alimentam campos diferentes da **mesma** célula (`offer` e
`limit`, por exemplo) — é o formato do export canônico (`08-camada-de-comandos.md` §5), que
continua funcionando como entrada.

### 5.4 Contratos

```ts
// issues.ts — o vocabulário compartilhado
type ImportIssue = {
  code: ImportIssueCode;        // §5.8
  severity: 'ERROR' | 'WARNING';// sai do código, não da situação
  message: string;              // pt-BR, pronta para a tela
  line?: number;                // 1-based, do arquivo original
  column?: string;
  details?: Record<string, unknown>;   // inclui `occurrences` quando o problema se repete
};

// parse-table.ts
type DelimitedFormat = {
  delimiter: ';' | ',' | '\t' | '|';
  headerRow: number;            // 1-based
  hasBom: boolean;
  trimValues: boolean;          // default true
};

/** O que o motor consome depois do parser — e o que `import/apply` recebe. */
type ImportTable = {
  header: string[];
  rows: string[][];             // sem a linha de cabeçalho
  lines?: number[];             // linha 1-based de cada linha de `rows`
};

parseDelimitedTable(text: string, format?: Partial<DelimitedFormat>): {
  format: DelimitedFormat;      // o detectado ou o informado
  header: string[];
  rows: string[][];
  lines: number[];
  warnings: ImportIssue[];
  errors: ImportIssue[];
};
```

`lines` existe porque um campo entre aspas pode conter quebra de linha: a
n-ésima linha da tabela nem sempre é a n-ésima linha do arquivo, e toda mensagem
de erro cita a linha **do arquivo**. `sourceLine(table, index, headerRow)` faz a
leitura, caindo na aritmética simples quando `lines` não veio.

```ts
// profile.ts
type ImportProfile = {
  id: string;
  code: string;                 // CARGA_CINEMINHA — ^[A-Z0-9_]+$, único
  name: string;
  description?: string;
  createdAt: string;
  updatedAt?: string;
  format: DelimitedFormat;
  signature: string[];          // cabeçalho reconhecido, na ordem (RN-19)
  projectId: string;
  columns: ColumnMapping[];
  unpivot?: UnpivotDimension;
  codeTemplate: string;         // MTZ_{CLUSTER_GRUPO}_{CEP_RISCO}_{CANAL}
  nameTemplate: string;         // {CLUSTER_GRUPO} · {CEP_RISCO} · {CANAL}
  decisionRules: DecisionRule[];
  tagRules: TagRule[];
  missingRowPolicy: 'KEEP' | 'CLEAR';   // default KEEP (RN-07)
  suppressUnobserved: boolean;          // default true — só em matriz nova (RN-21)
};

type ColumnMapping = {
  column: string;                       // nome exato no cabeçalho
  role: 'PARTITION' | 'AXIS' | 'VALUE' | 'CHECK' | 'IGNORE';
  axis?: { role: 'X' | 'Y'; level: number; variableId: string };
  value?: { field: 'offer' | 'limit' | 'note' | `attr:${string}` };
  check?: { expected: string };
  valueMap?: Record<string, string>;    // valor do arquivo → code (domínio ou catálogo)
  ignoredValues?: string[];             // valores cujas linhas são descartadas, com aviso
};

type UnpivotDimension = {
  code: string;                         // CANAL
  label: string;                        // Canal
  options: Array<{ column: string; code: string; label: string }>;
};

type DecisionRule =
  | { when: { field: 'offer'; equals: string[] }; setDecision: string }
  | { otherwise: string };              // exatamente uma regra `otherwise`, sempre a última

type TagRule = {
  source: 'PARTITION' | 'UNPIVOT' | 'FIXED';
  column?: string;                      // quando source = PARTITION
  group: string;                        // Canal, Cluster, Risco CEP
  codePrefix?: string;                  // CANAL_ → CANAL_DIGITAL
  code?: string;                        // quando source = FIXED
};

/** O documento com os perfis salvos — `importProfiles` entra no schema na S23. */
type DocumentWithProfiles = PolicyOpsDocument & { importProfiles?: ImportProfile[] };

validateProfile(doc: DocumentWithProfiles, profile: ImportProfile): ImportIssue[];  // I21, I22
validateProfileAgainstHeader(profile, header: string[]): ImportIssue[];
matchImportProfile(doc: DocumentWithProfiles, header: string[]): ImportProfile | undefined;  // RN-19
normalizeValue(text: string): string;   // a.RISCO BAIXO → RISCO_BAIXO; '' = sem código
humanizeValue(text: string): string;    // c.RISCO ALTO → Risco Alto (rótulo do nameTemplate)
```

`normalizeValue` remove o prefixo de ordenação (uma ou duas letras/dígitos
seguidas de `.` ou `)`), o acento e a caixa, e troca pontuação e espaço por `_`.
O traço **não** é prefixo de ordenação: `G1 - BHV` vira `G1_BHV`, e é o
`valueMap` do perfil que o liga a `BHV_G1`. `humanizeValue` é a contraparte de
exibição, usada só pelo `nameTemplate` — o `codeTemplate` sempre usa códigos.

```ts
// resolve.ts
type ResolvedRow = {
  matrixKey: string;                    // valores de partição + opção do unpivot
  xPath: string;
  yPath: string;
  cell: Cell;
  source: { line: number; column: string };
};

/** A identidade de uma matriz citada pelo arquivo, pronta para os templates. */
type ResolvedMatrixKey = {
  key: string;
  values: Record<string, string>;       // code por coluna de partição + code do unpivot
  labels: Record<string, string>;       // rótulos dos mesmos marcadores
};

resolveImport(doc, table, profile): {
  rows: ResolvedRow[];
  keys: ResolvedMatrixKey[];
  issues: ImportIssue[];
  ignoredRows: number;
};
```

Uma linha do arquivo produz **uma célula por opção do desdobramento**; as
colunas de valor que não entram no desdobramento alimentam todas as células da
linha (é como `note` e `attr:*` convivem com as seis ofertas). Coluna de valor
vazia não produz célula — a combinação apenas não é observada por aquela matriz,
e é isso que RN-21 usa para decidir o que suprimir. Problemas que se repetem
(valor não mapeado, conferência divergente, linha ignorada) são agrupados por
**(código, coluna, valor)**, com a primeira linha e a contagem em
`details.occurrences`.

```ts
// plan.ts
planImport(
  doc: DocumentWithProfiles,
  table: ImportTable,
  profile: ImportProfile,
  opts?: { fileName?: string; contentHash?: string },
): ImportPlan;

type ImportPlan = {
  planHash: string;                     // documento + arquivo + perfil (RN-14)
  profileCode: string;
  source: { fileName?: string; rowCount: number; contentHash: string };
  matrices: MatrixPlan[];
  libraryGaps: LibraryGap[];
  totals: {
    new: number; changed: number; unchanged: number;
    structural: number; absentInFile: number; blocked: number;
    cellsChanged: number;
  };
  issues: ImportIssue[];
};

type MatrixPlan = {
  key: string;
  code: string;
  name: string;
  tags: string[];
  status: 'NEW' | 'CHANGED' | 'UNCHANGED' | 'STRUCTURAL' | 'ABSENT_IN_FILE' | 'BLOCKED';
  reason?: string;                      // por que BLOCKED / STRUCTURAL
  matrixId?: string;
  baseVersionId?: string;
  baseVersionNumber?: number;
  combinations: number;                 // combinações efetivas, já sem as suprimidas
  suppressedCombinations: number;       // tuplas suprimidas (X + Y), só em NEW (RN-21)
  changes: CellChange[];                // src/core/diff/cells.ts
  summary: DiffSummary;                 // src/core/diff/semantics.ts
  missingCombinations: string[];        // RN-07
  unknownTuples: Array<{ path: string; role: 'X' | 'Y'; lines: number[] }>;  // RN-06
  axes?: { x: PlannedAxis; y: PlannedAxis };   // só em NEW
};

/** O eixo que a matriz nova teria: pins, snapshot, tuplas efetivas e supressões. */
type PlannedAxis = {
  role: 'X' | 'Y';
  levels: Array<{ variableId: string; variableVersionId: string; label: string; domains: Domain[] }>;
  tuples: string[];
  manualSuppressions: string[];         // RN-21
  compatibilityVersionIds: string[];    // alimenta `derivedFrom`
};

/** A mesma projeção, sem a supressão por matriz — o que `matrix/create` receberia. */
projectImportAxes(doc, profile): { x: PlannedAxis; y: PlannedAxis };
```

`totals.cellsChanged` é a soma de `changes.length` do plano: numa carga inicial
ele é o total de células criadas (40.068 no caso real); numa carga de
atualização, o total de células que de fato mudam. `changes` de uma matriz `NEW`
traz uma entrada `ADDED` por célula, e o `summary` dela conta o grid inteiro em
`combinationsAdded`.

**Plano bloqueado.** Qualquer `ImportIssue` de severidade `ERROR` — perfil
inválido, coluna ausente, valor não mapeado, chave duplicada divergente, colisão
de código — faz `planImport` devolver `matrices: []` com os problemas em
`issues`: nenhuma matriz é classificada enquanto o arquivo não estiver íntegro
(RN-16, CT-05, CT-07). Um problema que atinge **uma** matriz (rascunho aberto,
grid grande demais, estrutura divergente) nunca bloqueia o plano inteiro
(DEC-CARGA-009).

**Mescla de conteúdo.** Com `missingRowPolicy: 'KEEP'` a carga preserva as
combinações que o arquivo não traz **e** os campos que ele não carrega dentro das
células que ele traz — uma observação escrita à mão sobrevive à recarga da
oferta. Com `'CLEAR'`, o conteúdo da matriz passa a ser exatamente o do arquivo.

```ts
// library-gaps.ts
computeLibraryGaps(doc, table, profile): LibraryGap[];

type LibraryGap = DomainsGap | CatalogGap | CompatibilityGap;

type DomainsGap = {
  kind: 'DOMAINS';
  variableId: string; variableCode: string; variableName: string;
  column: string; axis: 'X' | 'Y'; level: number;
  variablePublished: boolean;           // false = a variável nem versão publicada tem
  domains: Domain[];                    // code normalizado, rótulo do arquivo, cor da paleta
};

type CatalogGap = {
  kind: 'CATALOG';
  catalogKind: 'DECISION' | 'OFFER' | 'LIMIT' | 'TAG';
  items: Array<{ code: string; label: string }>;
};

type CompatibilityGap = {
  kind: 'COMPATIBILITY';
  parentVariableId: string; parentVariableCode: string;
  childVariableId: string; childVariableCode: string;
  axis: 'X' | 'Y';
  exists: boolean;                      // já há regra publicada; o mapa abaixo a completa
  allow: Record<string, string[]>;      // formato de CompatibilityVersion.allow
  defaultForUnlisted: 'NONE';
  missingPairs: Array<[string, string]>;// pares do arquivo que a regra atual não permite
};

// hash.ts
fnv1a64(text: string): bigint;          // FNV-1a de 64 bits, sem crypto.subtle
hashText(text: string): string;         // 16 dígitos hex do texto normalizado (RN-20)
hashTable(table: ImportTable): string;  // a mesma coisa, a partir da tabela já lida
hashValue(value: unknown): string;      // serialização canônica (chaves ordenadas)

// apply.ts — comando (S24)
'import/apply': {
  profile: ImportProfile;
  table: { header: string[]; rows: string[][] };
  fileName?: string;
  planHash: string;                     // o plano que o usuário revisou (RN-14)
  selectedKeys: string[];               // matrizes escolhidas no plano
  notes: string;                        // nota da carga, ≥ 10 caracteres
} → { importRunId: string; createdMatrices: string[]; createdDrafts: string[] };
```

`source.contentHash` sai de `hashTable` quando o chamador não informa nada — a
mesma informação do arquivo em forma canônica, imune a BOM, CRLF e escolha de
separador. Quem ainda tem o texto passa `opts.contentHash = hashText(texto)`, e
RN-20 vale literalmente. `planHash` cobre o perfil, o conteúdo do arquivo e o
**resultado** da leitura do documento (estado, matriz e versão-base de cada linha
do plano): versão publicada é imutável (I3), então o id da base já responde por
todo o conteúdo comparado.

### 5.5 Estados do plano

| Estado | Quando | O que a aplicação faz |
|---|---|---|
| `NEW` | Não existe matriz com aquele código no projeto | Cria a matriz, v1 `DRAFT`, células aplicadas, tags |
| `CHANGED` | Existe versão publicada e o conteúdo difere em ao menos uma célula | Cria rascunho v(n+1) da publicada e aplica só as células que mudam |
| `UNCHANGED` | Existe versão publicada e nenhuma célula difere | **Nada** (RN-02) |
| `STRUCTURAL` | O arquivo traz tupla que não existe no eixo da matriz | Nada; a matriz é listada com o detalhe da divergência (S25 resolve) |
| `ABSENT_IN_FILE` | Matriz existe no projeto e não aparece no arquivo | Nada (RN-09) |
| `BLOCKED` | Já existe rascunho aberto na matriz; ou o código está ocupado por uma matriz arquivada; ou não há versão publicada para servir de base; ou a matriz nova não caberia nos eixos (grid acima de 6.000, I16; variável sem versão publicada; nenhuma tupla válida) | Nada; `reason` diz o que resolver antes |

A classificação segue esta ordem, e para na primeira que se aplica: matriz
arquivada com o mesmo código → falta de versão-base → **estrutura divergente** →
rascunho aberto → comparação de células. A divergência estrutural vem antes do
rascunho porque é problema do arquivo, e é ela que a S25 resolve; o rascunho
aberto é problema do documento, e quem o resolve é o usuário.

### 5.6 Modelo de dados

A carga acrescenta ao documento, sempre de forma aditiva: `importProfiles` no topo
(`03-modelo-do-documento.md` §7.1), `Matrix.tags` (§5), `CatalogItem.group` (§4), os tipos de
evento `IMPORT_RUN`, `IMPORT_PROFILE_SAVED` e `MATRIX_TAGGED` (§8), as invariantes I20–I22 (§9) e
`schemaVersion: 3` com a migração 2→3 (§10).

### 5.7 Desempenho

| Operação | Alvo | Como é medido |
|---|---|---|
| `parseDelimitedTable` de 20.000 × 30 | < 300 ms | teste unitário com fixture gerada |
| `resolveImport` de 6.678 linhas × 6 desdobramentos | < 400 ms | fixture real do CINEMINHA |
| `planImport` de 102 matrizes / 40.000 células | < 1 s | fixture real + documento carregado |
| `import/apply` de 102 rascunhos | < 2 s | tudo em memória, um único documento novo |

O crescimento do arquivo é conhecido e aceito: 40.068 células ocupam ~2,5 MB de JSON, e cada
carga que altera N matrizes acrescenta o tamanho dessas N. Acima de 5 MB a aplicação já oferece
gravar comprimido (`06-persistencia-e-concorrencia.md` §4) — é o mecanismo que sustenta o
histórico de cargas mensais.

### 5.8 Catálogo de erros

Erros — severidade `ERROR`. Qualquer um deles bloqueia o plano inteiro, exceto
`IMPORT_STRUCTURE_DIVERGED` e `IMPORT_TARGET_HAS_DRAFT`, que a aplicação lança
para uma matriz específica.

| Código | Quando | O que o usuário faz |
|---|---|---|
| `IMPORT_PARSE_ERROR` | Cabeçalho ausente, coluna sem nome ou repetida, número de colunas inconsistente, arquivo vazio | Corrige o arquivo; a mensagem aponta linha e coluna |
| `IMPORT_PROFILE_INVALID` | Perfil sem coluna de partição, sem eixo, com níveis não contíguos, sem regra `otherwise`, com coluna que o arquivo não tem, ou com padrão de código que colide | Ajusta o mapeamento no passo 2 |
| `IMPORT_PROFILE_DUPLICATE` | Código de perfil já existe no documento | Escolhe outro código ou atualiza o existente |
| `IMPORT_UNMAPPED_VALUE` | Valor de coluna de eixo ou de valor sem correspondência na biblioteca | Mapeia, cria o domínio/item ou marca como ignorado |
| `IMPORT_DUPLICATE_KEY` | Mesma combinação com conteúdo divergente | Corrige a extração |
| `IMPORT_STRUCTURE_DIVERGED` | Aplicação pedida para matriz `STRUCTURAL` | Atualiza a variável e o eixo antes (S25) |
| `IMPORT_PLAN_STALE` | Documento mudou entre plano e aplicação | Revisa o plano recalculado |
| `IMPORT_NOTHING_TO_APPLY` | Seleção vazia ou só matrizes inalteradas | Nada a fazer — a carga não mudou nada |
| `IMPORT_TARGET_HAS_DRAFT` | Matriz selecionada tem rascunho aberto | Publica ou descarta o rascunho |
| `TAG_NOT_FOUND` | Tag referenciada por matriz não existe no catálogo | Recria a tag ou remove a referência |

Avisos — severidade `WARNING`. Descrevem o que a carga fez; nenhum impede o
plano, e os dois últimos acompanham uma matriz `BLOCKED`.

| Código | Quando |
|---|---|
| `IMPORT_DELIMITER_NOT_DETECTED` | Nenhum separador no cabeçalho: o arquivo foi lido como uma coluna só |
| `IMPORT_CHECK_MISMATCH` | Coluna de conferência trouxe valor diferente do esperado (§5.2) |
| `IMPORT_ROW_IGNORED` | Linha descartada por `ignoredValues` |
| `IMPORT_DUPLICATE_ROW` | Chave repetida com conteúdo idêntico — contada uma vez (RN-08) |
| `IMPORT_MISSING_ROW` | Combinações do grid sem linha no arquivo (RN-07) |
| `IMPORT_TUPLES_SUPPRESSED` | Tuplas marcadas como inexistentes numa matriz nova (RN-21) |
| `IMPORT_GRID_TOO_LARGE` | Matriz nova acima de 6.000 combinações (I16) |
| `IMPORT_NO_BASE_VERSION` | Matriz existente sem versão publicada para comparar |

Os códigos de erro entram em `src/core/errors.ts` com mensagem pt-BR em
`src/core/error-messages.ts` (`05-regras-de-negocio.md` §9); os de aviso vivem em
`src/core/import/issues.ts`, que é também quem decide a severidade de cada um —
severidade é propriedade do código, não da situação.

## 6. Interface

### 6.1 O assistente

Rota interna `import`, aberto por "Carregar tabela" na tela de Projetos e na de Matrizes. Seis
passos, com barra de progresso e navegação livre para trás; nada é gravado antes do passo 6.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Carga de matrizes                                            [1][2][3][4][5][6] │
├───────────────────────────────────────────────────────────────────────────┤
│ 1 ARQUIVO      arrastar .csv/.tsv, selecionar ou colar                      │
│                separador ; · UTF-8 · 6.678 linhas · 12 colunas              │
│                ✓ Perfil CARGA_CINEMINHA reconhecido pelo cabeçalho          │
│                                                    [Ir direto ao plano →]   │
├───────────────────────────────────────────────────────────────────────────┤
│ 2 COLUNAS      CLUSTER_GRUPO  ▸ Partição                                    │
│                CEP_RISCO      ▸ Partição                                    │
│                DS_MOD_PRC     ▸ Conferência = HVI3                          │
│                MOD_PRC        ▸ Eixo X · nível 0 · SCORE_HVI3               │
│                DS_MOD_ADC     ▸ Eixo Y · nível 0 · MODELO_ADICIONAL         │
│                MOD_ADC        ▸ Eixo Y · nível 1 · FAIXA_MODELO_ADICIONAL   │
│                OFERTA…OUTBOUND▸ Valor · oferta · desdobrar em "Canal"       │
│                                                                             │
│                → 17 partições × 6 canais = 102 matrizes · 40.068 células     │
│                → maior grid: 21 × 27 = 567 combinações (limite 6.000) ✓      │
│                Código: MTZ_{CLUSTER_GRUPO}_{CEP_RISCO}_{CANAL}              │
│                        MTZ_G4_RISCO_ALTO_DIGITAL, MTZ_G1_SEM_RISCO_URA, …   │
├───────────────────────────────────────────────────────────────────────────┤
│ 3 BIBLIOTECA   ✓ SCORE_HVI3 — 20 de 21 domínios existem                     │
│                ⚠ falta R99 · [criar domínio]  [mapear para…]  [ignorar]     │
│                ⚠ MODELO_ADICIONAL não existe · [criar variável com 6 domínios]│
│                ⚠ compatibilidade MODELO_ADICIONAL × FAIXA: [criar do arquivo]│
│                ⚠ catálogo: faltam OFERTA_0, OFERTA_3 · [criar]              │
├───────────────────────────────────────────────────────────────────────────┤
│ 4 CONTEÚDO     Oferta 0 → decisão Reprovado                                 │
│                demais    → decisão Aprovado                                 │
│                Sem linha no arquivo: (•) preservar  ( ) esvaziar            │
│                Tags: Canal · Cluster · Risco CEP                            │
├───────────────────────────────────────────────────────────────────────────┤
│ 5 PLANO        3 alteradas · 0 novas · 99 inalteradas · 0 divergentes        │
│                [x] MTZ_G4_RISCO_ALTO_DIGITAL   12 células  ⚑ 8 fechadas     │
│                [x] MTZ_G4_RISCO_ALTO_URA        4 células  ⚑ 4 abertas      │
│                [ ] MTZ_G5_RISCO_BAIXO_PAP       1 célula   ⚑ 1 oferta       │
│                    …99 inalteradas (ocultas)          [mostrar todas]       │
├───────────────────────────────────────────────────────────────────────────┤
│ 6 APLICAR      Nota da carga: "Carga CINEMINHA_20260708"                    │
│                → cria 2 rascunhos. Nada é publicado agora.  [Aplicar]       │
└───────────────────────────────────────────────────────────────────────────┘
```

Detalhes que valem como critério de aceite:

- **Passo 1** aceita arquivo e colagem; ao reconhecer um perfil pelo cabeçalho (RN-19), oferece
  o atalho direto ao passo 5, mantendo os passos 2–4 acessíveis para conferência.
- **Passo 2** mostra o cálculo de matrizes/células ao vivo e a prévia dos códigos gerados,
  destacando colisões antes de qualquer gravação.
- **Passo 3** só existe enquanto houver pendência: com a biblioteca completa, o assistente pula
  o passo e o marca como ✓. Cada pendência tem as três saídas de US-03.
- **Passo 5** é a tela principal: filtros por estado e por tag, ordenação por número de células
  alteradas, seleção em massa por estado, e expansão para o diff completo reaproveitando
  `CompareView` (`07-ux-e-editor.md` §9). Inalteradas ficam recolhidas por padrão — são a maioria
  e não exigem ação.
- **Passo 6** informa em números o que vai acontecer ("cria 2 rascunhos, não publica nada") e,
  ao concluir, abre a fila de revisão (§6.2). Oferece também "Salvar como perfil".

### 6.2 Fila de revisão

Reaproveita a tela de Rascunhos (`DraftsScreen`) com um filtro por carga: os rascunhos daquela
`importRunId`, cada um com o resumo semântico, ações "Ver diff", "Marcar como revisado" e
"Publicar", e um botão de lote "Publicar revisados". A origem fica visível no rascunho mesmo
depois de fechar o assistente: *"Criado pela carga CINEMINHA_20260708 em 10/08/2026"*.

### 6.3 Tags

- Na matriz: campo de tags no inspector, com autocompletar sobre o catálogo de kind `TAG` e
  criação inline ("criar tag «Prioritária» no grupo «Operação»").
- Na lista de matrizes e na barra lateral: filtro por facetas, uma linha por grupo de tags, com
  `E` entre grupos e `OU` dentro do mesmo grupo, e contagem por tag.
- Na tela de Conteúdo: a aba `TAG` ganha a coluna Grupo, editável.

## 7. Fora do escopo

- **Resolver estrutura divergente automaticamente** — criar nova versão de variável com os
  domínios novos e adotar no rascunho é a sessão S25 (DEC-CARGA-009). Até lá, a matriz é listada
  e ignorada pela aplicação.
- **Publicação automática pela carga** — decidido contra em DEC-CARGA-005; a carga sempre para
  no rascunho.
- **Carga de bibliotecas isolada** (só variáveis, sem matrizes) — o passo 3 cobre o que a carga
  de matrizes precisa; importar catálogo de variáveis por si só não é objetivo.
- **Agendamento, watch de pasta, integração com o sistema de origem** — a aplicação não faz
  requisição de rede (`02-arquitetura.md` §2); a carga é sempre iniciada por uma pessoa com um
  arquivo em mãos.
- **Desfazer uma carga inteira num clique** — cada rascunho criado é descartável pelo fluxo
  normal, e o undo cobre a aplicação enquanto a sessão estiver aberta. Um "reverter carga"
  transacional exigiria um conceito novo de transação no documento.
- **Cortes numéricos das faixas na carga** — a carga cria identidade de domínio; faixas entram
  por "Colar tabela" (§11 de `07-ux-e-editor.md`).

## 8. Apêndice — o perfil `CARGA_CINEMINHA`

O caso real que originou a funcionalidade, resolvido ponta a ponta. Serve de fixture das sessões
e de referência de como um perfil se parece preenchido.

**Arquivo**: `CINEMINHA_20260708.csv` — separador `;`, UTF-8 sem BOM, 6.678 linhas de dados, 12
colunas, chave `(CLUSTER_GRUPO, CEP_RISCO, MOD_PRC, MOD_ADC)` única.

### 8.1 Papéis das colunas

| Coluna | Papel | Detalhe |
|---|---|---|
| `CLUSTER_GRUPO` | Partição | 7 valores: `G1`…`G7` |
| `CEP_RISCO` | Partição | `a.RISCO BAIXO` → `RISCO_BAIXO`, `b.RISCO NEUTRO` → `RISCO_NEUTRO`, `c.RISCO ALTO` → `RISCO_ALTO`, `d. SEM RISCO` → `SEM_RISCO` |
| `DS_MOD_PRC` | Conferência | esperado `HVI3`; outro valor vira aviso no plano |
| `MOD_PRC` | Eixo X · nível 0 | variável `SCORE_HVI3`; `R01`…`R20`, `R99` |
| `DS_MOD_ADC` | Eixo Y · nível 0 | variável `MODELO_ADICIONAL` (§8.3) |
| `MOD_ADC` | Eixo Y · nível 1 | variável `FAIXA_MODELO_ADICIONAL`; `y. Sem Rest` → `SEM_REST`, `z. Com Rest` → `COM_REST` |
| `OFERTA` … `OFERTA_OUTBOUND` | Valor · `offer` | desdobradas na dimensão `CANAL` (§8.2) |

`codeTemplate`: `MTZ_{CLUSTER_GRUPO}_{CEP_RISCO}_{CANAL}` · `nameTemplate`: `{CLUSTER_GRUPO} · {CEP_RISCO} · {CANAL}`
→ `MTZ_G4_RISCO_ALTO_DIGITAL`, "G4 · Risco Alto · Digital".

`missingRowPolicy: 'KEEP'` · `suppressUnobserved: true` · `projectId`: `POLITICA_B2C`.

### 8.2 Desdobramento e conteúdo

| Coluna | Opção de `CANAL` | | Valor lido | Item de catálogo | Decisão |
|---|---|---|---|---|---|
| `OFERTA` | `TETO` ("Teto da política") | | `0` | `OFERTA_0` | `REPROVADO` |
| `OFERTA_GERAL` | `GERAL` | | `3` | `OFERTA_3` | `APROVADO` |
| `OFERTA_DIGITAL` | `DIGITAL` | | `5` | `OFERTA_5` | `APROVADO` |
| `OFERTA_URA` | `URA` | | `8` | `OFERTA_8` | `APROVADO` |
| `OFERTA_PAP` | `PAP` | | `12` | `OFERTA_12` | `APROVADO` |
| `OFERTA_OUTBOUND` | `OUTBOUND` | | `15` | `OFERTA_15` | `APROVADO` |

`decisionRules`: `offer ∈ {OFERTA_0} → REPROVADO`; `otherwise → APROVADO` (DEC-CARGA-004).

`tagRules`: `CLUSTER_GRUPO` → grupo "Cluster", prefixo `CLUSTER_` · `CEP_RISCO` → grupo "Risco
CEP", prefixo `RISCO_` · `CANAL` → grupo "Canal", prefixo `CANAL_`. Total: 17 tags.

### 8.3 O que a biblioteca precisa ter

| Entidade | Situação | O que falta |
|---|---|---|
| `SCORE_HVI3` (RANGE) | existe, v1 publicada, `R01`–`R20` | v2 com `R99` — "Sem score (fallback)", faixa `0`–`4`, contígua com `R20` (que começa em `5`) |
| `SCORE_HVI4` (RANGE) | existe, v1 publicada, `R01`–`R20` | `R99`, quando a variável for usada com corte próprio |
| `MODELO_ADICIONAL` (CATEGORICAL) | não existe | 6 domínios: `BHV_G1`, `BHV_G4`, `BHV_G5`, `BHV_G7`, `SCORE_HVI4`, `RESTRITIVOS` |
| `FAIXA_MODELO_ADICIONAL` (RANGE) | não existe | 28 domínios: `R01`–`R25`, `R99`, `SEM_REST`, `COM_REST` |
| `MODELO_ADICIONAL × FAIXA_MODELO_ADICIONAL` | não existe | mapa deduzido do arquivo: `BHV_G1` → `R01`–`R20`; `BHV_G4` → `R01`–`R25`; `BHV_G5`, `BHV_G7`, `SCORE_HVI4` → `R01`–`R20` + `R99`; `RESTRITIVOS` → `SEM_REST`, `COM_REST`; `defaultForUnlisted: 'NONE'` |
| Catálogo | vazio | `DECISION`: `APROVADO`, `REPROVADO` · `OFFER`: `OFERTA_0`, `OFERTA_3`, `OFERTA_5`, `OFERTA_8`, `OFERTA_12`, `OFERTA_15` · `TAG`: as 17 de §8.2 |

Os **cortes numéricos** de cada BHV (`BHV_G1`, `BHV_G4`, `BHV_G5`, `BHV_G7`) não entram pela carga:
`FAIXA_MODELO_ADICIONAL` é uma variável `RANGE` com `groupingDimensions: [{ code: 'MODELO' }]`
(`05-regras-de-negocio.md` §5.6), e os intervalos de cada modelo entram depois, colando a tabela
de cortes (`07-ux-e-editor.md` §11) — uma linha por `(modelo, faixa, mínimo, máximo)`. Isso não
invalida nenhuma matriz: o snapshot do eixo só carrega identidade
(`03-modelo-do-documento.md` §6.1).

### 8.4 O que a carga produz

| | |
|---|---|
| Partições | 17 (`CLUSTER_GRUPO` × `CEP_RISCO` observados) |
| Matrizes | **102** (17 × 6 canais), todas em `POLITICA_B2C` |
| Células | **40.068** (6.678 linhas × 6 canais) |
| Maior grid | `MTZ_G4_*` — 21 × 27 = 567 combinações, com 83 das 110 tuplas de Y suprimidas por RN-21 |
| Menor grid | `MTZ_G3_*` — 21 × 2 = 42 combinações |
| Tags aplicadas | 3 por matriz (cluster, risco, canal) |
