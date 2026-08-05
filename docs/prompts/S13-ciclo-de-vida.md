# Sessão 13 — Ciclo de vida e histórico

**Modelo: `Sonnet`** · **Depende de:** S11

---

## Prompt

> Você está implementando a Sessão 13 do Policy Matrix Studio — o ciclo de vida das versões na interface.
>
> **Leia antes de começar:** `docs/05-regras-de-negocio.md` §1 e §7, e `docs/07-ux-e-editor.md` §3 e §12. Toda a lógica **já existe** nos comandos desde a S04 — esta sessão é exclusivamente interface e ligação. Não escreva regra de versionamento; se faltar algo no comando, **pare e pergunte**.
>
> ### Objetivo
> Ligar os botões que ficaram desabilitados na S09: criar rascunho, publicar, descartar, e navegar pelo histórico com a trilha de auditoria.
>
> ### Escopo
>
> #### 1. Barra superior — ações reais
>
> | Estado | Ações |
> |---|---|
> | DRAFT | Publicar · Descartar rascunho · Comparar com a vigente |
> | PUBLISHED vigente | Criar rascunho (ou "Abrir rascunho" se já existir) · Comparar · Exportar |
> | PUBLISHED agendada | idem, com badge de agendamento |
> | SUPERSEDED | Comparar · Exportar · **Restaurar como rascunho** |
>
> "Restaurar como rascunho" usa `version/createDraft` com `baseVersionId` explícito — o comando já aceita isso desde a S04.
>
> #### 2. Diálogo de publicação
> - Resumo do que será publicado: contagem de células alteradas em relação à vigente (contagem simples por ora; a S14 substitui pelo resumo semântico).
> - Campo de notas obrigatório, mínimo 10 caracteres (`NOTES_REQUIRED`).
> - Vigência: "imediatamente" (padrão) ou agendada para data futura. Datas passadas bloqueadas no próprio seletor.
> - Aviso literal: **"Publicar é definitivo. A versão publicada não pode ser editada, e o histórico de desfazer desta sessão será perdido."**
> - Confirmação exigindo digitar o número da versão.
>
> **Tratamento de `UNSET_CELLS_REMAIN`:** não é um toast. Feche o diálogo, destaque as combinações pendentes no grid com pulso, e mostre uma barra dedicada: *"12 combinações ainda não preenchidas"* com botões "Ir para a primeira" e "Selecionar todas as pendentes". É o erro mais comum do fluxo e merece tratamento de primeira classe.
>
> #### 3. Diálogo de descarte
> Confirmação com a contagem de células editadas desde a criação do rascunho, explicando que o número da versão não será reutilizado.
>
> #### 4. Histórico da matriz
> - Timeline vertical de todas as versões, da mais recente para a mais antiga.
> - Por versão: número, badge de estado, janela de vigência em pt-BR, autor da criação e da publicação, notas, contagem de eventos, **e a estrutura dos eixos daquela versão** (`Score HVI3` × `Segmento › Faturamento`) — porque ela pode ter mudado entre versões, e isso precisa ficar visível.
> - Cada versão expande para a **trilha de auditoria**: eventos com ícone por tipo, `summary` em pt-BR, autor, tempo relativo ("há 3 dias") com o absoluto no tooltip, e o payload em JSON colapsado.
> - Links por versão: Abrir · Comparar com a vigente · Restaurar como rascunho.
> - Filtro por tipo de evento e por autor.
>
> #### 5. Tela de rascunhos
> `/drafts`: todos os rascunhos abertos de todos os projetos, com autor, data e nº de pendências — para o time saber o que está em andamento. Badge de rascunho aberto também na lista de matrizes, na de projetos e na sidebar.
>
> #### 6. Notas de versão
> Ação "Adicionar nota" (`version/addNote`) disponível em qualquer versão, inclusive publicada — é o único conteúdo que pode ser acrescentado a uma versão publicada, e serve para registrar contexto posterior. Deixe isso explícito na interface.
>
> ### Testes
> - E2E do fluxo completo: abrir vigente → criar rascunho → editar 3 células → publicar → a nova vira vigente e a anterior aparece como histórico com a janela de vigência correta.
> - E2E do caminho de erro: criar matriz nova (todas pendentes) → tentar publicar → ver a barra de pendências e o destaque no grid → "Selecionar todas as pendentes" funciona.
> - E2E de descarte: criar rascunho → descartar → criar outro → o número pulou.
> - E2E de restauração: abrir versão histórica → restaurar como rascunho → o conteúdo confere com a histórica.
> - Componente: os botões corretos aparecem para cada um dos quatro estados.
> - Publicar com notas curtas demais é bloqueado.
>
> ### Critérios de aceite
> - O ciclo completo funciona no navegador sem tocar no arquivo manualmente.
> - Publicar com pendências dá erro compreensível e acionável, não uma mensagem técnica.
> - O histórico mostra quem fez o quê e quando, em frases legíveis em português.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes, tamanho no orçamento.
>
> ### Fora do escopo
> Comparação visual (S14) e vigência por data (S15) — deixe os links prontos apontando para as telas que as próximas sessões implementam.
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push.
