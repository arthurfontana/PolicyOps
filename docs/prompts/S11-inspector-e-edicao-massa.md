# Sessão 11 — Inspector e edição em massa

**Modelo: `Sonnet`** · **Depende de:** S10 · **Marco M3**

---

## Prompt

> Você está implementando a Sessão 11 do Policy Matrix Studio — edição de células.
>
> **Leia antes de começar:** `docs/07-ux-e-editor.md` §6 e §8, e `docs/05-regras-de-negocio.md` §2 (semântica do patch). O comando `version/applyCellPatch` **já existe desde a S04 e já devolve o patch inverso** — consuma, não reimplemente. O undo/redo também já existe no `document-store` desde a S04.
>
> ### Objetivo
> Editar uma célula ou 300 células de uma vez, com desfazer funcionando.
>
> ### Escopo
>
> #### 1. Inspector contextual — `src/components/inspector/`
> Três estados:
> - **sem seleção** → propriedades da versão (já existe da S09; mova para cá);
> - **1 célula** → formulário unitário, cabeçalho com o caminho legível `Varejo › 100k–500k × R3`;
> - **N células** → mesmo formulário com semântica de múltiplos, cabeçalho `18 células`.
>
> Campos conforme §6.2: Decisão (select com cores), Oferta (combobox com busca), Limite (combobox + campo "valor específico" que preenche `limitOverride`), Cor (swatches + "usar cor da decisão", que limpa o override), Observação (textarea), Atributos extras (editor chave-valor, colapsado).
>
> #### 2. Semântica de três estados — o ponto mais delicado
> Em seleção múltipla, cada campo tem três estados:
> - **uniforme** → mostra o valor;
> - **divergente** → mostra o placeholder `— vários —`;
> - **intocado** → **não entra no patch**.
>
> O formulário precisa distinguir "o usuário não mexeu neste campo" de "o usuário escolheu limpar este campo". **Mantenha um `Set<string>` explícito de campos tocados** — `dirtyFields` do react-hook-form não basta, porque o valor inicial de um campo divergente é sintético. Construa o `CellPatch` apenas com os campos tocados.
>
> Cada campo tem botão "Limpar", que o marca como tocado com valor `null`.
>
> Isole a construção do patch numa função pura `buildPatchFromForm(touched, values, coords)` — é o que os testes cobrem.
>
> #### 3. Ações rápidas
> Acima do formulário, sempre visíveis: `Aprovar tudo`, `Reprovar tudo`, `Análise manual`, e os **5 itens de catálogo mais usados na matriz atual** (atalho de um clique aplicado ao conjunto selecionado).
>
> Rodapé do inspector: "Aplicar a 18 células" com resumo textual do que muda ("decisão → Aprovado; oferta → Oferta 8").
>
> `Delete`/`Backspace` no grid limpa as células selecionadas (voltam a pendentes), com confirmação acima de 20.
>
> #### 4. Undo/redo na interface
> A pilha já existe no `document-store`. Aqui você:
> - liga `Ctrl/Cmd+Z` e `Ctrl/Cmd+Shift+Z`;
> - coloca botões na barra superior com tooltip mostrando o rótulo da operação ("Desfazer: atribuir Oferta 8 a 18 células");
> - desabilita em versão não editável;
> - avisa, no diálogo de publicação da S13, que publicar limpa a pilha.
>
> #### 5. Modo somente leitura
> Versão não editável: inspector inteiro em leitura, com banner *"Esta versão está publicada e não pode ser editada. Crie um rascunho para alterá-la."*
>
> #### 6. Estado de alterações não salvas
> Toda edição marca o documento como `dirty` (a S05 já cuida do autosave local e do `beforeunload`). Confirme que a barra de status reflete isso e que `Ctrl+S` grava.
>
> ### Testes
> - `buildPatchFromForm`: as 9 combinações de (uniforme / divergente / vazio) × (tocado / intocado). Campo intocado nunca entra; campo tocado com `null` entra como `null`.
> - Alterar só a oferta de uma seleção **não** altera as decisões divergentes daquelas células — teste de integração comparando o documento.
> - Undo round-trip: aplicar patch misto sobre 10 células (algumas preenchidas, algumas ausentes), desfazer, e o documento fica **deep-equal** ao original.
> - Redo após undo restaura o resultado.
> - Ações rápidas aplicam a todas as selecionadas num único comando.
> - Delete em 25 células pede confirmação; em 5, não.
> - E2E: selecionar o cabeçalho "Varejo" → "Reprovar tudo" → 18 células mudam → Ctrl+Z → voltam ao original → Ctrl+S → recarregar → estado persistido.
>
> ### Critérios de aceite
> - Selecionar 300 células e atribuir uma oferta leva menos de 100 ms (tudo em memória).
> - Alterar a oferta de uma seleção heterogênea preserva as decisões existentes.
> - Desfazer restaura fielmente, inclusive células que estavam vazias.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes, tamanho no orçamento.
>
> ### Fora do escopo
> Publicação e histórico (S13). Operações de nível (S12). Não altere `applyCellPatch` — se ele parecer insuficiente, **pare e pergunte**.
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push. **Marco M3**: o editor está utilizável e o time já pode montar as matrizes reais.
