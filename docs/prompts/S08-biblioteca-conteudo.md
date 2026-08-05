# Sessão 08 — Biblioteca de Conteúdo (catálogo)

**Modelo: `Haiku`** · **Depende de:** S04 · **Marco M2**

---

> **Por que Haiku:** CRUD sobre uma entidade única, com contrato, telas e regras totalmente especificados. Não há decisão a tomar.

## Prompt

> Você está implementando a Sessão 08 do Policy Matrix Studio — a Biblioteca de Conteúdo.
>
> **Leia antes de começar:** `docs/03-modelo-do-documento.md` §4, `docs/07-ux-e-editor.md` §11 (bloco Conteúdo), `docs/08-camada-de-comandos.md` §3 (comandos de catálogo) e `docs/05-regras-de-negocio.md` §5.5 (por que catálogo é referência viva, não snapshot). Siga literalmente; se faltar algo, **pare e pergunte** em vez de decidir.
>
> ### Objetivo
> Gerenciar os itens reutilizáveis das células: Decisões, Ofertas, Limites e Tags.
>
> ### Escopo
>
> #### 1. Comandos — `src/core/library/catalog.ts`
> Quatro comandos, no contrato de comando da S04 (puro, imutável, inversível, valida antes, registra evento `CATALOG_CHANGED`):
>
> - **`catalog/create`** `{ kind, code, label, description?, color?, numericValue? }`
>   - `code` casa `^[A-Z0-9_]+$` e é único **dentro do kind** → `DUPLICATE_CODE`;
>   - `kind = 'LIMIT'` exige `numericValue` não nulo e positivo → `LIMIT_NEEDS_NUMERIC_VALUE` (I7);
>   - `color` casa `^#[0-9A-Fa-f]{6}$` quando informado;
>   - `position` = último + 1 dentro do kind.
> - **`catalog/update`** `{ id, label?, description?, color?, numericValue? }` — `code` e `kind` são **imutáveis** após a criação.
> - **`catalog/archive`** `{ id }` — soft delete (`archivedAt`). Item arquivado continua visível nas células que já o usam, mas não pode ser atribuído a novas.
> - **`catalog/reorder`** `{ kind, orderedIds }` — reatribui `position` como 0..n-1, sem buracos.
>
> #### 2. Consultas
> `listCatalog(doc, { kind?, includeArchived? })` ordenado por `position`, com contagem de uso: quantas células referenciam cada item, separando versões vigentes de rascunhos.
>
> #### 3. Interface — `/library/catalog`
> - Abas por kind: **Decisões · Ofertas · Limites · Tags**.
> - Tabela com: swatch de cor, código, rótulo, descrição, valor (só em Limites, formatado em BRL), uso, ações.
> - Criar e editar em `Dialog`, com validação em tempo real e mensagens em pt-BR.
> - Reordenação por drag (`@dnd-kit/sortable`, já instalado na S06).
> - Toggle "mostrar arquivados"; arquivados aparecem esmaecidos com badge.
> - Ao editar o rótulo de um item **em uso**, mostrar no diálogo o aviso literal:
>   > Renomear altera a exibição em **todas** as versões, inclusive históricas. Se o significado mudou, crie um item novo.
> - Estados vazios com ação primária por aba.
>
> ### Testes
> - Criar LIMIT sem `numericValue` falha com `LIMIT_NEEDS_NUMERIC_VALUE`; com valor negativo também.
> - Código duplicado no mesmo kind falha; o mesmo código em kinds diferentes passa.
> - Cor inválida é rejeitada.
> - Tentar alterar `code` ou `kind` num update é rejeitado.
> - Arquivar item em uso não quebra a leitura das células que o referenciam.
> - `catalog/reorder` produz posições 0..n-1 sem buracos.
> - Inverso de cada comando restaura o estado anterior (round-trip deep-equal).
> - Componente: as quatro abas listam os itens do documento de exemplo corretamente.
>
> ### Critérios de aceite
> - Criar "Oferta 8" e ela fica disponível para uso nas células.
> - Arquivar "Oferta 3" a remove dos seletores de novas atribuições, mas ela segue exibida onde já estava.
> - Limites aparecem formatados em BRL.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, tamanho no orçamento.
>
> ### Fora do escopo
> Qualquer coisa de matriz ou de editor. Não altere comandos de versionamento nem o motor de eixos.
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push. **Marco M2**: as bibliotecas estão completas e o time já pode cadastrar as variáveis, compatibilidades e ofertas reais.
