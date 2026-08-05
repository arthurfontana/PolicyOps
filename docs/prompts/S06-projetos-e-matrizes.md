# Sessão 06 — Projetos e criação de matrizes

**Modelo recomendado: `Sonnet`**
**Depende de:** S03, S04, S05

---

## Prompt

> Você está implementando a Sessão 06 do Policy Matrix Studio.
>
> **Leia antes de começar:** `docs/05-ux-e-editor.md` §1, §2 e §3.1 (shell, badges e renderização do grid), `docs/06-api.md` §3 (`EditorPayload`) e `docs/04-regras-de-negocio.md` §3 (resolução de cor da célula). Os services de matriz já existem desde a S03 — **não os reescreva**, apenas consuma.
>
> ### Objetivo
> Navegar de projeto → matriz → versão e **ver a matriz renderizada**, ainda em modo somente leitura. É o primeiro momento em que o "cineminha" aparece na tela.
>
> ### Escopo
>
> #### 1. Projetos
> - `/projects`: lista com nome, descrição, nº de matrizes, nº de rascunhos abertos. Criar/editar em Dialog. Arquivar (ADMIN) com confirmação.
> - `/projects/[projectId]`: cabeçalho do projeto + lista de matrizes com nome, código, eixos (X × Y), badge da versão vigente, badge de rascunho aberto, data da última publicação.
> - Sidebar passa a listar os projetos de verdade, com a rota ativa destacada.
>
> #### 2. Criação de matriz
> Wizard em Dialog, 2 passos:
> 1. Identificação: projeto (pré-preenchido), nome, código (sugerido a partir do nome, editável, validado `^[A-Z0-9_]+$`), descrição.
> 2. Eixos: dois comboboxes com busca sobre as variáveis que **têm versão publicada**. Variáveis sem versão publicada aparecem desabilitadas com o motivo. Preview ao vivo das dimensões: "6 colunas × 4 linhas = 24 células". Impedir X e Y iguais.
>
> Chama a action `createMatrix` da S03 e navega para o editor da v1 recém-criada.
>
> #### 3. Roteamento de versão
> - `/projects/[projectId]/matrices/[matrixId]` → redireciona para a versão vigente; se não houver, para o rascunho; se não houver nenhum, mostra estado vazio.
> - `/projects/[projectId]/matrices/[matrixId]/versions/[versionId]` → a tela do grid.
> - Seletor de versão na barra superior, listando todas as versões com estado e vigência.
>
> #### 4. O grid (somente leitura)
> Componente `src/components/editor/matrix-grid.tsx`, conforme `docs/05-ux-e-editor.md` §3.1:
> - CSS Grid em DOM puro. **Sem canvas e sem biblioteca de grid de terceiros.**
> - Cabeçalhos sticky: colunas = domínios de X ordenados por `position`; linhas = domínios de Y.
> - Célula 88×56 px mínimo, com 3 linhas de conteúdo: rótulo curto da decisão, oferta, limite em BRL.
> - Triângulo no canto quando há observação; hachura diagonal + ícone quando `isUnset`.
> - Cor resolvida pela prioridade de §3 das regras de negócio; texto preto/branco pela luminância. Implemente `resolveCellColor` e `contrastText` em `src/lib/colors.ts`, com testes.
> - Zoom 50–200% com `Ctrl + scroll`, botões e `Ctrl+0`.
> - Tooltip no hover mostrando `R3 × Médio` com os valores completos.
> - Legenda abaixo do grid: as decisões usadas na matriz, com cor e rótulo.
>
> **Nenhuma interação de seleção ou edição nesta sessão** — isso é S07/S08. O grid recebe `EditorPayload` e renderiza; mantenha-o como componente de apresentação puro, sem acesso a dados.
>
> #### 5. Barra superior e painel direito
> - Barra: nome da matriz, badge de estado (conforme §2 da UX), seletor de versão, e os botões de ciclo de vida **desabilitados com tooltip "disponível na próxima entrega"** (serão ligados na S09).
> - Inspector à direita mostrando as propriedades da versão (§4.1 da UX), somente leitura: eixos com variável e versão pinada, badge de defasagem quando `isStale`, estatísticas (total, % preenchida, distribuição por decisão), notas, autor e datas.
>
> #### 6. Testes
> - `resolveCellColor`: cada nível da prioridade, incluindo `isUnset` e o fallback neutro.
> - `contrastText`: preto sobre fundo claro, branco sobre escuro, no limiar 0.55.
> - Componente: renderizar o `EditorPayload` do seed produz 24 células e os cabeçalhos na ordem de `position` (não em ordem alfabética).
> - E2E: login → projeto → matriz → grid visível com as 24 células.
>
> ### Critérios de aceite
> - Criar uma matriz nova escolhendo `FAIXA_RENDA` × `TEMPO_EMPRESA` gera um grid 4×4 todo hachurado (`isUnset`).
> - A matriz de exemplo do seed renderiza com cores e conteúdo corretos.
> - Zoom funciona e os cabeçalhos permanecem fixos ao rolar.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes.
>
> ### Fora do escopo
> Seleção, edição, publicação, comparação. Não altere services da S03.
>
> ### Encerramento
> Commit descritivo e push.
