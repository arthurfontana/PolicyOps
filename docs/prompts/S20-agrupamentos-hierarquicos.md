# Sessão 20 — Agrupamentos Hierárquicos de Faixas

**Modelo: `Opus`** · **Depende de:** S19 · **Pós-MVP**

---

## Prompt

> Você está implementando a Sessão 20 do Policy Matrix Studio — generalização da dimensão regional (sessão 18) em agrupamentos hierárquicos de 1 a 4 níveis, com nomes livres, dentro de uma única variável.
>
> **Leia antes de começar:** `docs/03-modelo-do-documento.md` §2 (schema `GroupingDimension`/`GroupingOption`/`GroupingRange`, substituindo `RegionalDimension`/`RegionalOption`/`RegionalRange`) e §10 (migração de `schemaVersion` 1→2 — **leia com atenção, é a única migração não-aditiva do produto até aqui**), §9 (I9 e I19 generalizados), `docs/05-regras-de-negocio.md` §5.6 inteiro (a seção foi reescrita: "Agrupamentos hierárquicos de faixas", §5.6.2 contrato de colagem com colunas de agrupamento, §5.6.3 preservação, §5.6.5 duplicar), `docs/07-ux-e-editor.md` §11 (editor de agrupamentos e tabela tidy, substituindo o grid pivotado da S18), `docs/08-camada-de-comandos.md` §3/§4. Não tome decisões de arquitetura fora do documentado — se faltar algo, **pare e pergunte**.
>
> ### Contexto do problema (não reabrir esta decisão, só implementar)
> Um caso real de score B2B tem corte numérico variando não só por Regional, mas por Regional × Porte da Empresa (MEI, Não MEI com 1 sócio, Não MEI com mais de 1 sócio) — uma hierarquia de 2 níveis, e as combinações são **assimétricas** (nem toda Regional tem as três variações de Porte). O desenho já fechado generaliza `regionalDimension` (1 nível fixo, nome fixo "regional") em `groupingDimensions` (1 a 4 níveis, nome e opções livres), com `Domain.groupingRanges` carregando o `path` completo por entrada em vez de uma única chave. Nunca vira eixo de matriz — a garantia da S18 ("a matriz nunca sabe que existe agrupamento") continua valendo, generalizada para N níveis. Não existe exigência de que toda combinação possível de opções tenha faixa — só as que o usuário efetivamente definiu.
>
> A sessão 19 já entregou `parseDomainTable`/`mergeImportedDomains`/paletas para o caso sem agrupamento. Esta sessão estende esses mesmos mecanismos para colunas de agrupamento, e **substitui** — não mantém em paralelo — o caminho de colagem específico de regional que a S18 deixou.
>
> ### Objetivo
> Schema, validação, migração, parser e editor prontos para uma variável `RANGE` documentar faixas por combinação de 1 a 4 agrupamentos de negócio, inferidos de uma colagem de tabela, sem exigir configuração manual prévia nem completude de combinações.
>
> ### Escopo
>
> #### 1. Schema — `src/core/document/schema.ts` (Zod) e tipos
> Renomear/restruturar conforme `docs/03-modelo-do-documento.md` §2: `RegionalDimension` → `GroupingDimension` (`code`, `label`, `options: GroupingOption[]`), `RegionalOption` → `GroupingOption`, `RegionalRange` → `GroupingRange` (ganha `path: string[]`). `VariableVersion.regionalDimension?` → `groupingDimensions?: GroupingDimension[]`. `Domain.regionalRanges?: Record<string, RegionalRange>` → `Domain.groupingRanges?: GroupingRange[]`. Bump `schemaVersion` para `2`.
>
> #### 2. Migração — `src/core/document/migrate.ts`
> Nova migração `1 → 2`, conforme `docs/03-modelo-do-documento.md` §10: para toda `VariableVersion` com `regionalDimension`, gera `groupingDimensions = [{ code: 'REGIONAL', label: 'Regional', options: regionalDimension.regions }]` e, por domínio, `groupingRanges` a partir de `Object.entries(regionalRanges)` com `path: [regionCode]`; remove os campos antigos. Documentos sem `regionalDimension` passam sem alteração de conteúdo. Teste obrigatório com a fixture real de `regionalDimension` que já existe dos testes da S18 — migrar e comparar contra o formato novo esperado, campo a campo.
>
> #### 3. Validação — `src/core/library/validate-domains.ts`
> Generalizar `validateDomains` conforme I9/I19 novos (`docs/03-modelo-do-documento.md` §9):
> - **I19 (estrutura)**: `groupingDimensions` com 1 a 4 níveis (`TOO_MANY_GROUPING_LEVELS` acima disso); `code` de nível único entre os níveis (`GROUPING_DIMENSION_CODE_DUPLICATE`); `options` não vazio com `code` único dentro do nível (`GROUPING_OPTION_CODE_DUPLICATE`); todo `GroupingRange.path` com o comprimento certo e apontando para opções existentes (`GROUPING_PATH_INVALID`).
> - **I9 (contiguidade)**: agrupe `groupingRanges` de todos os domínios `RANGE` da versão por `path` distinto (chave = `path.join('|')`); dentro de **cada grupo**, aplique a mesma regra de hoje (contígua, sem sobreposição, um `isCatchAll` no fim, respeitando `boundaryMode`) — `RANGE_GROUPING_NOT_CONTIGUOUS` com `{ path, domainCode }`. **Não existe verificação de completude entre paths** — um domínio pode ter entrada em alguns caminhos e não em outros; isso é deliberado (ver nota após I19 em `docs/03`), não é bug.
> - Nova consulta pura (não é invariante, não bloqueia salvar): `findIncompleteGroupingPaths(domains, groupingDimensions): Array<{ path: string[]; missingDomainCodes: string[] }>` — para cada `path` presente, lista os domínios `RANGE` da versão que têm entrada em **algum outro** `path` mas não neste. Usada só pela interface (item 6) para avisar, nunca pela validação de salvar.
>
> #### 4. Comandos — `src/core/library/variables.ts`
> `variable/saveDomains`: renomear parâmetro `regionalDimension?` → `groupingDimensions?`. `variable/duplicate`: copiar `groupingDimensions` em vez de `regionalDimension` (mesma lógica de `structuredClone`, só o nome do campo muda).
>
> #### 5. Snapshot do eixo — `src/core/axes/` (onde `matrix/create`/`axis/addLevel`/`axis/resnapshot` copiam domínios, ver S18 item 4)
> Atualizar para nunca copiar `groupingRanges` nem `groupingDimensions` para `AxisLevel.domains` — mesma garantia de antes, campos renomeados. Teste: variável com 20 domínios × 9 regionais × 3 portes (3 níveis de agrupamento) gera snapshot do mesmo tamanho que a mesma variável sem agrupamento nenhum.
>
> #### 6. Importação — `src/core/library/domain-import.ts` (estende o que a S19 criou)
> Estender `parseDomainTable` para reconhecer de 0 a 4 colunas de agrupamento à esquerda de `Domínio` (qualquer coluna com nome não reconhecido nessa posição, na ordem em que aparece — mais de 4 é `DOMAIN_TABLE_PARSE_ERROR`), conforme o contrato completo de `docs/05-regras-de-negocio.md` §5.6.2: código de cada `GroupingOption` = texto da célula normalizado (maiúsculo, sem acento, espaço → `_`); `label` do nível = cabeçalho da coluna; ordem das opções = ordem de primeira aparição. Retorno passa a incluir `groupingDimensions` detectados. Estender `mergeImportedDomains` para casar por `(code, path)` quando há agrupamento — preserva `color`/faixa de uma entrada existente com o mesmo `code` **e** mesmo `path` quando a colagem não trouxe coluna para atualizá-la; entradas de outros `path`s do mesmo domínio não são afetadas.
>
> #### 7. Interface — editor de domínios
> Substituir o grid pivotado da S18 (colunas mín/máx por regional) pela tabela tidy de `docs/07-ux-e-editor.md` §11: editor de lista de agrupamentos (nome, contagem de opções, reordenável por drag — populado principalmente pela colagem, com edição manual complementar de renomear/reordenar/remover/adicionar vazio); tabela de domínios como lista de linhas `(agrupamento…, domínio, mín, máx, cor)`, agrupada visualmente por `path`; validação de contiguidade em tempo real por `path`; banner não-bloqueante usando `findIncompleteGroupingPaths` para avisar combinações prováveis de esquecimento. Adicionar o botão "Baixar modelo com agrupamentos (.csv)" (`Agrupamento 1, Agrupamento 2, Domínio, Mínimo, Máximo, Cor`, com o exemplo de Regional × Porte). **Remover** o botão/dialog de colagem específico de regional e o toggle "Esta faixa varia por regional" da S18 — o botão "Colar tabela" único da S19 passa a ser o único caminho, detectando agrupamento automaticamente pela colagem.
>
> #### 8. Limpeza
> Remover `src/core/library/regional-import.ts` e `parseRegionalRangeTable` (substituídos por `domain-import.ts`), e os testes/fixtures que testavam exclusivamente o formato de colagem de 2 linhas de cabeçalho da S18 (a fixture de migração do item 2 continua existindo, mas como fixture de **documento**, não de parser).
>
> ### Testes
> - Schema/migração: fixture antiga com `regionalDimension` migra para `groupingDimensions` de 1 nível `REGIONAL`; documento sem `regionalDimension` passa sem alteração; `schemaVersion` final é `2`.
> - `validateDomains`: contiguidade ok em 3 `path`s independentes; sobreposição num `path` só não afeta os demais; `groupingDimensions` com 5 níveis falha (`TOO_MANY_GROUPING_LEVELS`); `code` de nível duplicado; `code` de opção duplicado dentro do nível; `path` de comprimento errado ou apontando opção inexistente (`GROUPING_PATH_INVALID`); domínio ausente de um `path` que outros domínios preenchem **não** falha a validação (comportamento intencional).
> - `findIncompleteGroupingPaths`: detecta corretamente o caso do exemplo de `docs/05-regras-de-negocio.md` §5.6.2 (São Paulo tem R1/R2 em MEI mas só R1 em Não MEI) sem bloquear o salvamento.
> - Snapshot do eixo nunca carrega `groupingRanges`/`groupingDimensions`, com 1, 2 e 3 níveis de agrupamento.
> - `parseDomainTable` com colunas de agrupamento: o exemplo real de Regional × Porte de `docs/05-regras-de-negocio.md` §5.6.2 (4 linhas, combinações assimétricas) produz `groupingDimensions` e `groupingRanges` corretos sem erro; mais de 4 colunas de agrupamento falha.
> - `mergeImportedDomains` com `path`: recolar uma tabela que só atualiza `path` `["SP","MEI"]` não afeta `["SP","NAO_MEI"]` do mesmo domínio.
> - `variable/duplicate`: copia `groupingDimensions` de N níveis fielmente.
> - Componente: tabela tidy agrupa visualmente por `path`; erro de contiguidade aponta o `path` certo; banner de combinação incompleta aparece e não bloqueia salvar.
> - E2E: criar variável `RANGE`, colar a tabela de exemplo de Regional × Porte, salvar, publicar; usar essa variável num eixo de matriz e confirmar que o número de tuplas independe do agrupamento; duplicar a variável e confirmar que `groupingDimensions`, faixas e cores sobrevivem.
>
> ### Critérios de aceite
> - Uma variável `RANGE` com `groupingDimensions` de 3 níveis (ex.: Regional × Porte × Tipo de Empresa) e domínios assimétricos entre combinações salva e publica sem exigir que toda combinação exista.
> - Colar a tabela tidy de N colunas de agrupamento popula `groupingDimensions` e `groupingRanges` sem qualquer configuração manual prévia.
> - Abrir um documento salvo pela sessão 18 (`regionalDimension`) migra automaticamente para `groupingDimensions` de 1 nível, sem intervenção do usuário, sem perda de dado.
> - Uma variável com `groupingDimensions` de qualquer tamanho usada num eixo de matriz produz o **mesmo** número de colunas/linhas e o **mesmo** conjunto de `tuples` que a mesma variável teria sem agrupamento — a matriz não sabe que existe agrupamento (mesma garantia da S18, agora para N níveis).
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, orçamento de 1 MB respeitado, `dist/PolicyOps.html` atualizado.
>
> ### Fora do escopo
> Qualquer cálculo de "dado um score bruto + combinação de agrupamento, qual é a faixa" — continua sendo decisão do sistema externo que gera o score; o PolicyOps só documenta e versiona os cortes. Upload de `.xlsx` (só colar TSV/CSV). Agrupamentos aparecerem como nível de eixo de matriz — são exclusivamente documentação da variável (ver §5.6 de `docs/05-regras-de-negocio.md` sobre por que isso não é eixo aninhado). Migração em lote de várias variáveis regionais de uma vez — a migração de schema é automática por documento, mas reorganizar manualmente os níveis de uma variável (ex.: dividir "Regional" em dois níveis) é o usuário quem decide, variável por variável.
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push.
