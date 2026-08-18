# Sessão 42 — Página do componente no centro da tela

**Modelo:** `Sonnet` · **Depende de:** S41 · **Épico/Marco:** Experiência (M13)

> **Por que Sonnet:** o contrato está fechado na documentação (§17.5 diz faixa a faixa o que a
> página tem) e a sessão é composição de componentes que já existem — `ComponentPayloadFields`,
> `ComponentTagsEditor`, `RichDocEditor`, `MatrixTimelineBar`, diálogos de publicar/descartar.
> Nenhum comando novo, nenhuma regra de vigência tocada.

## Prompt

> Você está implementando a Sessão 42 do PolicyOps — o componente de política deixa o painel de
> 340px e ganha página própria no centro da tela.
>
> **Leia antes de começar:** `docs/07-ux-e-editor.md` §2 (papel de cada região), §6 (o que sobra no
> inspector), §17.5 (a página, faixa a faixa) e §21 (US-UX-02, CT-UX-02); DEC-UX-002 em
> `docs/13-decisoes.md`. Código: `src/components/inspector/{ComponentInspector,ComponentPayloadFields}.tsx`,
> `src/components/tree/ComponentContentPanel.tsx`, `src/components/shell/{Inspector,Shell}.tsx`.
>
> ### Estado atual
> Selecionar um componente na árvore mostra, no centro, um resumo de leitura
> (`ComponentContentPanel`) que termina num aviso de que o conteúdo está "no painel à direita" — e,
> à direita, `ComponentInspector` com 543 linhas de formulário em 340px: nome, código, tags,
> origem, revisão, ações estruturais, ciclo de vida, payload, especificação rica e timeline.
>
> ### Objetivo
> Escrever a regra na largura da tela: um documento único no centro, do nome à vigência, sem painel
> lateral.
>
> ### Escopo
> 1. **`ComponentPage`** (`src/components/tree/ComponentPage.tsx`): substitui
>    `ComponentContentPanel` **e** `ComponentInspector`, com as faixas de §17.5 na ordem — cabeçalho
>    (breadcrumb, ícone, nome em edição inline, `code`, badges, `‹ anterior` / `próximo ›` entre
>    irmãos com `Alt+↑`/`Alt+↓`), barra de ações grudenta (estado da versão + Criar rascunho /
>    Publicar / Descartar / Documentar esta seção, e `⋯` com Mover, Duplicar, Arquivar), identidade
>    (tags, origem, revisão, filhos) em grade de 2 colunas, conteúdo da versão, especificação e
>    vigência. Coluna de leitura de até 960px, centralizada.
> 2. **`ComponentPayloadFields` ganha layout largo**: campos longos ocupam a coluna inteira com no
>    mínimo 6 linhas visíveis e crescem com o conteúdo; campos curtos pareiam 2 por linha. Passe a
>    variação por prop (`layout: 'wide' | 'narrow'`) em vez de duplicar o componente — o modo
>    estreito continua servindo a quem já o usa.
> 3. **Campos de lista viram chips** (`inputs`, `reasonCodes`, `dependencies`): `Enter` ou vírgula
>    adiciona, `Backspace` no campo vazio remove o último, colar texto separado por vírgula vira N
>    chips. O valor persistido continua sendo a mesma lista de strings — nada muda no schema nem nos
>    comandos.
> 4. **O inspector some desta tela** (§2, §6): `Inspector.tsx` deixa de rotear componente; `Shell`
>    não renderiza o `aside` direito quando a tela ativa não tem inspector de seleção, e o botão
>    `▥` fica desabilitado com o motivo no `title`.
> 5. **Estado de salvamento visível**: a barra grudenta mostra `Salvando…`/`Salvo` junto ao estado
>    da versão (commit por campo ao perder o foco, como hoje).
> 6. **Sem rascunho aberto**, campos em somente leitura com o aviso e o botão "Criar rascunho a
>    partir desta versão" — nunca campo editável que descarta o que foi digitado.
>
> ### Testes
> CT-UX-02 de `docs/07` §21 (e2e). Unitários: chips (colar com vírgulas, remover por `Backspace`,
> valor final idêntico ao formato antigo), navegação entre irmãos nas bordas (primeiro e último da
> seção), somente leitura sem rascunho, `SECTION` pura mostrando "Documentar esta seção". Migre os
> testes existentes de `ComponentInspector` para a página — o comportamento coberto não pode
> encolher.
>
> ### Critérios de aceite
> - Selecionar uma regra na árvore abre a página no centro; o painel direito não é renderizado.
> - Todo campo que existia no inspector existe na página, com no mínimo 480px de largura útil.
> - Publicar, descartar, mover, duplicar e arquivar continuam funcionando a partir da página.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes e
>   `dist/PolicyOps.html` atualizado no commit.
>
> ### Fora do escopo
> A tela de Vigência e a remoção do modo fotografia → S43 (mantenha o comportamento somente leitura
> da fotografia funcionando na página, como está hoje no inspector). Teclado da árvore e "próximo
> pendente" → S44. Evidências no componente e relacionados clicáveis continuam fora do épico.
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/07-ux-e-editor.md` §6/§17.5 (ajustados ao construído), `docs/13-decisoes.md`
> se alguma decisão aparecer, a linha da S42 em `docs/09-roadmap-de-entregas.md` e
> `docs/prompts/README.md`, e o ponteiro de `CLAUDE.md` (a linha da árvore/cadastro passa a apontar
> `ComponentPage`).
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → **pare e pergunte**.
> Sem dependência nova.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
