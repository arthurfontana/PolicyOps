# Sessão 02 — Modelo do documento e validação

**Modelo: `Sonnet`** · **Depende de:** S01

---

## Prompt

> Você está implementando a Sessão 02 do Policy Matrix Studio.
>
> **Leia `docs/03-modelo-do-documento.md` por inteiro antes de começar.** Os tipos daquele documento são **normativos e literais**: transcreva-os exatamente. Não renomeie campos, não adicione campos "que fariam sentido", não troque tipos. Se algo parecer errado, **pare e pergunte** — não corrija sozinho.
>
> ### Contexto
> Não há banco de dados. O documento é um arquivo `.json` que precisa ser legível por humanos, validável e estável entre versões da aplicação. Este é o alicerce de tudo.
>
> ### Objetivo
> Tipos, schema Zod, validação de invariantes, documento de exemplo e infraestrutura de migração. Nenhuma tela nesta sessão.
>
> ### Escopo
>
> #### 1. `src/core/document/schema.ts`
> Todos os tipos TypeScript de `docs/03-modelo-do-documento.md` §1–§8, com os schemas Zod correspondentes. Pontos que costumam sair errados:
> - decimais são **string**, validados por regex, nunca `number`;
> - datas são string ISO 8601 UTC, validadas;
> - `code` casa `^[A-Z0-9_]+$` — e **não pode conter `|` nem `:`**, porque esses são os separadores de caminho (`docs/04-eixos-aninhados.md` §2). Escreva um teste explícito para isso;
> - campos opcionais são **omitidos** quando vazios, nunca gravados como `null`. Configure o Zod e a serialização de acordo;
> - `cells` é `Record<string, Cell>` e **células vazias não existem** — chave ausente significa não preenchida.
>
> #### 2. `src/core/document/validate.ts`
> ```ts
> validateDocument(doc: unknown): { ok: true; document: PolicyOpsDocument }
>                               | { ok: false; issues: ValidationIssue[] };
>
> type ValidationIssue = {
>   severity: 'ERROR' | 'WARNING';
>   invariant: string;          // 'I5'
>   path: string;               // 'matrices[2].versions[0].cells["R1::VAREJO|ATE_100K"]'
>   message: string;            // pt-BR
>   autoFix?: 'REMOVE' | 'RENUMBER' | 'CLEAR_REF';
> };
> ```
> Implemente **todas** as invariantes I1–I18 de §9. Cada uma vira uma função nomeada, testada isoladamente com um caso válido e um inválido. A validação roda em duas situações: ao ler um arquivo e antes de todo salvamento.
>
> Importante: a validação **não descarta** o documento. Ela devolve a lista de problemas, e a Sessão 05 constrói o modo de recuperação em cima disso. Marque com `autoFix` o que é seguro corrigir automaticamente.
>
> #### 3. `src/core/document/create.ts`
> - `createEmptyDocument(name, actor)` — documento válido e vazio.
> - `createSampleDocument()` — o documento de exemplo de `docs/03-modelo-do-documento.md` §11, **gerado por código** (nunca um JSON fixo, para não desatualizar). Precisa conter as 6 variáveis, a regra de compatibilidade `SEG_X_FATURAMENTO`, o catálogo completo, 2 projetos, e as duas matrizes:
>   - `MTZ_LIMITE_PF`: eixos de 1 nível, 24 combinações, v1 PUBLISHED + v2 DRAFT com 3 células alteradas;
>   - `MTZ_LIMITE_PJ`: **eixo Y com 2 níveis** (`SEGMENTO` › `FAT`) e a compatibilidade aplicada — **8 tuplas em Y, não 15** — × 6 em X = 48 combinações, todas preenchidas, v1 PUBLISHED.
>
>   Para gerar as tuplas do eixo aninhado nesta sessão, escreva a expansão inline no próprio `create.ts`, com um comentário dizendo que a Sessão 03 substitui isso por `generateTuples`. Não antecipe o motor de eixos aqui.
>
> - `createSampleDocument()` deve passar por `validateDocument` sem nenhum `ERROR`. Isso é um teste.
>
> #### 4. `src/core/document/migrate.ts`
> - `migrateDocument(raw): { document, migrationsApplied: string[] }`.
> - Cadeia de migrações por `schemaVersion` (hoje só existe a 1, mas a infraestrutura precisa existir e estar testada com uma migração fictícia `0 → 1` em fixture).
> - Arquivo com `schemaVersion` maior que o suportado → `DOCUMENT_SCHEMA_TOO_NEW` com a mensagem: *"Este arquivo foi salvo por uma versão mais nova do PolicyOps. Atualize o PolicyOps.html."*
>
> #### 5. `src/core/document/serialize.ts`
> - `serialize(doc): string` — `JSON.stringify` com indentação 2, chaves em ordem estável, campos vazios omitidos.
> - `deserialize(text): unknown`.
> - `hashDocument(text): Promise<string>` — SHA-256 via `crypto.subtle`, hex.
> - **Round-trip idêntico**: `deserialize(serialize(doc))` deep-equal a `doc`. Teste com o documento de exemplo inteiro.
>
> #### 6. Fixtures
> `tests/fixtures/` com: documento válido mínimo, documento de exemplo serializado, e **5 documentos defeituosos**, um para cada tipo de problema corrigível (referência de catálogo inexistente, célula com coordenada inválida, tupla órfã, `position` com buraco, duas versões PUBLISHED na mesma matriz).
>
> #### 7. Tela mínima de verificação
> Ligue o botão **"Explorar com dados de exemplo"** da tela inicial: carrega `createSampleDocument()` em memória e mostra uma tela provisória listando o que há no documento (contagens de variáveis, projetos, matrizes, e para cada matriz o número de versões e de combinações). É só para você conseguir ver que funciona — a interface de verdade vem depois.
>
> ### Critérios de aceite
> - `createSampleDocument()` passa na validação sem erros.
> - Round-trip de serialização é idêntico.
> - Cada uma das 18 invariantes tem teste de caso válido e inválido.
> - Os 5 fixtures defeituosos produzem exatamente os `ValidationIssue` esperados, com `path` correto.
> - Abrir `dist/PolicyOps.html` e clicar em "Explorar com dados de exemplo" mostra: 6 variáveis, 1 regra de compatibilidade, 2 projetos, 2 matrizes, e a matriz PJ com **48 combinações**.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, tamanho dentro do orçamento.
>
> ### Fora do escopo
> Motor de eixos (S03), comandos (S04), persistência em arquivo (S05).
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push.
