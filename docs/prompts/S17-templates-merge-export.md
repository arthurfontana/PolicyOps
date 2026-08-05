# Sessão 17 — Templates, merge, export e polimento

**Modelo: `Opus`** (partes A e C podem ser `Sonnet` se rodadas isoladas) · **Depende de:** S16 · **Marco M5**

---

> Esta sessão acumula três frentes independentes. **Se ficar grande, rode como três conversas separadas** — cada parte abaixo tem critérios de aceite próprios e pode ser commitada sozinha.
>
> - **Parte A — Templates** · `Sonnet`
> - **Parte B — Merge de documentos** · `Opus`
> - **Parte C — Export e polimento** · `Haiku`

---

## Parte A — Templates

**Modelo: `Sonnet`**

> Você está implementando a Parte A da Sessão 17 do Policy Matrix Studio — templates.
>
> **Leia antes de começar:** `docs/05-regras-de-negocio.md` §8, `docs/03-modelo-do-documento.md` §7 e `docs/07-ux-e-editor.md` §11 (bloco Templates).
>
> ### Escopo
>
> **Comandos** — `src/core/templates/`: `template/create`, `template/update`, `template/archive`, `template/instantiate`, mais `previewTemplate(doc, templateId)` que devolve o grid resultante **sem gravar nada**.
>
> `instantiateTemplate` conforme §8:
> 1. resolve as variáveis dos níveis e usa as versões **publicadas atuais** — não as de quando o template foi criado;
> 2. reutiliza `matrix/create` (**não duplique a lógica de criação**);
> 3. aplica `defaults` a todas as combinações;
> 4. aplica `seedRules` em ordem, **a última vencendo**;
> 5. códigos inexistentes vão para `skippedRules` sem quebrar.
>
> `PathMatcher` casa por nível, com `null` = qualquer: `["VAREJO", null]` pega todas as faixas do Varejo. Matcher mais curto que o caminho casa por **prefixo**. `when` vazio atinge tudo. Valide com Zod na leitura e na escrita.
>
> **Interface**: lista de templates; editor com o `axis-builder` da S09 e um construtor de regras (cada regra é uma linha com seletores de caminho por nível, reordenável por drag, a última vencendo), com **preview ao vivo** do grid resultante e contador "38 de 48 combinações pré-preenchidas". Botão "Criar template a partir desta matriz" no editor, extraindo eixos e defaults (regras não são inferidas).
>
> **Integração com a criação de matriz**: o wizard da S09 ganha um passo zero — "Começar do zero" ou "Usar um template". Com template, os eixos vêm preenchidos e bloqueados. Regras puladas viram aviso após a criação.
>
> **Documento de exemplo**: acrescente "Matriz padrão PF" (`SCORE_HVI3` × `RESTRITIVO`) e "Limite PJ segmentado" (`SCORE_HVI3` × `SEGMENTO › FAT`, com regras por segmento).
>
> ### Testes
> - Regras aplicadas em ordem, a última sobrescrevendo na mesma célula.
> - `PathMatcher` com `null` em cada posição; matcher de prefixo em eixo de 2 níveis.
> - Código inexistente vai para `skippedRules` sem quebrar.
> - Célula coberta por regra com decisão nasce preenchida; só com oferta continua pendente.
> - `previewTemplate` não grava nada.
> - Instanciar usa a versão publicada **atual** das variáveis.
> - E2E: criar matriz a partir de "Limite PJ segmentado" e ver o grid aninhado pré-preenchido.
>
> ### Critérios de aceite
> - O preview no editor bate exatamente com o resultado da instanciação.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, tamanho no orçamento.

---

## Parte B — Merge de documentos

**Modelo: `Opus`**

> **Por que Opus:** é a última linha de defesa contra perda de trabalho. Duas pessoas editaram o mesmo arquivo do SharePoint; o merge decide o que sobrevive. Errar aqui apaga o trabalho de alguém em silêncio.

> Você está implementando a Parte B da Sessão 17 — merge de documentos.
>
> **Leia antes de começar:** `docs/06-persistencia-e-concorrencia.md` §5 e §7 por inteiro.
>
> ### O que torna isso tratável
> O modelo foi desenhado para isso: versões publicadas são **imutáveis e identificadas por `(matrixId, number)`**, e quase tudo é append-only. União resolve a maior parte.
>
> ### Escopo
>
> `src/core/merge/`:
> ```ts
> mergeDocuments(mine, theirs): {
>   merged: PolicyOpsDocument;
>   applied: MergeAction[];
>   conflicts: MergeConflict[];
> }
> ```
>
> Implemente **as duas tabelas de §7**, literalmente. Resolvidos automaticamente: versão publicada só de um lado, item de biblioteca novo só de um lado, projeto/matriz nova só de um lado, eventos (união ordenada por `at`, deduplicada por `id`), item inalterado de um lado.
>
> Conflitos que exigem decisão: rascunhos diferentes da mesma matriz, mesmo `number` publicado com conteúdo diferente (caso grave — renumera o perdedor e sinaliza), mesmo item de biblioteca editado dos dois lados, mesmo `code` criado do zero para entidades diferentes.
>
> **Nada é mesclado sem o usuário ver.** A tela lista tudo que será aplicado automaticamente e pede decisão só nos conflitos, com preview de cada lado usando a tela de comparação da S14 quando forem versões de matriz. O resultado gera evento `DOCUMENT_MERGED`.
>
> Ligue à opção "Mesclar" do diálogo de conflito que a S05 deixou desabilitada.
>
> ### Testes
> - Cada linha das duas tabelas de §7, com fixture própria.
> - Merge sem conflito é **determinístico e comutativo** quanto ao conteúdo: `merge(a,b)` e `merge(b,a)` produzem o mesmo documento.
> - O documento resultante passa em `validateDocument` sem erros — sempre, em todos os cenários.
> - Nenhuma versão publicada é perdida em nenhum cenário — teste explícito contando versões antes e depois.
> - Cenário realista: duas pessoas partem da revisão 40; uma publica a v13 de uma matriz, a outra edita um rascunho de outra matriz e cria uma variável. O merge preserva tudo, sem conflito.
> - E2E: abrir documento, editar, simular arquivo remoto alterado, salvar, escolher mesclar, revisar e confirmar.
>
> ### Critérios de aceite
> - Nenhum cenário de teste perde versão publicada.
> - O merge sempre produz documento válido.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes.

---

## Parte C — Export e polimento

**Modelo: `Haiku`**

> Você está implementando a Parte C da Sessão 17 — exportação e acabamento.
>
> **Leia antes de começar:** `docs/08-camada-de-comandos.md` §5 (formatos canônicos) e `docs/07-ux-e-editor.md` §12 e §13. **Não altere regra de negócio nesta parte**; se encontrar um bug de domínio, **relate ao usuário** em vez de corrigir — pode haver invariante em jogo.
>
> ### Escopo
>
> **Exportação** — `src/core/export/`:
> - **JSON canônico** conforme §5, com `schemaVersion: 1` e decimais como string.
> - **CSV**: uma linha por combinação, com **uma coluna por nível de cada eixo** (`x_SCORE_HVI3;y_SEGMENTO;y_FAT;decisao;…`) — é o que torna o arquivo utilizável numa tabela dinâmica. Separador `;`, decimal com vírgula, UTF-8 **com BOM** (sem isso o Excel em português abre errado). Nome: `{matrixCode}_v{n}_{aaaammdd}.csv`.
> - **CSV do diff**: `caminho_x;caminho_y;campo;antes;depois;tipo`.
> - **PNG**: `html-to-image` sobre o nó do grid, escala 2×, incluindo título, número da versão, vigência e legenda — a imagem vai virar slide de comitê e precisa se explicar sozinha.
> - **Impressão**: folha de estilo `@media print` com o grid em paisagem, cabeçalhos repetidos por página e rodapé com matriz, versão e data.
> - Menu "Exportar" unificado no editor, na comparação e na tela de vigência.
>
> **Polimento**:
> - estados vazios em **todas** as listas, com ação primária;
> - skeletons de carregamento, incluindo o do grid com as dimensões corretas;
> - `ErrorBoundary` por região, com botão de recarregar e opção de exportar diagnóstico;
> - teste que percorre `DomainErrorCode` e falha se faltar mensagem pt-BR; nenhum código cru na interface;
> - formatação: datas pt-BR, valores em BRL, tempo relativo, separador de milhar;
> - acessibilidade: rodar `axe` no editor e nas listas principais e corrigir o que aparecer; foco visível; `aria-label` em todo botão só-ícone;
> - tema escuro revisado em todas as telas — grid, swatches, marcas de diff e miniaturas;
> - diálogo de atalhos com `?`;
> - título da aba refletindo o documento e a matriz abertos; favicon próprio (SVG inline, sem arquivo externo).
>
> **Documentação final**:
> - `README.md` com capturas de tela, guia de 5 minutos e instruções de publicação no SharePoint;
> - `docs/10-guia-do-usuario.md` em pt-BR para o time de política: glossário (matriz, versão, vigência, snapshot, pin, tupla, nível), como criar a primeira matriz, como aninhar eixos, como versionar, como comparar, e a explicação em linguagem simples de por que publicar uma variável não muda matrizes publicadas;
> - `docs/11-operacao.md`: onde colocar os arquivos, como fazer backup, o que fazer no conflito, como atualizar o `PolicyOps.html` sem perder dados, e o que responder quando alguém pedir alteração retroativa (resposta: não se altera o passado; cria-se versão nova).
>
> ### Suíte E2E consolidada
> Reorganize `tests/e2e/` em cenários independentes:
> 1. ciclo de vida completo, do documento vazio à segunda publicação;
> 2. eixo aninhado: criar `SEGMENTO › FAT × SCORE`, preencher por cabeçalho, publicar;
> 3. edição em massa com undo/redo;
> 4. evolução da biblioteca e reconciliação;
> 5. template instanciado;
> 6. conflito de salvamento e merge;
> 7. exportação de CSV e JSON, com validação do conteúdo.
>
> ### Critérios de aceite
> - Os 7 cenários E2E passam.
> - Nenhuma tela mostra código de erro cru, estado vazio sem tratamento ou texto em inglês.
> - CSV abre corretamente no Excel em português, com uma coluna por nível.
> - PNG exportado é legível e se explica sozinho.
> - Cobertura de `src/core/` ≥ 85%, com 100% em `axes/`, `versioning/` e `reconcile/`.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes, tamanho no orçamento.
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push. **MVP completo.**
