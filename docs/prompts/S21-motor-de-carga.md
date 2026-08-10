# Sessão 21 — Motor de Carga de Matrizes

**Modelo: `Opus`** · **Depende de:** S14 (diff) · **Épico: Carga · Marco M6**

> **Por que Opus:** é comparação semântica em escala — 102 matrizes e 40.000 células — onde um
> falso negativo apaga a evidência de que a política mudou e um falso positivo enche a linha do
> tempo de versões idênticas, exatamente o que o épico existe para evitar. Combinatória de
> partição × desdobramento × tuplas com muitos casos de borda que não aparecem em teste feliz.

---

## Prompt

> Você está implementando a Sessão 21 do Policy Matrix Studio — o motor da carga de matrizes.
> É **só o motor**: TypeScript puro em `src/core/import/`, sem uma linha de React. A tela vem
> nas sessões 22 e 24.
>
> **Leia antes de começar:** `docs/12-carga-de-matrizes.md` inteiro (é a página normativa desta
> funcionalidade — §4 regras, §5 contratos, e os cenários CT-01 a CT-11), `docs/13-decisoes.md`
> DEC-CARGA-001 a 010, `docs/03-modelo-do-documento.md` §5, §6 e §7.1, e `docs/02-arquitetura.md`
> §3 (a regra de `src/core/` puro). Não tome decisão de arquitetura fora do que está documentado —
> se faltar algo, **pare e pergunte**.
>
> ### Estado atual
> O documento, os eixos aninhados, o versionamento, o diff de células (`src/core/diff/cells.ts`)
> e o resumo semântico (`src/core/diff/semantics.ts`) existem e são testados. Não existe nada de
> importação de matrizes: `src/core/import/` é pasta nova. `src/core/library/domain-import.ts`
> importa **domínios de variável** por colagem — é outro assunto, não reaproveite o parser dele
> (aquele é TSV tidy de domínios; este precisa de CSV com detecção de separador e aspas).
>
> ### Objetivo
> Dado um documento, o texto de um arquivo delimitado e um perfil de carga, produzir um
> `ImportPlan` que diz, matriz por matriz, se ela é nova, alterada (com o diff célula a célula),
> inalterada, estruturalmente divergente, ausente do arquivo ou bloqueada — sem tocar no
> documento.
>
> ### Escopo
>
> #### 1. `src/core/import/parse-table.ts`
> `parseDelimitedTable(text, format?)` conforme `docs/12-carga-de-matrizes.md` §5.4. Parser
> próprio, sem dependência nova: detecção de separador (`;` `,` TAB `|`) pela contagem de
> ocorrências na linha de cabeçalho, BOM, CRLF/LF, aspas duplas com escape `""`, células vazias.
> Erros e avisos como `ImportIssue` com **linha 1-based do arquivo original** e nome da coluna.
> Número de colunas diferente do cabeçalho é erro (`IMPORT_PARSE_ERROR`), não é tolerado.
>
> #### 2. `src/core/import/profile.ts`
> Tipos + schema Zod de `ImportProfile` e auxiliares (§5.4), mais `validateProfile(doc, profile)`
> devolvendo `ImportIssue[]` conforme I21/I22 (`docs/03-modelo-do-documento.md` §9). Inclui
> `normalizeValue(text)` — maiúsculas, sem acento, sem prefixo de ordenação (`a.RISCO BAIXO` →
> `RISCO_BAIXO`), espaço e pontuação viram `_`, resultado validado contra `^[A-Z0-9_]+$` — e
> `matchImportProfile(doc, header)` (igualdade exata do cabeçalho, RN-19).
>
> #### 3. `src/core/import/resolve.ts`
> `resolveImport(doc, table, profile)`: cada linha do arquivo, para cada opção do `unpivot`,
> produz um `ResolvedRow` com `matrixKey`, `xPath`, `yPath` e a `Cell` montada (oferta pelo
> `valueMap`, decisão pelas `decisionRules`, `attrs` quando o campo for `attr:*`). Aplica
> `CHECK` (aviso quando o valor difere do esperado) e `ignoredValues` (descarta a linha com
> aviso). Valor sem mapeamento vira `IMPORT_UNMAPPED_VALUE` com coluna, valor e primeira linha.
> Chave repetida: idêntica → aviso e conta uma vez; divergente → `IMPORT_DUPLICATE_KEY` (RN-08).
>
> #### 4. `src/core/import/plan.ts`
> `planImport(doc, table, profile, opts?)` → `ImportPlan` (§5.4 e §5.5). Para cada `matrixKey`:
> resolve código e nome pelos templates, encontra a matriz no projeto pelo código, e classifica
> em `NEW` / `CHANGED` / `UNCHANGED` / `STRUCTURAL` / `BLOCKED`; depois varre as matrizes do
> projeto que o arquivo não citou e as marca `ABSENT_IN_FILE`. O diff de células **reaproveita
> `src/core/diff/cells.ts` e `semantics.ts`** — não escreva comparação de célula nova. Respeite
> RN-06 (tupla desconhecida bloqueia a matriz inteira), RN-07 (`missingRowPolicy`), RN-09,
> RN-15 e **RN-21** (matriz nova: tupla de eixo sem nenhuma linha no arquivo entra em
> `manualSuppressions`; tupla parcialmente observada nunca é suprimida — DEC-CARGA-011).
> Calcule `planHash` (documento + arquivo + perfil) e `contentHash` com `hash.ts`.
>
> #### 5. `src/core/import/library-gaps.ts`
> `computeLibraryGaps(doc, table, profile)` → `LibraryGap[]`: domínios de eixo faltantes por
> variável (com rótulo original e cor sugerida por `suggestPaletteColors`), itens de catálogo
> faltantes por kind, e o mapa de compatibilidade deduzido dos pares adjacentes que aparecem no
> arquivo (`allow` no formato de `CompatibilityVersion`). **Só descreve o que falta — não aplica
> nada** (RN-17).
>
> #### 6. `src/core/import/hash.ts`
> FNV-1a de 64 bits em `BigInt`, puro, determinístico, sem `crypto.subtle` (é Web API, proibida
> em `core`). Normaliza antes de hashear: sem BOM, quebras em LF (RN-20).
>
> ### Testes
> `src/core/import/` exige **100% de cobertura**, como `axes/` e `versioning/`. Use como fixture
> um recorte real do `CINEMINHA_20260708.csv` (guarde em `tests/fixtures/` um recorte de ~200
> linhas cobrindo G1 com Restritivos, G4 com R21–R25 e G6 com HVI4 — não comite as 6.678 linhas)
> e um documento de teste com a biblioteca correspondente.
>
> Faça passar os cenários da página de funcionalidade: **CT-01** (idempotência), **CT-02** (só a
> alterada muda), **CT-03** (estrutura divergente), **CT-04** (combinação sem linha), **CT-05** e
> **CT-06** (chave duplicada divergente e idêntica), **CT-07** (valor não mapeado), **CT-08**
> (decisão derivada), **CT-09** (desdobramento em 6 canais), **CT-10** (rascunho aberto),
> **CT-16** (matriz nova nasce com as tuplas não observadas suprimidas e zero pendências).
> Além deles: separador detectado nos quatro formatos; arquivo com BOM e CRLF; aspas com
> separador dentro; linha com número errado de colunas; perfil inválido em cada regra de I21;
> `ABSENT_IN_FILE`; matriz nova cujo grid passa de 6.000 combinações (I16).
>
> Desempenho, medido em teste: `planImport` sobre a fixture completa (6.678 linhas × 6
> desdobramentos, 102 matrizes) em menos de 1 s.
>
> ### Critérios de aceite
> - `planImport` sobre o CSV real e um documento vazio classifica **102 matrizes como `NEW`** e
>   soma 40.068 células.
> - Aplicado o mesmo conteúdo a um documento onde ele já está publicado, **todas** as matrizes
>   voltam `UNCHANGED` e `totals.cellsChanged` é zero.
> - Alterar uma única célula do arquivo produz exatamente uma matriz `CHANGED` com uma alteração,
>   e o resumo semântico correto.
> - Nenhuma função deste módulo escreve no documento — teste que congela o documento de entrada
>   (`Object.freeze` profundo) e roda o plano inteiro sem erro.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, orçamento de 1,5 MB
>   respeitado, `dist/PolicyOps.html` atualizado.
>
> ### Fora do escopo
> Qualquer componente React, o comando `import/apply` (S24), a persistência do perfil no
> documento (S23), tags (S23) e a resolução de estrutura divergente (S25). O motor **detecta** a
> divergência e para aí.
>
> ### Atualização da documentação (obrigatório)
> Se algum contrato precisar mudar durante a implementação, atualize `docs/12-carga-de-matrizes.md`
> §5 no mesmo PR (a página descreve o sistema como ele fica **após** a sessão, sem adendos),
> registre a decisão em `docs/13-decisoes.md` como DEC-CARGA nova, e marque a linha da sessão 21
> em `docs/09-roadmap-de-entregas.md`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Sem dependência nova (`docs/02-arquitetura.md` §2).
> `src/core/` é TypeScript puro. Decisão não coberta pela documentação: **pare e pergunte**.
>
> ### Encerramento
> Commit descritivo na branch de trabalho, com `dist/PolicyOps.html` atualizado, e push.
