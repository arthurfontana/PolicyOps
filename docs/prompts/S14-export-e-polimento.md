# Sessão 14 — Exportação, polimento e E2E

**Modelo recomendado: `Haiku`**
**Depende de:** S13
**Marco:** M4 — MVP completo

---

> **Por que Haiku:** trabalho mecânico de acabamento sobre uma base já pronta. Formatos, estados vazios, acessibilidade e cobertura de testes — nada que exija decisão de arquitetura.

## Prompt

> Você está implementando a Sessão 14 do Policy Matrix Studio — a última do MVP.
>
> **Leia antes de começar:** `docs/06-api.md` §4 e §5 (rotas de export e formato canônico) e `docs/05-ux-e-editor.md` §8 e §9 (estados vazios e paleta). Não altere regra de negócio nesta sessão; se encontrar um bug de domínio, **relate ao usuário** em vez de corrigir por conta própria — pode haver invariante em jogo.
>
> ### Objetivo
> Fechar o MVP: exportar, arredondar as pontas soltas e garantir a suíte E2E dos fluxos principais.
>
> ### Escopo
>
> #### 1. Exportação
> - `GET /api/versions/[versionId]/export?format=csv` — uma linha por célula: `x_code, x_label, y_code, y_label, decisao, oferta, limite_codigo, limite_valor, cor, observacao`. Separador `;` e encoding UTF-8 com BOM (para o Excel em português abrir corretamente). Nome do arquivo: `{matrixCode}_v{n}_{yyyymmdd}.csv`.
> - `GET /api/versions/[versionId]/export?format=json` — o formato canônico de `docs/06-api.md` §5, exatamente como especificado, com `schemaVersion: 1` e decimais como string.
> - `GET /api/compare/export?a=&b=&format=csv` — a lista de mudanças do diff: `coordenada, campo, antes, depois, tipo`.
> - **PNG no cliente**: botão "Exportar imagem" no editor, usando `html-to-image` sobre o nó do grid (única dependência nova autorizada nesta sessão). Incluir título, número da versão, vigência e legenda na imagem exportada — ela vai virar slide de comitê, precisa se explicar sozinha. Escala 2× para nitidez.
> - Menu "Exportar" unificado na barra superior do editor e na tela de comparação.
> - Todas as rotas exigem sessão autenticada.
>
> #### 2. Polimento
> - **Estados vazios** em todas as listas (projetos, matrizes, variáveis, catálogo, templates, rascunhos, histórico), cada um com ilustração simples, texto explicativo e ação primária.
> - **Estados de carregamento**: `loading.tsx` com skeletons em todas as rotas; skeleton do grid com as dimensões corretas.
> - **`error.tsx`** por segmento de rota, com botão de tentar novamente.
> - **`not-found.tsx`** para projeto/matriz/versão inexistentes.
> - **Mensagens de erro**: confirme que todos os códigos de `docs/04-regras-de-negocio.md` §9 têm mensagem pt-BR em `src/lib/error-messages.ts` e que nenhum código cru aparece na interface. Escreva um teste que percorra o enum e falhe se faltar mensagem.
> - **Formatação**: datas em pt-BR, valores em BRL, tempos relativos ("há 3 dias"), números com separador de milhar.
> - **Acessibilidade**: passe o eixo do editor e as listas principais no `axe`; corrija o que aparecer. Foco visível em todos os interativos. `aria-label` em todos os botões só-ícone.
> - **Tema escuro**: revise todas as telas; o grid, os swatches e as marcas de diff precisam funcionar nos dois temas.
> - **Atalhos**: diálogo de ajuda com `?` listando todos os atalhos de teclado.
> - **Meta e favicon**: título por rota, favicon próprio.
>
> #### 3. Suíte E2E consolidada
> Reorganize `tests/e2e/` em cenários completos, cada um independente e com seed próprio:
> 1. **Ciclo de vida**: login → criar projeto → criar variáveis → criar matriz → preencher → publicar → editar → publicar de novo → comparar → consultar por data.
> 2. **Edição em massa**: marquee de 50 células → atribuir oferta → desfazer → refazer.
> 3. **Evolução de variável**: adicionar domínio → publicar variável → reconciliar rascunho → preencher → publicar.
> 4. **Template**: criar template → instanciar → verificar pré-preenchimento.
> 5. **Permissões**: VIEWER não vê botões de edição e recebe erro ao chamar a action diretamente.
> 6. **Exportação**: baixar CSV e JSON e validar o conteúdo.
>
> #### 4. Documentação final
> - `README.md`: screenshots, guia de 5 minutos, deploy no Vercel + Neon, variáveis de ambiente.
> - `docs/08-guia-do-usuario.md`: guia em pt-BR para o time de política — glossário (matriz, versão, vigência, snapshot, pin), como criar a primeira matriz, como versionar, como comparar, e a explicação em linguagem simples de por que publicar uma variável não muda matrizes publicadas.
> - `docs/09-operacao.md`: backup, restore, migrations em produção, e o que fazer quando alguém pede uma alteração retroativa (resposta: não se altera o passado; cria-se uma versão nova).
>
> #### 5. Testes
> - Export CSV com célula contendo `;` e aspas é escapado corretamente.
> - Export JSON valida contra o schema canônico com Zod.
> - Teste que garante mensagem pt-BR para todo `DomainErrorCode`.
> - Cobertura global de services ≥ 80%; `version-service`, `cell-service`, `diff-service` e `reconcile-service` em 100%.
>
> ### Critérios de aceite
> - Os 6 cenários E2E passam.
> - Nenhuma tela mostra código de erro cru, estado vazio sem tratamento ou texto em inglês.
> - CSV abre corretamente no Excel em português.
> - PNG exportado é legível e se explica sozinho.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes.
>
> ### Encerramento
> Commit descritivo e push. **MVP completo.**
