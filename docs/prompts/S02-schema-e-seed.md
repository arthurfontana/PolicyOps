# Sessão 02 — Schema, migrations e seed

**Modelo recomendado: `Sonnet`**
**Depende de:** S01
**Marco:** banco de dados completo e populado

---

## Prompt

> Você está implementando a Sessão 02 do Policy Matrix Studio.
>
> **Leia `docs/03-modelo-de-dados.md` por inteiro antes de começar.** O schema Prisma naquele documento é **normativo e literal**: transcreva-o exatamente. Não renomeie campos, não adicione campos "que fariam sentido", não remova o que parecer redundante, não troque tipos. Se algo parecer errado, **pare e pergunte** — não corrija sozinho.
>
> ### Objetivo
> `pnpm db:reset` derruba, recria, migra e popula o banco com dados realistas.
>
> ### Escopo
>
> 1. **`prisma/schema.prisma` completo**, transcrito de `docs/03-modelo-de-dados.md` §2 — todos os enums, todos os models, todos os índices e unicidades. O model `User` já existe da Sessão 01: complete-o com as relações que agora passam a existir.
>
> 2. **Migration inicial** (`pnpm prisma migrate dev --name init`). Depois de gerada, **edite o arquivo SQL da migration** para acrescentar os quatro índices únicos parciais de `docs/03-modelo-de-dados.md` §3:
>    ```sql
>    CREATE UNIQUE INDEX "matrix_one_draft"       ON "MatrixVersion"   ("matrixId")   WHERE "state" = 'DRAFT';
>    CREATE UNIQUE INDEX "matrix_one_published"   ON "MatrixVersion"   ("matrixId")   WHERE "state" = 'PUBLISHED';
>    CREATE UNIQUE INDEX "variable_one_draft"     ON "VariableVersion" ("variableId") WHERE "state" = 'DRAFT';
>    CREATE UNIQUE INDEX "variable_one_published" ON "VariableVersion" ("variableId") WHERE "state" = 'PUBLISHED';
>    ```
>    Eles são a garantia física das invariantes I1 e I2 — não os deixe só no código.
>
> 3. **`src/server/db.ts`**: singleton do PrismaClient com o padrão de `globalThis` para sobreviver ao hot reload do Next.
>
> 4. **`prisma/seed.ts`**, **idempotente** (upsert por chave natural — rodar duas vezes não duplica nada), criando exatamente o que está em `docs/03-modelo-de-dados.md` §4:
>    - 3 usuários (admin, editor, viewer), senha `policyops` com bcrypt custo 12;
>    - 4 variáveis com suas versões v1 `PUBLISHED` e todos os domínios, respeitando `position`, e os campos de faixa (`rangeMin`, `rangeMax`, `minInclusive`, `maxInclusive`, `isCatchAll`) nas variáveis do tipo RANGE;
>    - o catálogo completo (4 decisões com as cores indicadas, 6 ofertas, 4 limites com `numericValue`);
>    - 2 projetos;
>    - a matriz de exemplo `MTZ_LIMITE_PF` em Política PF, eixo X = `SCORE_HVI3`, eixo Y = `RESTRITIVO`, com:
>      - **v1 `PUBLISHED`**: snapshot completo dos dois eixos em `MatrixAxis` + `MatrixAxisDomain`, as 24 células (6 × 4) todas com decisão preenchida e `isUnset = false`, distribuição plausível (R1/R2 aprovando com limites altos, R5/R6 e Restritivo Alto reprovando, faixa do meio em análise manual), `effectiveFrom` há 90 dias, `effectiveTo` nulo, `publishedById` = editor;
>      - **v2 `DRAFT`** derivada de v1 (`baseVersionId`), clone integral, com **exatamente 3 células alteradas** (uma decisão, uma oferta, um limite) — isso existe para dar o que comparar na Sessão 10;
>      - eventos de auditoria coerentes (`DRAFT_CREATED`, `CELLS_UPDATED`, `PUBLISHED`) com `summary` em pt-BR.
>
>    O seed deve montar o snapshot **copiando** de `VariableDomain` para `MatrixAxisDomain`, não referenciando. Escreva uma função auxiliar `snapshotAxis()` no próprio seed; ela será reescrita como service na Sessão 03 e isso é esperado.
>
> 5. **Script `db:reset`** = `prisma migrate reset --force` + seed, num comando só.
>
> 6. **Testes** (`tests/unit/schema.test.ts`), rodando contra o banco de teste:
>    - o seed é idempotente (rodar 2× mantém as contagens);
>    - a matriz de exemplo tem 24 células na v1 e 24 na v2;
>    - tentar criar um segundo `MatrixVersion` com `state = DRAFT` para a mesma matriz **falha** com violação de índice único;
>    - tentar criar uma segunda versão `PUBLISHED` para a mesma matriz **falha**;
>    - `getEffectiveVersion` cru em SQL (ver `docs/04-regras-de-negocio.md` §6) devolve a v1 para a data de hoje.
>
>    Configure um banco de teste separado (`policyops_test`) via `.env.test`, e um script `test:unit` que o prepare com `prisma migrate deploy`.
>
> 7. **Atualize o CI** para subir um serviço `postgres:16-alpine` e rodar as migrations antes de `test:unit`.
>
> ### Critérios de aceite
> - `pnpm db:reset` termina sem erro e imprime um resumo do que criou.
> - `pnpm db:studio` mostra os dados esperados.
> - Rodar o seed duas vezes seguidas não altera contagens.
> - Todos os testes desta sessão passam, incluindo os dois que verificam a falha dos índices parciais.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes.
>
> ### Fora do escopo
> Services, actions e qualquer tela. Esta sessão é banco e dados.
>
> ### Encerramento
> Commit descritivo e push.
