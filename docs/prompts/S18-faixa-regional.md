# Sessão 18 — Faixas Regionais e Duplicação de Variáveis

**Modelo: `Sonnet`** · **Depende de:** S06 · **Pós-MVP** (adicionada depois do fechamento das 17 sessões originais)

---

## Prompt

> Você está implementando a Sessão 18 do Policy Matrix Studio — dimensão regional em variáveis `RANGE` e duplicação de variável na Biblioteca de Variáveis.
>
> **Leia antes de começar:** `docs/03-modelo-do-documento.md` §2 (schema `RegionalDimension`/`RegionalRange`) e §6.1 (por que o snapshot do eixo nunca carrega `regionalRanges`), `docs/05-regras-de-negocio.md` §5.6 (as três subseções — editar, importar, duplicar), §9 (novos códigos de erro) e §1.1 passo 4, `docs/07-ux-e-editor.md` §11 (bloco Variáveis, toggle regional e "Criar a partir de existente") e `docs/08-camada-de-comandos.md` §3 (comandos `variable/saveDomains` estendido e `variable/duplicate`) e §4 (`parseRegionalRangeTable`). Não tome decisões de arquitetura fora do documentado — se faltar algo, **pare e pergunte**.
>
> ### Contexto do problema (não reabrir esta decisão, só implementar)
> Um modelo de score (ex.: HVI1) tem as mesmas faixas de risco (R01…R20, mesmo código/rótulo/cor) em toda regional, mas o corte numérico de score que define cada faixa muda por regional — é normalização de risco entre regionais. A matriz de políticas **nunca** deve carregar Regional como dimensão: `R01` é um único código, sempre. Por isso o desenho já fechado é: dimensão regional vive **dentro** da variável (`VariableVersion.regionalDimension` + `Domain.regionalRanges`), nunca vira nível de eixo, e é explicitamente removida do snapshot que vai para a matriz.
>
> ### Objetivo
> Editor de domínios de variável `RANGE` com threshold por regional, colagem em massa de uma tabela (Excel → TSV) para popular as faixas de uma vez, e duplicação de variável ("criar a partir de existente") para qualquer tipo.
>
> ### Escopo
>
> #### 1. Schema — `src/core/document/schema.ts` (Zod) e tipos
> Adicionar `RegionalDimension`, `RegionalOption`, `RegionalRange` conforme `docs/03-modelo-do-documento.md` §2; `VariableVersion.regionalDimension?` e `Domain.regionalRanges?`. Migração de schema **não é necessária** (campos opcionais, documentos antigos continuam válidos sem migração — confirme isso com um teste de fixture antiga).
>
> #### 2. Validação — `src/core/library/validate-domains.ts`
> Estender `validateDomains` para ficar ciente de `regionalDimension` (I9, I19 — `docs/03` §9):
> - sem `regionalDimension`: comportamento **inalterado**;
> - com `regionalDimension`: `regions` não vazio, `code` único (`REGIONAL_CODE_DUPLICATE`); todo domínio `RANGE` tem entrada em `regionalRanges` para todo `region.code` (`RANGE_REGIONAL_INCOMPLETE`, apontando domínio + regional); contiguidade/sobreposição/catch-all validadas **por regional**, independentemente (`RANGE_REGIONAL_NOT_CONTIGUOUS`, `details: { regionCode, domainCode }`). Comparações em Decimal (`decimal.js-light`), nunca ponto flutuante — mesma regra de hoje.
>
> #### 3. Comandos — `src/core/library/variables.ts`
> - Estender `variable/saveDomains`: aceitar `regionalDimension?` no input (`docs/05` §5.6.1), gravar junto dos domínios, validar com o `validateDomains` estendido antes de gravar.
> - Novo comando `variable/duplicate` (`docs/05` §5.6.3): cria `Variable` nova com v1 `DRAFT` copiando `domains` e `regionalDimension` da versão de origem. Falha com `NOT_FOUND` se origem não existir, `DUPLICATE_CODE` se o código novo já existir. Sem evento de auditoria próprio — mesmo padrão de `variable/create`.
>
> #### 4. Snapshot do eixo — `src/core/axes/` (ou onde hoje `matrix/create`/`axis/addLevel`/`axis/resnapshot` copiam domínios)
> Garantir que a cópia para `AxisLevel.domains` **nunca** inclui `regionalRanges` nem `regionalDimension` — só os campos de identidade que já existem hoje. Teste explícito: variável com 20 domínios × 9 regionais gera snapshot do mesmo tamanho que a mesma variável sem `regionalDimension`.
>
> #### 5. Importação de tabela colada — `src/core/library/regional-import.ts`
> Função pura `parseRegionalRangeTable(text: string): { domains: Domain[]; regions: RegionalOption[]; warnings: string[]; errors: string[] }`, implementando o contrato exato de `docs/05-regras-de-negocio.md` §5.6.2 (duas linhas de cabeçalho com *carry-forward* de célula mesclada, `code`/`label` extraídos da primeira coluna, `position` pela ordem das linhas, célula vazia vira aviso e domínio incompleto, formato inconsistente vira `REGIONAL_IMPORT_PARSE_ERROR`). **Não grava nada** — devolve dados para a interface popular o formulário, que passa pelo `saveDomains` normal.
>
> #### 6. Interface — `/library/variables`
> - Editor de domínios: toggle "Esta faixa varia por regional" (só `RANGE`, só em `DRAFT`). Ligado: editor de lista de regionais (code/label, drag para reordenar) acima da tabela; tabela vira grid com um par mín/máx por regional; validação de contiguidade em tempo real **por coluna**; botão "Colar tabela" com caixa de texto, usando `parseRegionalRangeTable`, mostrando erros/avisos antes de aplicar ao grid.
> - Lista de variáveis e tela de nova variável: ação "Criar a partir de existente" — seletor de variável + versão de origem, formulário de código/nome/descrição da nova, chama `variable/duplicate`.
>
> ### Testes
> - `validateDomains` com `regionalDimension`: contiguidade ok em todas as regionais, buraco numa regional só, sobreposição numa regional só, `regions` vazio, `code` de regional duplicado, domínio sem entrada para uma regional.
> - Snapshot do eixo nunca carrega `regionalRanges`/`regionalDimension` (comparação de tamanho e de chaves presentes).
> - `parseRegionalRangeTable`: tabela bem formada (o exemplo real de 20 faixas × 9 regionais), célula mesclada de cabeçalho (carry-forward), célula de dado vazia (vira aviso, domínio incompleto), cabeçalho incompleto (erro), número de colunas inconsistente com uma linha de dado (erro).
> - `variable/duplicate`: copia domínios e `regionalDimension` fielmente; código duplicado falha; origem inexistente falha; variável de origem permanece intocada.
> - Fixture de documento **anterior** à sessão 18 (sem `regionalDimension` em nenhuma variável) continua válida sem migração.
> - Componente: alternar o toggle regional limpa o modo anterior sem erro; erro de contiguidade aponta a regional certa; colar tabela mal formada mostra erro sem fechar a caixa nem gravar.
> - E2E: criar variável `RANGE`, ligar dimensão regional, colar uma tabela pequena (2 regionais × 3 faixas), salvar, publicar; duplicar essa variável a partir da tela de nova variável e conferir que a cópia chega com os mesmos domínios em `DRAFT`.
>
> ### Critérios de aceite
> - Uma variável `RANGE` com `regionalDimension` de 9 regionais e 20 domínios, ao ser usada num eixo de matriz, produz o **mesmo** número de colunas/linhas e o **mesmo** conjunto de `tuples` que a mesma variável teria sem regional — a matriz não sabe que existe regional.
> - Colar a tabela do caso real (formato do Excel: faixa nas linhas, regional × MIN/MAX nas colunas) preenche o grid sem exigir digitação célula a célula.
> - Duplicar variável cria uma variável nova e independente, sem tocar na origem.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, orçamento de 1 MB respeitado, `dist/PolicyOps.html` atualizado.
>
> ### Fora do escopo
> Qualquer cálculo de "dado um score bruto + regional, qual é a faixa" — isso é decisão do sistema externo que gera o score; o PolicyOps só documenta e versiona os cortes. Upload de `.xlsx` (só colar TSV/CSV nesta sessão). Migração de variáveis `RANGE` existentes para o modo regional em lote — o usuário liga o toggle variável por variável.
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push.
