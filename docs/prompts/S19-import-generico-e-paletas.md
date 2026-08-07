# Sessão 19 — Importação Genérica de Domínios e Paletas de Cor

**Modelo: `Sonnet`** · **Depende de:** S18 · **Pós-MVP**

---

## Prompt

> Você está implementando a Sessão 19 do Policy Matrix Studio — importação genérica de domínios (qualquer tipo de variável, sem depender do modo regional), continuidade automática de faixas por padrão, preservação de atributos ao recolar, e paletas de cor.
>
> **Leia antes de começar:** `docs/03-modelo-do-documento.md` §2 (schema `Domain`, sem mudança nesta sessão — `groupingDimensions`/`groupingRanges` só chegam na S20), `docs/05-regras-de-negocio.md` §5.6 (as cinco subseções: dimensão de agrupamento, `boundaryMode`, `saveDomains`, **§5.6.2 importação genérica**, **§5.6.3 preservação**, **§5.6.4 paletas**, §5.6.5 duplicar), `docs/07-ux-e-editor.md` §11 (bloco Variáveis: colar tabela, continuidade automática, paletas) e §13 (paletas), `docs/08-camada-de-comandos.md` §4 (`parseDomainTable`, `mergeImportedDomains`, `suggestPaletteColors`). Não tome decisões de arquitetura fora do documentado — se faltar algo, **pare e pergunte**.
>
> ### Contexto do problema (não reabrir esta decisão, só implementar)
> A sessão 18 entregou colagem de tabela e duplicação de variável, mas a colagem só existe presa ao modo regional (`regionalDimension` ligado), força o usuário a marcar manualmente inclusivo/exclusivo em cada faixa, e nunca grava cor — por isso duplicar uma variável cujos domínios vieram de uma colagem "perde" cores que na verdade nunca existiram. Esta sessão generaliza a colagem para **qualquer** variável (`RANGE`, `CATEGORICAL`, `ORDINAL`, `BOOLEAN`), muda o padrão de faixa para inferir continuidade automaticamente, faz a colagem (e o recolar) preservar o que já existia, e adiciona paletas de cor oficiais.
>
> **O que esta sessão explicitamente NÃO faz:** não toca no schema do documento, não adiciona `groupingDimensions`/colunas de agrupamento ao parser — isso é a sessão 20, que depende desta. O caminho de colagem específico do modo regional (`regionalDimension` ligado, `parseRegionalRangeTable`, grid pivotado) **continua existindo e funcionando exatamente como a S18 deixou**; esta sessão adiciona um caminho novo, genérico, para quando `regionalDimension` **não** está ligado. As duas UIs de colagem coexistem por uma sessão — a S20 as unifica e remove a duplicidade.
>
> ### Objetivo
> Botão "Colar tabela" disponível para toda variável fora do modo regional, editor de domínios sem checkbox de inclusão por padrão, preservação automática de cor/atributos ao recolar, e duas paletas de cor oficiais aplicáveis manualmente ou por sugestão automática.
>
> ### Escopo
>
> #### 1. Parser genérico — `src/core/library/domain-import.ts` (arquivo novo)
> Função pura `parseDomainTable(text: string): { domains: Domain[]; columns: Set<'min'|'max'|'color'>; warnings: string[]; errors: string[] }`, implementando o contrato de `docs/05-regras-de-negocio.md` §5.6.2 **restrito a 0 colunas de agrupamento nesta sessão**:
> - linha 1 = cabeçalho obrigatório; reconhece `Domínio`/`Código` (âncora, deve ser a primeira coluna — qualquer coluna antes dela é erro `DOMAIN_TABLE_PARSE_ERROR` com mensagem indicando que colunas de agrupamento chegam em sessão futura), `Mínimo`/`Min`/`Mín`, `Máximo`/`Max`/`Máx`, `Cor`/`RGB`/`Hex` — todas exceto `Domínio` são opcionais, em qualquer ordem entre si;
> - `code`/`label` extraídos da coluna `Domínio` como em `regional-import.ts` hoje (texto antes do primeiro `" - "`/`–`/`—`, maiúsculo, valida `^[A-Z0-9_]+$`);
> - `Cor` aceita `#RRGGBB` ou `R G B`/`R, G, B` (0–255), convertida para `#RRGGBB`;
> - sem colunas de agrupamento, cada `code` só pode aparecer uma vez — repetição é `DOMAIN_TABLE_PARSE_ERROR`;
> - `position` = ordem de aparição na tabela;
> - `columns` no retorno registra quais dos três campos opcionais (`min`, `max`, `color`) o cabeçalho de fato trouxe — é o que orienta o merge (item 2).
>
> #### 2. Merge — mesmo arquivo
> `mergeImportedDomains(existingDomains: Domain[], parsed: { domains: Domain[]; columns: Set<...> }): Domain[]` conforme `docs/05-regras-de-negocio.md` §5.6.3: para cada domínio colado, casa por `code` com a lista existente; `label`/`shortLabel` sempre vêm da colagem; `color` só é sobrescrita se `columns.has('color')`, senão herda a existente; `rangeMin`/`rangeMax` só são sobrescritos se `columns.has('min') && columns.has('max')`, senão herdam os existentes. Domínio novo (sem correspondência) entra só com os campos que a colagem trouxe.
>
> #### 3. Paletas de cor — `src/lib/color-palettes.ts` (arquivo novo)
> Exporta `ColorPalette[]` com as duas paletas oficiais de `docs/05-regras-de-negocio.md` §5.6.4.1/§5.6.4.2 (`RISCO_R01_R20`, 20 entradas; `RISCO_SIMPLIFICADO`, 5 entradas), dados estáticos, sem I/O. Cada entrada casa por `code` **ou** `label` do domínio normalizado (maiúsculo, sem acento); a escala R01-R20 tolera zero à esquerda (`R1` casa com a entrada de `R01`).
> `suggestPaletteColors(domains: Domain[], paletteId: string): Domain[]` — devolve os domínios com `color` preenchida onde bateu, mantendo os demais campos e os domínios sem correspondência intocados.
>
> #### 4. Continuidade automática — `src/components/library/DomainsEditor.tsx`
> Remove os checkboxes "mín. inclusivo"/"máx. inclusivo" da visão padrão (tanto para faixa simples quanto, se o tempo permitir sem reescrever o grid regional, para faixa regional — mínimo obrigatório: a faixa simples). Comportamento assumido é `HALF_OPEN` sempre que o usuário não abrir "Opções avançadas". Dentro de "Opções avançadas" (link colapsado): o toggle `boundaryMode` que já existe (S18) e, atrás de um segundo controle, os checkboxes manuais de inclusão por faixa para o caso excepcional — reaproveite os componentes já existentes de S18 para os checkboxes, só mude onde ficam.
>
> #### 5. UI — botão "Colar tabela" genérico
> Em `DomainsEditor.tsx`: quando a variável **não** está em modo regional (`regionalDimension` ausente ou variável não é `RANGE`), mostrar "Colar tabela" chamando `parseDomainTable` → preview de erros/avisos → `mergeImportedDomains` contra os domínios atuais da tela → substitui o conteúdo do editor para revisão, sem gravar (`saveDomains` normal grava). Inclua também: exemplo inline do formato esperado dentro da caixa de colagem, e um botão "Baixar modelo simples (.csv)" que gera no cliente (Blob, sem rede) um CSV de exemplo (`Domínio,Mínimo,Máximo,Cor` para `RANGE`; `Domínio,Cor` para os demais tipos). Quando a variável **está** em modo regional, mantenha o botão e o fluxo de colagem da S18 sem alteração nenhuma.
>
> #### 6. UI — paletas
> Botão "Aplicar paleta" no editor de domínios (visível para `RANGE`, `CATEGORICAL`, `ORDINAL`): abre seletor com as duas paletas oficiais, aplica via `suggestPaletteColors` sobre os domínios da tela, mostra quantos bateram. Domínios criados sem cor (digitados ou colados sem coluna `Cor`) recebem a sugestão automática ao serem adicionados à lista, se o código/rótulo bater com uma paleta oficial — continua editável.
>
> ### Testes
> - `parseDomainTable`: tabela simples completa (`Domínio, Mínimo, Máximo`), só identidade+cor (`Domínio, Cor`, como o print de risco do usuário), coluna de agrupamento presente antes de `Domínio` (erro), `code` repetido sem agrupamento (erro), cabeçalho sem `Domínio` (erro), `Cor` em formato `R G B` e em `#RRGGBB`.
> - `mergeImportedDomains`: recolar só com `Cor` preserva `rangeMin`/`rangeMax` existentes; recolar só com `Mínimo`/`Máximo` preserva `color` existente; domínio novo sem correspondência entra só com os campos colados; domínio existente não mencionado na colagem permanece fora do resultado (é o usuário quem decide, ao revisar o preview, se mantém as linhas antigas colando-as também).
> - `suggestPaletteColors`: `R1`/`R01` casam com a mesma entrada da paleta R01-R20; "baixíssimo"/"Baixíssimo" casam com a paleta simplificada; domínio sem correspondência sai intocado.
> - Componente: colar tabela simples fora do modo regional preenche o editor; colar com erro de formato mostra a lista de erros sem fechar a caixa; alternar "Opções avançadas" reexibe os checkboxes de inclusão manual; aplicar paleta atualiza as cores visíveis.
> - E2E: criar variável `CATEGORICAL`, colar `Domínio, Cor` com 4 linhas, salvar, publicar; criar variável `RANGE` simples, colar `Domínio, Mínimo, Máximo` sem tocar em inclusão manual, confirmar que a validação de contiguidade passa sem exigir configuração extra; duplicar essa variável e confirmar que as cores aplicadas por paleta sobrevivem.
>
> ### Critérios de aceite
> - Colar `Domínio, Cor` sobre uma variável `RANGE` que já tinha faixas preenchidas atualiza só a cor, sem exigir que o usuário redigite mínimo/máximo.
> - Criar uma variável `CATEGORICAL`, `ORDINAL` ou `BOOLEAN` e colar uma tabela de domínios funciona — não é mais exclusivo de `RANGE` nem de modo regional.
> - Uma faixa `RANGE` simples, colada ou digitada só com mínimo/máximo, valida contiguidade sem o usuário tocar em nenhum checkbox de inclusão.
> - Aplicar a paleta `Risco R01–R20` numa variável com domínios `R1`...`R20` colore automaticamente os 20, sem digitação manual.
> - O caminho de colagem regional da S18 continua funcionando sem regressão.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, orçamento de 1 MB respeitado, `dist/PolicyOps.html` atualizado.
>
> ### Fora do escopo
> Colunas de agrupamento na colagem (Regional, Porte…) e qualquer mudança em `regionalDimension`/`regionalRanges` — isso é a sessão 20, que parte do que esta sessão constrói. Unificar os dois botões de "Colar tabela" (regional e genérico) num só — a sessão 20 faz essa limpeza junto da generalização do schema. Paletas customizadas salvas pelo usuário — só as duas oficiais nesta sessão. Migração de variáveis já coladas no formato antigo — nada muda nos dados existentes, só a experiência de colar de novo.
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push.
