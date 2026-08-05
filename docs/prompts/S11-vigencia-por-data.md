# Sessão 11 — Vigência por data e viewer

**Modelo recomendado: `Sonnet`**
**Depende de:** S09
**Marco:** M3 — o MVP substitui o Excel

---

## Prompt

> Você está implementando a Sessão 11 do Policy Matrix Studio — consulta da política vigente em qualquer data.
>
> **Leia antes de começar:** `docs/04-regras-de-negocio.md` §6 e `docs/05-ux-e-editor.md` §6. Os services `getEffectiveVersion` e `getPortfolioAt` **já existem desde a S03** — consuma-os, não os reescreva.
>
> ### Objetivo
> Responder com um clique: "qual era a política vigente em 15/03/2026?".
>
> ### Escopo
>
> #### 1. Tela `/timeline`
> - Seletor de data (default: hoje) e seletor de projeto. A data vai para a query string, para que o link seja compartilhável.
> - Atalhos rápidos: Hoje · Início do mês · 30 dias atrás · 90 dias atrás · Início do ano.
> - Lista de todas as matrizes do projeto com: nome, versão vigente naquela data, janela de vigência, autor da publicação, e link direto para o viewer daquela versão.
> - Matrizes sem versão vigente na data mostram "sem política vigente em dd/mm/aaaa" (a matriz ainda não existia) — não um erro.
> - **Faixa de linha do tempo** por matriz: barra horizontal com um segmento por versão publicada, largura proporcional à duração, cor por estado, marcador na data selecionada. Clicar num segmento navega para aquela versão. Tooltip com número da versão e período.
> - Botão "Comparar com hoje" por matriz, levando à tela da S10 com A = versão da data e B = versão vigente hoje.
>
> #### 2. Viewer de versão histórica
> Ao abrir uma versão SUPERSEDED, o editor já funciona em modo leitura (S08). Acrescente:
> - Banner no topo: **"Você está vendo a versão 11, vigente de 01/03/2026 a 12/07/2026. Esta é uma versão histórica."** com botões "Ir para a vigente" e "Restaurar como rascunho".
> - Marca d'água discreta "HISTÓRICO" no fundo do grid.
> - O seletor de versão da barra superior indica claramente qual é a vigente hoje.
>
> #### 3. Visão de portfólio
> `/timeline?project=X&view=portfolio`: grade de cards, uma por matriz, cada um com um **mini-grid** (thumbnail, células de 12px, sem texto, só cor) da versão vigente na data. É a visão "como estava a política inteira naquele dia" — útil para auditoria e para apresentar ao comitê.
>
> Reaproveite o `matrix-grid` com uma prop `variant="thumbnail"`; não crie um componente novo.
>
> #### 4. Endpoint de leitura
> `GET /api/matrices/[matrixId]/effective?at=ISO` conforme `docs/06-api.md` §4, devolvendo o formato canônico de intercâmbio de §5. Exige sessão autenticada. Este endpoint existe para scripts internos de conferência contra o motor de crédito.
>
> #### 5. Testes
> - `getEffectiveVersion` nos limites: um instante antes da troca, no instante exato (vale a nova, intervalo semiaberto), um instante depois.
> - Data anterior à primeira publicação devolve `null`.
> - Versão agendada para o futuro não aparece como vigente hoje, mas aparece quando a data consultada é posterior ao agendamento.
> - `getPortfolioAt` com matrizes de idades diferentes.
> - Endpoint retorna o formato canônico exato de §5, com decimais como string.
> - E2E: escolher uma data no passado e ver a versão histórica correta com o banner.
>
> ### Critérios de aceite
> - Selecionar uma data de 60 dias atrás mostra a versão que estava vigente naquele dia.
> - A faixa de linha do tempo é clicável e navega corretamente.
> - O link com a data na query string abre a mesma visão para outra pessoa.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes.
>
> ### Fora do escopo
> Exportação (S14). Reconciliação de variáveis (S12).
>
> ### Encerramento
> Commit descritivo e push. **Este é o marco M3**: ao final desta sessão a ferramenta já pode ser adotada como fonte oficial das matrizes. Vale registrar isso na mensagem de commit.
