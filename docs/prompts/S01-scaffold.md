# Sessão 01 — Scaffold e infraestrutura

**Modelo recomendado: `Sonnet`**
**Depende de:** nada
**Marco:** base do projeto

---

## Prompt

> Você está implementando a Sessão 01 do Policy Matrix Studio.
>
> **Antes de escrever qualquer código, leia `docs/02-especificacao-tecnica.md` por inteiro.** Ele define a stack, a estrutura de pastas e as convenções, e é normativo: não substitua bibliotecas, não reorganize pastas, não "melhore" as escolhas. Se encontrar algo ambíguo ou uma decisão que a documentação não cobre, **pare e pergunte** em vez de decidir por conta própria.
>
> ### Objetivo
> Deixar o projeto rodando localmente com autenticação funcionando e CI verde. Nenhuma funcionalidade de domínio nesta sessão.
>
> ### Escopo
>
> 1. **Bootstrap do Next.js 15** com App Router, React 19, TypeScript `strict`, na raiz do repositório (não em subpasta). pnpm como gerenciador.
> 2. **Tailwind CSS v4** configurado, com tema claro/escuro via `next-themes` e a classe `dark` no `<html>`.
> 3. **shadcn/ui** inicializado. Instale só os componentes que esta sessão usa: `button`, `input`, `label`, `card`, `sonner` (toast), `dropdown-menu`, `avatar`, `separator`, `badge`.
> 4. **Prisma 6** instalado e configurado apontando para `DATABASE_URL`, com `prisma/schema.prisma` contendo **apenas** o `datasource`, o `generator` e o model `User` (conforme `docs/03-modelo-de-dados.md` — copie o model `User` literalmente, sem as relações com modelos que ainda não existem). O schema completo vem na Sessão 02.
> 5. **`docker-compose.yml`** com `postgres:16-alpine`, porta 5432, volume nomeado, credenciais `policyops/policyops/policyops`.
> 6. **`.env.example`** com as quatro variáveis da especificação §8. `.env` no `.gitignore`.
> 7. **Auth.js v5 (NextAuth)** com provider Credentials:
>    - `src/server/auth.ts` exportando `auth`, `signIn`, `signOut` e os handlers;
>    - senha com `bcryptjs` custo 12; sessão JWT de 8h; `role` no token e na sessão;
>    - `src/app/(auth)/login/page.tsx` com formulário (react-hook-form + zod), mensagens de erro em pt-BR;
>    - `middleware.ts` protegendo tudo exceto `/login`, `/api/auth/*` e `/api/health`;
>    - `requireRole(role)` em `src/server/auth.ts`, que lança `DomainError('FORBIDDEN')` — hierarquia VIEWER < EDITOR < ADMIN.
> 8. **`src/lib/errors.ts`** com a classe `DomainError` e o tipo `DomainErrorCode` contendo o catálogo completo de códigos de `docs/04-regras-de-negocio.md` §9. **`src/lib/error-messages.ts`** com a mensagem pt-BR de cada código.
> 9. **`withAction`** em `src/server/actions/with-action.ts`, implementando o formato `ActionResult<T>` de `docs/06-api.md`: captura `DomainError` e `ZodError` e devolve `{ ok: false, code, message }`. Nenhuma exceção pode vazar para o cliente.
> 10. **Shell da aplicação** em `src/app/(app)/layout.tsx`: sidebar esquerda de 240px (Projetos, Biblioteca, Templates, Vigência — links ainda sem destino real, marcados como em construção), header com nome do usuário, papel, toggle de tema e sair. Sidebar colapsável. Sem inspector ainda.
> 11. **`src/app/api/health/route.ts`** retornando `{ ok: true, db: 'up' | 'down' }` após um `SELECT 1`.
> 12. **Vitest** configurado (ambiente `node` para `tests/unit`, `jsdom` para componentes) e **Playwright** configurado usando o Chromium já instalado (`PLAYWRIGHT_BROWSERS_PATH` já está no ambiente — não rode `playwright install`). Um teste unitário de exemplo em `requireRole` e um E2E de login.
> 13. **Scripts no `package.json`**: `dev`, `build`, `start`, `lint`, `typecheck`, `test:unit`, `test:e2e`, `db:up`, `db:migrate`, `db:reset`, `db:seed`, `db:studio`.
> 14. **ESLint (flat config) + Prettier**, sem conflito entre eles.
> 15. **GitHub Actions** `.github/workflows/ci.yml`: job `checks` rodando lint → typecheck → test:unit → build, em Node 22, com pnpm em cache. Sem banco (nada nesta sessão depende dele em build time).
> 16. **`README.md`** substituindo o atual: o que é o projeto, como subir localmente em 5 comandos, links para os documentos em `docs/`, e a tabela de sessões de `docs/07-roadmap-de-entregas.md`.
> 17. **`CLAUDE.md`** na raiz, curto: aponta para os documentos normativos, repete as 7 regras de `docs/prompts/README.md` e lista os comandos do projeto.
>
> ### Critérios de aceite
> - `pnpm db:up && pnpm db:migrate && pnpm dev` sobe a aplicação em http://localhost:3000.
> - Acessar `/` sem sessão redireciona para `/login`.
> - Um usuário criado manualmente no banco consegue logar e ver o shell com seu nome e papel.
> - `/api/health` responde `{ ok: true, db: "up" }`.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` passam.
> - `pnpm test:e2e` passa o teste de login.
>
> ### Fora do escopo
> Qualquer model além de `User`. Qualquer tela de domínio. Seed (Sessão 02).
>
> ### Encerramento
> Commit descritivo e push na branch de trabalho.
