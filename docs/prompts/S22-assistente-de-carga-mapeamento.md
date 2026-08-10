# Sessão 22 — Assistente de Carga: arquivo, colunas e biblioteca

**Modelo: `Sonnet`** · **Depende de:** S21 · **Épico: Carga · Marco M6**

> **Por que Sonnet:** é composição de tela sobre contratos já fechados — o motor da S21 devolve
> tudo pronto (tabela, pendências de mapeamento, lacunas de biblioteca) e esta sessão desenha os
> quatro primeiros passos e chama os comandos de biblioteca que já existem. Nenhuma invariante
> nova, nenhuma combinatória de eixo.

---

## Prompt

> Você está implementando a Sessão 22 do Policy Matrix Studio — os passos 1 a 4 do assistente de
> carga: abrir o arquivo, declarar o papel das colunas, resolver as pendências de biblioteca e
> configurar as regras de conteúdo. **Esta sessão não aplica carga nenhuma** — o passo 5 (plano)
> aparece somente como leitura, e o passo 6 (aplicar) chega na S24.
>
> **Leia antes de começar:** `docs/12-carga-de-matrizes.md` §2 (US-01 a US-04), §5.2, §5.3, §5.8
> e §6.1 (o desenho dos passos 1–4), `docs/07-ux-e-editor.md` §11 (editores de biblioteca que
> você reaproveita) e §14, `docs/13-decisoes.md` DEC-CARGA-008. Não tome decisão de arquitetura
> fora do documentado — **pare e pergunte**.
>
> ### Estado atual
> A S21 entregou `src/core/import/` completo e testado: `parseDelimitedTable`, `validateProfile`,
> `resolveImport`, `planImport` e `computeLibraryGaps`. Não existe nenhuma tela de carga. Os
> comandos de biblioteca (`variable/*`, `compat/*`, `catalog/*`) existem desde as sessões 06–08 e
> são o único caminho para escrever na biblioteca.
>
> ### Objetivo
> O usuário abre um `.csv` da extração, declara o mapeamento uma vez, resolve as pendências de
> biblioteca com um clique cada, e chega ao plano — tudo dentro de um assistente, sem sair para
> outras telas.
>
> ### Escopo
>
> #### 1. Rota e casca — `src/components/import/ImportWizard.tsx`
> Rota interna `import` (`useHashRouting`), acionada por "Carregar tabela" na tela de Projetos e
> no cabeçalho da lista de matrizes. Casca com os 6 passos numerados, navegação para trás livre,
> avanço bloqueado quando o passo tem pendência, e um aviso de saída se houver mapeamento não
> salvo. Estado do assistente em `src/store/import-store.ts` (novo, Zustand puro de UI — o
> documento só é tocado por comando).
>
> #### 2. Passo 1 — arquivo
> Seleção, arrastar-e-soltar (reaproveite `DropTarget`) e colagem de texto. A leitura do arquivo
> fica na camada de storage/componente, nunca em `core`. Mostra separador, codificação, contagem
> de linhas e colunas, e a prévia das 20 primeiras linhas já tabuladas. Controles para corrigir
> separador e linha de cabeçalho manualmente. Erros de `parseDelimitedTable` listados com linha e
> coluna, sem sair do passo.
>
> #### 3. Passo 2 — colunas
> Uma linha por coluna do arquivo, com seletor de papel (`Partição` · `Eixo X` · `Eixo Y` ·
> `Valor` · `Conferência` · `Ignorar`) e os campos que cada papel exige (nível e variável para
> eixo; campo alvo para valor; valor esperado para conferência). Bloco de desdobramento: marcar
> várias colunas de valor e agrupá-las numa dimensão (`Canal`), com código e rótulo por coluna.
> Campos de `codeTemplate`/`nameTemplate` com marcadores e **prévia ao vivo** dos códigos gerados,
> destacando colisão. Painel lateral fixo com o cálculo ao vivo: partições × desdobramentos =
> matrizes, células totais, maior grid e o limite de 6.000 (I16) — bloqueia o avanço se estourar.
>
> #### 4. Passo 3 — biblioteca
> Consome `computeLibraryGaps`. Uma seção por tipo de lacuna (domínios por variável, itens de
> catálogo por kind, regra de compatibilidade deduzida), cada item com as três saídas de US-03:
> **mapear para existente**, **criar** e **ignorar as linhas**. "Criar" abre o editor
> correspondente de `07-ux-e-editor.md` §11 já preenchido, e grava pelos comandos normais
> (`variable/createDraft` → `variable/saveDomains` → `variable/publish`; `compat/*`;
> `catalog/create`) — **nunca escreva na biblioteca por fora deles** (RN-17). Ação em lote
> "criar todos os domínios faltantes desta variável", com a lista revisável antes. Com zero
> pendências, o passo se marca ✓ e é pulado na navegação.
>
> #### 5. Passo 4 — conteúdo
> Tabela editável das `decisionRules` (valor de oferta → decisão), sempre com uma regra
> `otherwise` no fim, validada por `validateProfile`. Escolha de `missingRowPolicy` (preservar /
> esvaziar, padrão preservar). Regras de tag: uma linha por coluna de partição e pela dimensão
> desdobrada, com grupo e prefixo de código — **as tags ainda não são aplicadas nesta sessão**
> (S23 traz o campo no documento); grave só no perfil em memória.
>
> #### 6. Passo 5 — plano, somente leitura
> Renderize `planImport` como lista com os estados e as contagens de `docs/12` §5.5 e §6.1,
> **sem** seleção e sem botão de aplicar (rodapé informa "aplicação chega na próxima sessão").
> É o que torna esta sessão verificável de ponta a ponta com o arquivo real.
>
> ### Testes
> - Componente: colar uma tabela com separador `,` e outra com `;`; corrigir o separador à mão;
>   arquivo com cabeçalho ausente mostra erro e não avança; marcar uma coluna como eixo Y nível 1
>   sem existir nível 0 bloqueia o avanço; prévia de código com colisão destaca as duplicadas.
> - Componente: com lacunas de biblioteca presentes, "criar todos" produz a chamada de comando
>   esperada e a pendência some da lista.
> - E2E (`tests/e2e/`): abrir documento vazio → carregar o recorte do CINEMINHA → mapear as 12
>   colunas → criar a biblioteca pelo passo 3 → chegar ao passo 5 e ver **102 matrizes novas**.
> - Cobre os cenários **CT-07** e **CT-12** da página de funcionalidade na camada de tela.
>
> ### Critérios de aceite
> - Partindo de um documento com apenas as duas variáveis de score já existentes, o passo 3
>   monta sozinho: os domínios faltantes (inclusive `R99`), a variável do nível 0 do eixo Y com
>   seus 6 domínios, a regra de compatibilidade deduzida do arquivo e os 6 itens de oferta.
> - O passo 2 nunca deixa avançar com um mapeamento que produziria matriz acima de 6.000
>   combinações.
> - Nada é gravado no documento fora dos comandos de biblioteca acionados explicitamente pelo
>   usuário no passo 3.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes,
>   orçamento de 1,5 MB respeitado, `dist/PolicyOps.html` atualizado.
>
> ### Fora do escopo
> Aplicar a carga, criar matrizes ou rascunhos, salvar o perfil no documento e a fila de revisão
> — tudo isso é a S24. Tags no documento — S23. Estrutura divergente — S25: o passo 5 apenas a
> exibe.
>
> ### Atualização da documentação (obrigatório)
> `docs/12-carga-de-matrizes.md` §6 (o que a tela faz de fato), `docs/07-ux-e-editor.md` §14 se a
> navegação mudar, `docs/13-decisoes.md` para qualquer decisão nova, e a linha da sessão 22 em
> `docs/09-roadmap-de-entregas.md`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Sem dependência nova. Zero requisição de rede — a
> leitura do arquivo é local (`FileReader`/`text()`), e o modelo `.csv` de exemplo, se houver, é
> gerado por `Blob`. Decisão não coberta: **pare e pergunte**.
>
> ### Encerramento
> Commit descritivo na branch de trabalho, com `dist/PolicyOps.html` atualizado, e push.
