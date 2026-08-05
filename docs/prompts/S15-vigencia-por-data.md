# Sessão 15 — Vigência por data e portfólio

**Modelo: `Sonnet`** · **Depende de:** S13 · **Marco M4**

---

## Prompt

> Você está implementando a Sessão 15 do Policy Matrix Studio — consulta da política vigente em qualquer data.
>
> **Leia antes de começar:** `docs/05-regras-de-negocio.md` §6 e `docs/07-ux-e-editor.md` §10. As funções `getEffectiveVersion` e `getPortfolioAt` **já existem desde a S04** — consuma, não reescreva.
>
> ### Objetivo
> Responder com um clique: "qual era a política vigente em 15/03/2026?".
>
> ### Escopo
>
> #### 1. Tela de vigência
> - Seletor de data (padrão: hoje) e seletor de projeto, ambos refletidos no hash da URL para o link ser compartilhável.
> - Atalhos: Hoje · Início do mês · 30 dias atrás · 90 dias atrás · Início do ano.
> - Lista das matrizes do projeto com: nome, versão vigente naquela data, janela de vigência, autor da publicação, **estrutura dos eixos daquela versão**, e link direto para o viewer.
> - Matrizes sem versão vigente na data mostram *"sem política vigente em dd/mm/aaaa"* — a matriz ainda não existia. **Não é erro.**
> - **Faixa de linha do tempo** por matriz: barra horizontal com um segmento por versão publicada, largura proporcional à duração, cor por estado, marcador na data selecionada. Clicar num segmento navega para aquela versão. Tooltip com número e período.
> - Botão "Comparar com hoje" por matriz, levando à tela da S14 com A = versão da data e B = versão vigente hoje.
>
> #### 2. Viewer de versão histórica
> O editor já funciona em modo leitura desde a S11. Acrescente:
> - banner: **"Você está vendo a versão 11, vigente de 01/03/2026 a 12/07/2026. Esta é uma versão histórica."** com botões "Ir para a vigente" e "Restaurar como rascunho";
> - marca d'água discreta "HISTÓRICO" no fundo do grid;
> - o seletor de versão indica claramente qual é a vigente hoje.
>
> #### 3. Visão de portfólio
> Grade de cards, um por matriz, cada um com uma **miniatura do grid** (células de 12px, só cor, sem texto) da versão vigente na data. É a visão "como estava a política inteira naquele dia" — para auditoria e para apresentar ao comitê.
>
> Reaproveite o grid da S09 com uma prop `variant="thumbnail"`; **não crie um componente novo**. Em matrizes com eixos aninhados, a miniatura mantém os separadores de nível para o agrupamento continuar legível.
>
> #### 4. Exportação da consulta
> Botão "Exportar esta visão" gerando o JSON canônico de `docs/08-camada-de-comandos.md` §5 para todas as matrizes na data escolhida — é o artefato que se manda para uma auditoria ou se confere contra o motor de crédito.
>
> ### Testes
> - `getEffectiveVersion` nos limites: um instante antes da troca, **no instante exato** (vale a nova — intervalo semiaberto), um instante depois.
> - Data anterior à primeira publicação devolve `null`.
> - Versão agendada para o futuro não aparece como vigente hoje, mas aparece quando a data consultada é posterior ao agendamento.
> - `getPortfolioAt` com matrizes de idades diferentes.
> - Matriz cujos eixos mudaram entre versões: a estrutura mostrada é a **daquela versão**, não a atual.
> - Exportação produz o formato canônico exato, com decimais como string.
> - E2E: escolher uma data no passado e ver a versão histórica correta com o banner; clicar num segmento da linha do tempo navega certo.
>
> ### Critérios de aceite
> - Selecionar uma data de 60 dias atrás mostra a versão que estava vigente naquele dia.
> - A faixa de linha do tempo é clicável e navega corretamente.
> - O link com a data no hash abre a mesma visão para outra pessoa.
> - A miniatura de uma matriz aninhada continua legível.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes, tamanho no orçamento.
>
> ### Fora do escopo
> Reconciliação da biblioteca (S16). Templates e merge (S17).
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push. **Marco M4**: a ferramenta já substitui o Excel como fonte oficial. Vale registrar isso na mensagem de commit.
