# Sessão 13 — Templates

**Modelo recomendado: `Sonnet`**
**Depende de:** S12

---

## Prompt

> Você está implementando a Sessão 13 do Policy Matrix Studio — templates de matriz.
>
> **Leia antes de começar:** `docs/04-regras-de-negocio.md` §8 (instanciação e `seedRules`), `docs/03-modelo-de-dados.md` (model `Template`) e `docs/05-ux-e-editor.md` §7.3.
>
> ### Objetivo
> Criar matrizes já configuradas, sem repetir trabalho: "Matriz padrão PF" nasce com eixos, cores e pré-preenchimento prontos.
>
> ### Escopo
>
> #### 1. `src/server/services/template-service.ts`
> - `listTemplates()`, `getTemplate(id)`, `createTemplate`, `updateTemplate`, `archiveTemplate`.
> - `previewTemplate(templateId)` → devolve o grid resultante **sem gravar nada**, usando as versões PUBLISHED atuais das variáveis do template.
> - `instantiateTemplate({ templateId, projectId, code, name })` conforme §8:
>   1. cria a matriz com `xVariableId`/`yVariableId` do template (reutilizando `createMatrix` da S03 — **não duplique a lógica de criação**);
>   2. aplica os defaults (`defaultDecisionItemId`, `defaultOfferItemId`, `defaultLimitItemId`) a todas as células;
>   3. aplica as `seedRules` **em ordem, a última vencendo**;
>   4. células cobertas por regra que defina decisão nascem com `isUnset = false`;
>   5. códigos inexistentes no snapshot são ignorados silenciosamente e devolvidos em `skippedRules` — a variável pode ter evoluído desde a criação do template;
>   6. evento `DRAFT_CREATED` com `templateCode` no payload.
>
> Formato das `seedRules` (JSON, validado com Zod tanto na escrita quanto na leitura, porque é um campo `Json`):
> ```json
> [
>   { "when": { "x": ["R1","R2"] },          "set": { "decisionCode": "APROVADO" } },
>   { "when": { "y": ["ALTO"] },             "set": { "decisionCode": "REPROVADO" } },
>   { "when": { "x": ["R1"], "y": ["SEM"] }, "set": { "offerCode": "OFERTA_PREMIUM" } }
> ]
> ```
> `when` sem `x` significa "todos os X"; idem para `y`. Um `when` vazio (`{}`) atinge todas as células — permitido e útil.
>
> #### 2. Actions
> `src/server/actions/template-actions.ts`, papel EDITOR (`archiveTemplate` pode ser EDITOR também).
>
> #### 3. UI — `/templates`
> - Lista com nome, descrição, eixos, nº de regras, quantas matrizes já foram criadas a partir dele.
> - **Editor de template** com preview ao vivo lado a lado:
>   - painel esquerdo: identificação, seleção das variáveis dos eixos, defaults, e o construtor de regras;
>   - construtor de regras: cada regra é uma linha com multi-select de domínios de X, multi-select de domínios de Y (ambos com opção "todos"), e os campos a definir; reordenável por drag (a ordem importa: a última vence);
>   - painel direito: **preview do grid** re-renderizado a cada alteração, mostrando o resultado exato da instanciação, com as células que ficariam `isUnset` hachuradas e um contador "18 de 24 células pré-preenchidas".
> - Botão "Criar template a partir desta matriz" na barra superior do editor: extrai eixos e defaults da versão atual e abre o editor de template já preenchido. As regras não são inferidas automaticamente — só os defaults e os eixos.
>
> #### 4. Integração com a criação de matriz
> O wizard da S06 ganha um passo zero: **"Começar do zero"** ou **"Usar um template"**. Escolhendo template, os eixos vêm preenchidos e bloqueados, e o passo 2 vira um resumo do que será criado. Se alguma `seedRule` for pulada, mostrar aviso após a criação: "3 regras do template não se aplicam mais porque os domínios mudaram" com a lista.
>
> #### 5. Seed
> Acrescente ao `prisma/seed.ts` dois templates: **"Matriz padrão PF"** (`SCORE_HVI3` × `RESTRITIVO`, com regras que aprovam R1/R2, reprovam Restritivo Alto e mandam o meio para análise manual) e **"Limite PJ"** (`FAIXA_RENDA` × `TEMPO_EMPRESA`, com defaults e uma regra). Mantenha o seed idempotente.
>
> #### 6. Testes
> - Regras aplicadas em ordem, com a última sobrescrevendo a anterior na mesma célula.
> - `when` sem `x` atinge todas as colunas; `when` vazio atinge tudo.
> - Código inexistente vai para `skippedRules` sem quebrar a instanciação.
> - Célula coberta por regra com decisão nasce `isUnset = false`; célula só com oferta continua `isUnset = true`.
> - `previewTemplate` não grava nada.
> - Instanciar usa a versão PUBLISHED atual das variáveis, não a de quando o template foi criado.
> - E2E: criar matriz a partir de "Matriz padrão PF" e ver o grid pré-preenchido.
>
> ### Critérios de aceite
> - Criar uma matriz a partir de "Matriz padrão PF" produz um grid com a maioria das células já preenchidas.
> - O preview no editor de template bate exatamente com o resultado da instanciação.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes.
>
> ### Fora do escopo
> Aplicar template a uma matriz já existente. Inferir regras a partir de uma matriz preenchida.
>
> ### Encerramento
> Commit descritivo e push.
