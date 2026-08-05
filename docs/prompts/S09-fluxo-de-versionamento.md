# Sessão 09 — Fluxo de versionamento na UI

**Modelo recomendado: `Sonnet`**
**Depende de:** S08

---

## Prompt

> Você está implementando a Sessão 09 do Policy Matrix Studio — o ciclo de vida das versões na interface.
>
> **Leia antes de começar:** `docs/04-regras-de-negocio.md` §1 e §7, e `docs/05-ux-e-editor.md` §2 (badges) e §8 (erros). Toda a lógica já existe nos services desde a S03 — esta sessão é **exclusivamente** interface e ligação. Não escreva regra de versionamento; se faltar algo no service, **pare e pergunte**.
>
> ### Objetivo
> Ligar os botões que ficaram desabilitados na S06: criar rascunho, publicar, descartar, e navegar pelo histórico com a trilha de auditoria.
>
> ### Escopo
>
> #### 1. Barra superior — ações reais
> Habilitadas conforme o estado da versão exibida:
>
> | Estado | Ações |
> |--------|-------|
> | DRAFT | Publicar · Descartar rascunho · Comparar com a vigente |
> | PUBLISHED vigente | Criar rascunho (ou "Abrir rascunho" se já existir) · Comparar · Exportar |
> | PUBLISHED agendada | idem, com badge de agendamento |
> | SUPERSEDED | Comparar · Exportar · "Restaurar como rascunho" |
>
> "Restaurar como rascunho" cria um rascunho novo clonando a versão histórica (use `createDraftFrom` com a versão base explícita — se o service só aceitar a publicada, **pare e pergunte** antes de mudá-lo).
>
> #### 2. Diálogo de publicação
> - Resumo do que será publicado: contagem de células alteradas em relação à versão vigente (use `diffVersions` se já existir; se não, contagem simples de células diferentes — a S10 substitui por resumo semântico).
> - Campo de notas da versão (changelog), obrigatório com mínimo de 10 caracteres.
> - Data de vigência: "imediatamente" (default) ou agendada para data futura. Datas passadas bloqueadas no próprio date picker.
> - Aviso literal: **"Publicar é definitivo. A versão publicada não pode ser editada, e o histórico de desfazer desta sessão será perdido."**
> - Confirmação exigindo digitar o número da versão.
>
> **Tratamento do erro `UNSET_CELLS_REMAIN`:** não mostre só um toast. Feche o diálogo, destaque as células pendentes no grid com pulso, mostre uma barra "12 células ainda não preenchidas" com botões "Ir para a primeira" e "Selecionar todas as pendentes". Este é o erro mais comum do fluxo e merece tratamento de primeira classe.
>
> #### 3. Diálogo de descarte
> Confirmação clara de que as alterações do rascunho serão perdidas, com a contagem de células editadas desde a criação. Explicar que o número da versão não será reutilizado.
>
> #### 4. Histórico — `/projects/[projectId]/matrices/[matrixId]/history`
> - Timeline vertical de todas as versões, da mais recente para a mais antiga.
> - Por versão: número, badge de estado, janela de vigência formatada em pt-BR, autor da criação e da publicação, notas, contagem de eventos.
> - Cada versão expande para a **trilha de auditoria**: lista de `MatrixVersionEvent` com ícone por tipo, `summary` em pt-BR, autor, timestamp relativo ("há 3 dias") com o absoluto no tooltip, e o payload em JSON colapsado para quem quiser o detalhe.
> - Por versão: links "Abrir", "Comparar com a vigente", "Restaurar como rascunho".
> - Filtro por tipo de evento e por autor.
>
> #### 5. Indicadores de rascunho
> - Badge "rascunho aberto" na lista de matrizes, na lista de projetos e na sidebar.
> - Uma tela `/drafts` listando todos os rascunhos abertos de todos os projetos, com autor e data — para o time saber o que está em andamento.
>
> #### 6. Testes
> - E2E do fluxo completo: abrir vigente → criar rascunho → editar 3 células → publicar → a nova vira vigente, a anterior aparece como histórico com a janela de vigência correta.
> - E2E do caminho de erro: criar matriz nova (todas as células `isUnset`) → tentar publicar → ver a barra de pendências e o destaque no grid.
> - E2E de descarte: criar rascunho → descartar → criar outro → o número de versão pulou.
> - Componente: os botões corretos aparecem para cada um dos quatro estados.
>
> ### Critérios de aceite
> - O ciclo completo funciona no navegador sem tocar no banco manualmente.
> - Publicar com pendências dá um erro compreensível e acionável, não uma mensagem técnica.
> - O histórico mostra quem fez o quê e quando, com frases legíveis em português.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes.
>
> ### Fora do escopo
> Comparação visual (S10) e vigência por data (S11) — apenas deixe os links prontos apontando para rotas que a próxima sessão implementa.
>
> ### Encerramento
> Commit descritivo e push.
