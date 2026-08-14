# Sessão 34 — Editor rico de especificação

**Modelo:** `Opus` · **Depende de:** S32 · **Épico/Marco:** Governança (M11)

> **Por que Opus:** perda de trabalho do usuário é o modo de falha central — texto longo digitado
> num editor próprio sobre `contentEditable`, com serialização que precisa nascer estável (blocos
> viram histórico imutável) e integração com undo/redo do documento. Mesmo perfil das S04/S05.

## Prompt

> Você está implementando a Sessão 34 do PolicyOps — o editor rico de blocos (`RichDoc`) usado na
> documentação livre de componentes e, depois, nas solicitações de alteração.
>
> **Leia antes de começar:** `docs/14-governanca-de-alteracoes.md` §7 (contrato completo do
> RichDoc e limites de anexo); `docs/03-modelo-do-documento.md` (schema `RichDoc`/`Block`/
> `Attachment` fechado na S32); DEC-GOV-005; `docs/08-camada-de-comandos.md` (integração com a
> pilha de comandos).
>
> ### Estado atual
> O schema de `RichDoc`, `Block` e `Attachment` existe desde a S32 (com Zod e testes); a S33
> deixou o campo `spec` do inspector como placeholder. Nenhum código de edição existe.
> **Nenhuma dependência nova é permitida** (DEC-GOV-005) — o editor é próprio.
>
> ### Objetivo
> O usuário escreve a especificação livre de um componente com títulos, listas, tabelas, imagens,
> callouts e links — e nada do que digitar se perde.
>
> ### Escopo
> 1. **Core puro** (`src/core/richdoc/`): operações de bloco (inserir, remover, mover, transformar
>    tipo, editar texto/marcas) como funções documento→documento com inverso, integradas ao
>    command pattern com **coalescência de digitação** (edições contíguas no mesmo bloco viram um
>    comando só — sem isso o undo vira tortura). Normalização/sanitização do colar: texto →
>    parágrafos; tabela HTML → bloco `table`; qualquer outra marcação → texto puro.
> 2. **Componente `RichDocEditor`**: um `contentEditable` **por bloco** (nunca um único global),
>    toolbar mínima, menu "/" ou botão para inserir bloco, atalhos básicos (Ctrl+B/I, Enter divide,
>    Backspace no início funde), navegação por teclado entre blocos.
> 3. **Imagens**: seleção de arquivo → downscale para ≤ 1600px no cliente → `Attachment` base64;
>    teto de 300 KB por imagem (`E-GOV-05`) e aviso quando os anexos do documento passarem de
>    3 MB. Sem colar de imagem nesta sessão.
> 4. **Diff por bloco** (`src/core/richdoc/diff.ts`): adicionado/removido/alterado por id de
>    bloco, com render lado a lado no padrão visual do diff de matriz — será usado pela S36/S39.
> 5. **Plugar** no inspector de componente (substitui o placeholder da S33).
>
> ### Testes
> 100% no core de richdoc: cada operação e seu inverso, coalescência, sanitização do colar
> (fixtures de HTML do Word/Excel reais), limites de imagem, diff por bloco (incluindo mover ≠
> remover+adicionar, se você optar por detectar movimento — decida e documente). Componente:
> testes jsdom de digitação, Enter/Backspace e undo. E2E: escrever, salvar, reabrir, nada mudou.
>
> ### Critérios de aceite
> - Digitar um parágrafo longo e apertar Ctrl+Z **uma vez** desfaz a digitação inteira, não letra
>   a letra; refazer devolve tudo.
> - Colar uma tabela do Excel produz um bloco `table` fiel; colar texto do Word não traz lixo de
>   formatação.
> - Documento com specs sobrevive ao ciclo salvar→reabrir→validar Zod sem perda.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes; **atenção redobrada ao
>   orçamento de 1,5 MB** — se o build passar de 1,45 MB, pare e reporte antes de seguir.
>
> ### Fora do escopo
> Diff intra-texto, colar imagem, comentários/menções, exportação (S38), uso em DBs (S35 pluga).
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/07-ux-e-editor.md` (editor de blocos: interações e atalhos),
> `docs/14-governanca-de-alteracoes.md` §7 (estado ✅ e qualquer ajuste de contrato),
> `docs/13-decisoes.md` (decisões da sessão), linha da S34 em `docs/09`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → pare e pergunte.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
