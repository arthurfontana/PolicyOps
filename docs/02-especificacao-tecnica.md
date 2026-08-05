# Especificação Técnica

> Este documento é normativo. Sessões de implementação devem seguí-lo literalmente e **não** tomar decisões de arquitetura por conta própria. Divergências devem ser levantadas ao usuário, não resolvidas silenciosamente.

## 1. Stack (decidida)

| Camada | Escolha | Justificativa |
|--------|---------|---------------|
| Runtime | Node.js 22 LTS | LTS atual |
| Framework | Next.js 15 (App Router) + React 19 | Full-stack num único deploy; Server Components para leitura, Server Actions para escrita |
| Linguagem | TypeScript, `strict: true` | — |
| Banco | PostgreSQL 16 | Relacional com JSONB para atributos extensíveis |
| ORM | Prisma 6 | Migrations versionadas, tipagem gerada |
| Estilo | Tailwind CSS v4 | — |
| Componentes | shadcn/ui (Radix) + lucide-react | Acessibilidade pronta |
| Estado do editor | Zustand | Store client-side com command stack para undo/redo |
| Validação | Zod | Schemas compartilhados entre form e server action |
| Formulários | react-hook-form + `@hookform/resolvers/zod` | — |
| Testes unitários | Vitest + Testing Library | — |
| Testes E2E | Playwright | Chromium já instalado no ambiente |
| Auth | Auth.js (NextAuth v5), provider Credentials | Simples, sem dependência externa no MVP |
| Gerenciador de pacotes | pnpm | — |
| Lint/format | ESLint (flat config) + Prettier | — |
| Dev DB | Docker Compose (postgres:16-alpine) | — |
| Deploy | Vercel + Neon (Postgres serverless) | — |

**Proibido no MVP** sem aprovação explícita: adicionar outro ORM, outro state manager global, GraphQL, microserviços, tRPC, biblioteca de grid de terceiros (AG Grid, Handsontable), canvas/WebGL para o editor.

## 2. Estrutura de pastas

```
/
├── docs/                          # esta documentação
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── app/
│   │   ├── (auth)/login/
│   │   ├── (app)/
│   │   │   ├── layout.tsx                 # shell: sidebar esquerda
│   │   │   ├── projects/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [projectId]/
│   │   │   │       ├── page.tsx
│   │   │   │       └── matrices/[matrixId]/
│   │   │   │           ├── page.tsx                     # redireciona p/ versão vigente
│   │   │   │           ├── versions/[versionId]/page.tsx # editor / viewer
│   │   │   │           ├── history/page.tsx
│   │   │   │           └── compare/page.tsx
│   │   │   ├── library/
│   │   │   │   ├── variables/
│   │   │   │   └── catalog/
│   │   │   ├── templates/
│   │   │   └── timeline/                  # consulta vigente por data
│   │   └── api/                           # Route Handlers (ver 06-api.md)
│   ├── components/
│   │   ├── ui/                            # shadcn
│   │   ├── editor/                        # grid, seleção, painel de propriedades
│   │   ├── library/
│   │   └── shared/
│   ├── server/
│   │   ├── db.ts                          # PrismaClient singleton
│   │   ├── auth.ts
│   │   ├── actions/                       # Server Actions (uma por caso de uso)
│   │   └── services/                      # regra de negócio pura, testável
│   │       ├── variable-service.ts
│   │       ├── catalog-service.ts
│   │       ├── matrix-service.ts
│   │       ├── version-service.ts         # criar rascunho, publicar, snapshot
│   │       ├── reconcile-service.ts       # evolução de variáveis
│   │       ├── diff-service.ts
│   │       └── timeline-service.ts
│   ├── lib/
│   │   ├── schemas/                       # Zod
│   │   ├── colors.ts
│   │   ├── errors.ts
│   │   └── utils.ts
│   ├── stores/
│   │   └── editor-store.ts
│   └── types/
├── tests/
│   ├── unit/
│   └── e2e/
├── docker-compose.yml
└── .env.example
```

### Regra arquitetural inegociável

**Toda regra de negócio vive em `src/server/services/` como função pura sobre o Prisma client.** Server Actions e Route Handlers apenas: autenticam → validam com Zod → chamam o service → revalidam cache. Nenhuma regra de versionamento, snapshot ou diff pode existir dentro de componente React ou de action.

## 3. Convenções

- **Nomes**: código e banco em inglês (`MatrixVersion`, `effectiveFrom`); textos de UI em pt-BR.
- **IDs**: `cuid2` (via `@paralleldrive/cuid2`), coluna `id String @id`.
- **Datas**: sempre `DateTime` em UTC no banco; formatação pt-BR na borda da UI.
- **Dinheiro**: `Decimal(14,2)`. Nunca `Float`.
- **Soft delete**: `archivedAt DateTime?`. Nada é apagado fisicamente exceto rascunhos descartados.
- **Erros**: services lançam `DomainError` (`src/lib/errors.ts`) com `code` estável (ex.: `VERSION_ALREADY_PUBLISHED`); a borda traduz para mensagem pt-BR.
- **Transações**: toda operação que toca mais de uma tabela usa `prisma.$transaction`.
- **Server Actions**: retornam `{ ok: true, data }` ou `{ ok: false, code, message }`. Nunca lançam para o cliente.

## 4. Autenticação e papéis

Auth.js v5, provider Credentials, senha com `bcryptjs` (custo 12), sessão JWT de 8h.

| Papel | Pode |
|-------|------|
| `VIEWER` | Ler tudo, comparar versões, exportar |
| `EDITOR` | Tudo do VIEWER + criar/editar rascunhos, publicar, gerenciar bibliotecas |
| `ADMIN` | Tudo do EDITOR + gerenciar usuários e arquivar projetos |

A verificação acontece em **duas camadas**: middleware (rota) e dentro de cada Server Action (`requireRole('EDITOR')`). Nunca só no cliente.

## 5. Desempenho — alvos

| Operação | Alvo |
|----------|------|
| Carregar editor de matriz 20×20 | < 800 ms (p95) |
| Aplicar edição em massa em 200 células | < 300 ms percebidos (otimista) + persistência assíncrona |
| Diff entre duas versões 40×40 | < 500 ms server-side |
| Consulta de vigência por data | < 200 ms |

Grid renderizado com CSS Grid e DOM puro. Virtualização só se a matriz passar de 40×40 — se isso ocorrer, parar e consultar o usuário.

## 6. Qualidade

- Cobertura mínima de testes unitários nos services: **80%**, com 100% em `version-service`, `diff-service` e `reconcile-service`.
- E2E cobrindo os fluxos: criar matriz → editar → publicar → editar de novo → comparar v1 × v2.
- CI (GitHub Actions): `lint` → `typecheck` → `test:unit` → `build`. E2E em job separado.
- Nenhum `any` sem comentário justificando. Nenhum `@ts-ignore`.

## 7. Acessibilidade e UX base

- Navegação completa por teclado no grid (setas, Shift+setas, Ctrl+A, Esc, Enter).
- Contraste AA em todas as cores de célula — a paleta em `src/lib/colors.ts` já garante isso; texto da célula alterna preto/branco pela luminância do fundo.
- Cor **nunca** é o único portador de informação: toda célula exibe também o rótulo curto da decisão.
- Tema claro e escuro.

## 8. Variáveis de ambiente

```
DATABASE_URL=postgresql://policyops:policyops@localhost:5432/policyops
AUTH_SECRET=<openssl rand -base64 32>
AUTH_URL=http://localhost:3000
NODE_ENV=development
```

`.env.example` deve ser commitado; `.env` nunca.
