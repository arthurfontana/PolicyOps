# Sessão 45 — Limite em faixa (mínimo/máximo)

**Modelo:** `Sonnet` · **Depende de:** S12 (grid), S22 (import de matrizes) · **Épico/Marco:** Editor

> **Por que Sonnet:** um campo novo em `Cell`, um seletor na UI existente do inspector, e um papel
> novo de coluna no import — sem invariante estrutural nova, sem eixo, sem tupla.

## Contexto

A carga de políticas de crédito no formato NMEI (`docs/prompts/README.md` §exemplos — planilha
`SMALL_NMEI.xlsx`) tem, por célula, um **limite de crédito em faixa** ("500 a 5K", não um valor
único). Hoje `Cell.limit` só referencia um item de catálogo (`kind: 'LIMIT'`, valor único via
`numericValue`) e `limitOverride` é um decimal único — não existe modo de faixa. A tentativa de
forçar uma faixa pelo import atual gera um item de catálogo por valor único observado (`"500"`,
`"230"`, `"7500"`...), o que é errado: cada célula devia guardar seu **próprio** mínimo e máximo,
não apontar para um catálogo compartilhado.

## Objetivo

O usuário registra e visualiza, por célula, um mínimo e um máximo de limite — do mesmo jeito que
já opera hoje em planilhas como a `SMALL_NMEI.xlsx` — sem precisar de catálogo.

## Escopo

1. **Schema** (`docs/03-modelo-do-documento.md` §6.2): dois campos novos e opcionais em `Cell`,
   `limitMin?: string` e `limitMax?: string` (decimais como string, mesma convenção de
   `rangeMin`/`rangeMax` em `Domain`). Não removem nem substituem `limit`/`limitOverride` — é um
   modo alternativo, mutuamente exclusivo na UI, coexistente no schema (uma célula não deveria
   preencher os dois modos ao mesmo tempo; valide e avise, não bloqueie).
2. **Inspector** (`docs/07-ux-e-editor.md`, seção do componente de Limite): seletor **"Valor
   único"** (o que já existe) vs **"Faixa (mín/máx)"** — dois campos numéricos livres substituindo
   o dropdown de catálogo quando esse modo está ativo. Grid mostra a faixa formatada
   (`lib/format.ts`) na célula, no padrão visual do valor único atual.
3. **Import de matrizes** (`docs/12-carga-de-matrizes.md` §`ColumnMapping.value.field`): dois
   valores novos de campo, `'limitMin'` e `'limitMax'`, ao lado dos já existentes
   (`offer/limit/note/attr:*`) — grava direto nos campos novos do `Cell`, sem criar catálogo.
4. **Export** (`src/core/export/`): os dois campos entram no JSON/CSV canônico como qualquer outro
   campo de célula.

## Fora de escopo

Migração de dados existentes que hoje simulam faixa via `attrs.limiteMin`/`attrs.limiteMax`
(gambiarra usada antes desta sessão existir) — se houver documentos reais nesse estado, tratar
como sessão de migração à parte, não misturar aqui.

## Testes

- `src/core/document/` — schema aceita os dois campos novos, célula sem nenhum modo preenchido
  continua `isUnset`.
- `src/core/import/` — perfil com coluna mapeada para `limitMin`/`limitMax` grava direto na
  célula, sem tocar no catálogo.
- Componente do inspector — alternância entre os dois modos, sem perda de dado ao trocar e voltar
  dentro da mesma sessão de edição (antes de salvar).

## Critérios de aceite

- `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, `dist/PolicyOps.html`
  atualizado no commit.
- Uma matriz no formato `SMALL_NMEI.xlsx` (faixa de limite por célula) importa e exibe a faixa sem
  precisar de nenhum item de catálogo criado à força.
