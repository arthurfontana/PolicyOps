# Sessão 01 — Scaffold e build de arquivo único

**Modelo: `Sonnet`** · **Depende de:** nada

---

## Prompt

> Você está implementando a Sessão 01 do Policy Matrix Studio.
>
> **Antes de escrever código, leia `docs/02-arquitetura.md` por inteiro.** Ele é normativo: define a stack, a estrutura de pastas e as restrições do bundle. Não substitua bibliotecas, não reorganize pastas, não "melhore" as escolhas. Se algo estiver ambíguo, **pare e pergunte**.
>
> ### O que este produto é
> Um **único arquivo HTML autocontido** que roda no navegador sem instalar nada, colocado numa biblioteca do SharePoint. Sem servidor, sem banco, sem requisições de rede. Essa restrição comanda todas as decisões.
>
> ### Objetivo
> `pnpm build` produz `dist/PolicyOps.html`, que abre por duplo clique e mostra o shell da aplicação funcionando.
>
> ### Escopo
>
> 1. **Vite 6 + React 19 + TypeScript `strict`**, pnpm, na raiz do repositório.
> 2. **`vite-plugin-singlefile`** configurado para inlinar todo JS e CSS num único HTML. Sem code splitting, sem chunks, sem service worker.
> 3. **Verificação de orçamento**: script `check-size` que falha o build se `dist/PolicyOps.html` passar de **1 MB**. Rodar automaticamente depois de `build`.
> 4. **Verificação de auto-contenção**: script `check-selfcontained` que varre o HTML gerado e falha se encontrar `http://`, `https://`, `<script src=`, `<link rel="stylesheet" href=`, `@import url(`, `eval(` ou `new Function(`. Esta verificação é a garantia de que a página funciona offline dentro da rede corporativa — trate-a como teste, não como formalidade.
> 5. **Tailwind CSS v4** com tema claro/escuro (classe `dark` no `<html>`, preferência em `localStorage`, respeitando `prefers-color-scheme` na primeira visita). Fontes: **pilha do sistema**, nenhuma fonte web.
> 6. **Radix UI primitives** + os componentes base em `src/components/ui/`: `Button`, `Input`, `Label`, `Select`, `Dialog`, `Popover`, `Tooltip`, `Toast`, `Tabs`, `Badge`, `Card`, `Separator`, `Checkbox`, `Combobox`. Pode partir do código do shadcn/ui, copiando para dentro do projeto.
> 7. **`lucide-react`** para ícones, importando só o que usar.
> 8. **`src/core/errors.ts`** com `DomainError { code, message, details? }` e o tipo `DomainErrorCode` com o catálogo completo de `docs/05-regras-de-negocio.md` §9. **`src/core/error-messages.ts`** com a mensagem pt-BR de cada código, e um teste que percorre o enum e falha se faltar alguma.
> 9. **Identidade do usuário**: diálogo na primeira abertura pedindo o nome, guardado em `localStorage` (`policyops.actor`). Texto deixando claro que é identificação para o histórico, **não login**. `useActor()` expõe o valor e permite trocar.
> 10. **Shell** (`src/components/shell/`), conforme `docs/07-ux-e-editor.md` §2:
>     - sidebar esquerda de 248px com as seções (Projetos, Biblioteca › Variáveis/Compatibilidade/Conteúdo, Templates, Vigência, Rascunhos) — links ainda sem destino, marcados como em construção;
>     - área central;
>     - inspector direito de 340px;
>     - ambos colapsáveis com `[` e `]`;
>     - barra de status no rodapé com nome do arquivo (vazio por ora), estado de salvamento e o nome do usuário;
>     - toggle de tema.
> 11. **Roteamento**: sem biblioteca de rotas. A aplicação é uma SPA de arquivo único e usa **estado em `ui-store`** para navegação (`view: 'home' | 'matrix' | 'library' | …`), com a rota refletida no hash (`#/library/variables`) para permitir recarregar na mesma tela. `react-router` não é necessário e não deve ser adicionado.
> 12. **Tela inicial** provisória com os botões de `docs/07-ux-e-editor.md` §1 (Abrir, Recentes, Novo, Exemplo) — todos desabilitados, exceto o de tema. A faixa de modo (`FULL` / `DOWNLOAD_ONLY`) exibe "detecção na Sessão 05".
> 13. **Vitest** (jsdom para componentes, node para `core`) e **Playwright** apontando para o Chromium já instalado no ambiente (`PLAYWRIGHT_BROWSERS_PATH` já está configurado — **não rode `playwright install`**). O E2E deve abrir o `dist/PolicyOps.html` por **`file://`** e verificar que o shell renderiza — é o teste que prova a premissa central do produto.
> 14. **Scripts**: `dev`, `build`, `preview`, `lint`, `typecheck`, `test:unit`, `test:e2e`, `check-size`, `check-selfcontained`.
> 15. **ESLint flat config + Prettier**, sem conflito.
> 16. **CI** (`.github/workflows/ci.yml`), Node 22 com cache do pnpm: lint → typecheck → test:unit → build → check-size → check-selfcontained → test:e2e.
> 17. **`dist/PolicyOps.html` commitado** e `dist/` **removido do `.gitignore`** para esse arquivo. O usuário final baixa o artefato direto do GitHub, sem instalar Node.
> 18. **`README.md`**: o que é, como baixar o `.html` e usar no SharePoint, como desenvolver, e os links para `docs/`.
> 19. **`CLAUDE.md`** curto: documentos normativos, as 8 regras de `docs/prompts/README.md`, e os comandos do projeto.
>
> ### Critérios de aceite
> - `pnpm build` gera `dist/PolicyOps.html` com menos de 1 MB.
> - Abrir esse arquivo com **duplo clique** (protocolo `file://`) mostra o shell funcionando, com tema, sidebar colapsável e diálogo de identidade.
> - `check-selfcontained` passa: nenhuma referência externa no HTML.
> - `pnpm test:e2e` valida o cenário `file://`.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes.
>
> ### Fora do escopo
> Modelo do documento, persistência, qualquer tela de domínio.
>
> ### Encerramento
> Commit descritivo, com `dist/PolicyOps.html` incluído, e push.
