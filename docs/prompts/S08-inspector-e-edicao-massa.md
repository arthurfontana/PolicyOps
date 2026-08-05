# Sessão 08 — Inspector, edição em massa e undo/redo

**Modelo recomendado: `Opus`**
**Depende de:** S07
**Marco:** M2 — o editor fica utilizável de verdade

---

> **Por que Opus:** três mecanismos difíceis se cruzam aqui — a semântica de três estados dos campos em seleção múltipla, a pilha de undo com patches inversos, e a persistência otimista com debounce e reversão em erro. Um erro na combinação dos três produz perda silenciosa de edição do usuário.

## Prompt

> Você está implementando a Sessão 08 do Policy Matrix Studio — edição de células.
>
> **Leia antes de começar:** `docs/05-ux-e-editor.md` §3.3, §3.4, §3.5 e §4; `docs/04-regras-de-negocio.md` §2 (semântica do patch) e §3 (cor). O service `applyCellPatch` **já existe desde a S03 e já devolve o patch inverso** — não o reimplemente, consuma-o.
>
> ### Objetivo
> Editar uma célula ou 200 células de uma vez, com desfazer/refazer e salvamento automático confiável.
>
> ### Escopo
>
> #### 1. Inspector contextual — `src/components/editor/inspector/`
> Três estados, conforme §4 da UX:
> - **sem seleção** → propriedades da versão (já feito na S06, mova para cá);
> - **1 célula** → formulário unitário, cabeçalho com a coordenada legível `R3 × Médio`;
> - **N células** → mesmo formulário com semântica de múltiplos, cabeçalho `37 células`.
>
> Campos: Decisão (select com cores), Oferta (combobox com busca), Limite (combobox + campo "valor específico" que preenche `limitOverride`), Cor (swatches da paleta + "usar cor da decisão", que limpa o override), Observação (textarea), Atributos extras (editor chave-valor, colapsado).
>
> #### 2. Semântica de três estados (o ponto mais delicado)
> Em seleção múltipla, cada campo tem três estados possíveis:
> - **uniforme** → mostra o valor;
> - **divergente** → mostra o placeholder `— vários —`;
> - **intocado** → **não entra no patch**.
>
> Isso significa que o formulário precisa distinguir "o usuário não mexeu neste campo" de "o usuário escolheu limpar este campo". Não use `undefined` vs `null` de forma implícita no react-hook-form — mantenha um `Set<string>` explícito de campos tocados (`dirtyFields` não é suficiente, porque o valor inicial de um campo divergente é sintético). Construa o `CellPatch` **apenas** com os campos tocados.
>
> Cada campo tem um botão "Limpar" que marca o campo como tocado com valor `null`.
>
> #### 3. Ações rápidas
> Acima do formulário, sempre visíveis: `Aprovar tudo`, `Reprovar tudo`, `Análise manual`, e os 5 itens de catálogo mais usados na matriz atual (atalho de um clique, aplicando ao conjunto selecionado).
>
> Rodapé do inspector: botão "Aplicar a 37 células" com resumo textual do que muda ("decisão → Aprovado; oferta → Oferta 8").
>
> `Delete`/`Backspace` no grid limpa os atributos das selecionadas (voltam a `isUnset`), com confirmação acima de 20 células.
>
> #### 4. Undo / redo — `src/stores/editor-store.ts`
> Command stack com profundidade 50, conforme §3.4:
> ```ts
> type EditorCommand = { label: string; apply: CellPatch; invert: CellPatch };
> ```
> - O `invert` **vem do retorno da action** `applyCellPatch` — não o calcule no cliente.
> - `Ctrl/Cmd+Z` desfaz, `Ctrl/Cmd+Shift+Z` refaz. Desfazer aplica o `invert` como um novo patch no servidor (e gera seu próprio evento de auditoria — isso é intencional).
> - Refazer reaplica o `apply` original.
> - Empilhar um comando novo descarta a pilha de redo.
> - A pilha é limpa ao trocar de versão ou recarregar. Exiba isso na UI: tooltip no botão de desfazer com "histórico local desta sessão".
> - Não há undo depois de publicar — escreva isso no diálogo de publicação (S09) e desabilite os botões em versão não editável.
>
> #### 5. Persistência otimista — §3.5
> - Aplica no store imediatamente; dispara a action com **debounce de 600 ms**, agrupando patches consecutivos que toquem o **mesmo conjunto de coordenadas e os mesmos campos** (só nesse caso; conjuntos diferentes viram patches separados, em ordem).
> - Fila serial: nunca duas actions do mesmo editor em voo ao mesmo tempo — senão o `invert` de uma pode ser calculado sobre estado desatualizado.
> - Em erro: reverte o estado otimista, mostra toast com a mensagem pt-BR, e marca a barra superior como "Erro ao salvar" com botão "Tentar novamente".
> - Indicador na barra: `Salvo` / `Salvando…` / `Erro ao salvar`. **Não existe botão Salvar.**
> - Aviso `beforeunload` se houver patch pendente.
> - Versão não editável: inspector inteiro em modo leitura, com banner "Esta versão está publicada e não pode ser editada. Crie um rascunho para alterá-la."
>
> #### 6. Testes
> - Unitário de `buildPatchFromForm`: campos intocados não entram; campo tocado com `null` entra como `null`; campo divergente intocado não entra. Cubra as 9 combinações de (uniforme/divergente/vazio) × (tocado/intocado).
> - Undo round-trip **de integração** (contra o banco): aplicar um patch misto sobre 10 células (algumas cheias, algumas vazias), desfazer, e verificar que o estado do banco é idêntico ao original em todos os campos, incluindo `isUnset` e `attributes`.
> - Redo após undo restaura o resultado.
> - Fila serial: dois patches disparados em sequência rápida chegam na ordem e o segundo `invert` reflete o estado após o primeiro.
> - Erro do servidor reverte o estado otimista.
> - E2E: selecionar 3 colunas → aplicar "Reprovar tudo" → 12 células mudam → Ctrl+Z → voltam ao original.
>
> ### Critérios de aceite
> - Selecionar 50 células por marquee e atribuir uma oferta leva menos de 300 ms percebidos.
> - Alterar só a oferta de uma seleção **não** altera as decisões divergentes daquelas células.
> - Desfazer restaura fielmente, inclusive células que estavam vazias.
> - Recarregar a página mostra exatamente o que foi editado.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes.
>
> ### Fora do escopo
> Publicação e histórico (S09). Diff (S10). Não altere `applyCellPatch` no servidor — se ele parecer insuficiente, **pare e pergunte**.
>
> ### Encerramento
> Commit descritivo e push.
