# Sessão 05 — Biblioteca de Conteúdo (catálogo)

**Modelo recomendado: `Haiku`**
**Depende de:** S03
**Marco:** M1

---

> **Por que Haiku:** CRUD simples sobre uma única tabela, com contrato, telas e regras já totalmente especificados. Não há decisão a tomar.

## Prompt

> Você está implementando a Sessão 05 do Policy Matrix Studio — a Biblioteca de Conteúdo.
>
> **Leia antes de começar:** `docs/05-ux-e-editor.md` §7.2, `docs/06-api.md` §1 (seção Catálogo) e `docs/04-regras-de-negocio.md` §4.5 (por que catálogo é referência viva, não snapshot). Siga a especificação literalmente; se faltar algo, **pare e pergunte** em vez de decidir.
>
> ### Objetivo
> Gerenciar os itens reutilizáveis das células: Ofertas, Decisões, Limites e Tags.
>
> ### Escopo
>
> #### 1. `src/server/services/catalog-service.ts`
> - `listCatalog({ kind?, includeArchived? })` — ordenado por `position`, com contagem de uso (quantas células referenciam cada item, separando versões vigentes de rascunhos).
> - `createCatalogItem({ kind, code, label, description?, color?, numericValue? })`
>   - `code` formato `^[A-Z0-9_]+$`, único dentro do `kind` → `DUPLICATE_CODE`;
>   - `kind = LIMIT` exige `numericValue` não nulo e positivo → `LIMIT_NEEDS_NUMERIC_VALUE` (invariante I7);
>   - `color` no formato `^#[0-9A-Fa-f]{6}$` quando informado;
>   - `position` = último + 1 dentro do kind.
> - `updateCatalogItem({ id, label?, description?, color?, numericValue?, position? })` — `code` e `kind` são **imutáveis** após a criação.
> - `archiveCatalogItem(id)` — soft delete. Item arquivado continua visível nas células que já o usam, mas não pode ser atribuído a novas.
> - `reorderCatalogItems({ kind, orderedIds })` — reatribui `position` numa transação.
>
> #### 2. Actions
> `src/server/actions/catalog-actions.ts`, todas com papel EDITOR, no formato padrão (`withAction` → `requireRole` → Zod → service → `revalidatePath`).
>
> #### 3. UI — `/library/catalog`
> - Abas por `kind`: Decisões / Ofertas / Limites / Tags.
> - Tabela com colunas: cor (swatch), código, rótulo, descrição, valor (só em Limites, formatado em BRL), uso, ações.
> - Criação e edição em `Dialog` com react-hook-form + zod, reaproveitando os schemas de `src/lib/schemas/`.
> - Reordenação por drag (`@dnd-kit/sortable`, já instalado na S04).
> - Toggle "mostrar arquivados"; itens arquivados aparecem esmaecidos com badge.
> - Ao editar o rótulo de um item que está em uso, mostrar no diálogo o aviso literal:
>   > Renomear altera a exibição em **todas** as versões, inclusive históricas. Se o significado mudou, crie um item novo.
> - Estados vazios com ação primária por aba.
>
> #### 4. Testes
> - Criar LIMIT sem `numericValue` falha com `LIMIT_NEEDS_NUMERIC_VALUE`.
> - Código duplicado dentro do mesmo kind falha; o mesmo código em kinds diferentes é permitido.
> - Cor inválida é rejeitada.
> - Arquivar um item em uso não quebra a leitura das células que o referenciam.
> - `reorderCatalogItems` produz posições 0..n-1 sem buracos.
>
> ### Critérios de aceite
> - As quatro abas listam corretamente os itens do seed.
> - Criar "Oferta 8" e ela fica disponível para uso nas células.
> - Arquivar "Oferta 3" a remove dos seletores de novas atribuições, mas ela segue exibida onde já estava.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes.
>
> ### Fora do escopo
> Qualquer coisa de matriz ou de editor. Não altere serviços de versionamento.
>
> ### Encerramento
> Commit descritivo e push.
