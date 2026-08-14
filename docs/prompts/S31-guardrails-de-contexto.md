# Sessão 31 — Guardrails de contexto e reorganização documental

**Modelo: `Sonnet`** · **Depende de:** — (independente; recomendada o quanto antes) · **Épico: Plataforma**

> **Por que Sonnet:** a execução é em boa parte mecânica (mover conteúdo, criar ponteiros,
> plugar guard no CI), mas decidir **o que** vive em cada camada exige julgamento sobre o
> conteúdo — acima de Haiku; nenhuma invariante de dados em risco que pedisse Opus.

---

## Prompt

> Você está implementando a Sessão 31 do Policy Matrix Studio — os guardrails de consumo de
> contexto (ADR-006): toda sessão futura fica mais barata em tokens sem perder informação.
>
> **Leia antes de começar:** `docs/13-decisoes.md` ADR-006; a referência
> `references/guardrails-de-contexto.md` da skill `especificacao-e-sessoes` (G1–G6); e, como
> modelo pronto do resultado, o `CLAUDE.md` do repositório AppCreditoSimulador (índice em
> camadas com mapa "onde vive o quê" e guard mecânico). **Conteúdo é movido, nunca apagado.**
>
> ### Estado atual
> `CLAUDE.md` é enxuto mas sem mapa por domínio; a doc normativa vive em `docs/01..14` (~4.500
> linhas) e não há camada de detalhe de implementação: sessões pagam Reads extensos para achar
> onde mexer. Não há guard mecânico de tamanho. Arquivos grandes de código (`merge/documents.ts`
> ~1.7k linhas, `validate.ts`, `lifecycle.ts`, `Grid.tsx`) não têm âncoras de região.
>
> ### Objetivo
> Uma sessão nova encontra qualquer domínio por ponteiro (1 salto), o `CLAUDE.md` tem teto
> mecânico no CI, e os arquivos gigantes são navegáveis por âncora grep-ável.
>
> ### Escopo
>
> #### 1. `CLAUDE.md` como índice em camadas (G1)
> Reescrever com: o que o produto é em 3 linhas (forma nova — plataforma local), comandos,
> regras invioláveis, e o mapa **"onde vive o quê"**: uma linha por domínio (documento/schema,
> eixos, versionamento, diff, merge, reconcile, import/carga, storage/adapters, servidor,
> identidade/papéis, evidências, grid/UX) apontando doc normativa + diretório de código.
> Teto ~450 linhas. Feature nova = 1 linha no mapa.
>
> #### 2. Camada de detalhe de implementação (G2)
> Criar `docs/claude/` **sob demanda, mínima**: comece com `Mapa-de-regioes.md` (índice das
> âncoras do passo 4) e `Convencoes-de-sessao.md` (o que toda sessão repete: comandos de
> verificação, suíte de contrato dos adapters, fixtures canônicas). Não duplicar nada de
> `docs/01..14` — ponteiro, não cópia.
>
> #### 3. Guard mecânico (G3)
> Copiar `scripts/check-claude-md.js` do padrão da skill (há cópia no AppCreditoSimulador),
> registrar `check:claude-md` no `package.json` e plugar no CI junto de `check-size`.
>
> #### 4. Âncoras de região (G5)
> Nos arquivos acima de ~600 linhas de `src/`, comentários-âncora grep-áveis por seção
> (`// #region: <slug>` no padrão que escolher e documentar no Mapa) — **sem mover código**,
> sem renomear nada. Extração de módulos fica para quando uma sessão futura tocar o arquivo
> (incremental, nunca big-bang).
>
> #### 5. Higiene de prompts (G6)
> Nota curta em `docs/prompts/README.md`: pesquisa exploratória via subagent, pedidos apontando
> arquivo/região, sessão nova por tarefa.
>
> ### Testes
> `pnpm check:claude-md` verde e falhando de verdade acima do teto (teste manual documentado no
> PR). Verificações existentes todas verdes — âncoras são comentários, nada de comportamento.
>
> ### Critérios de aceite
> - `CLAUDE.md` ≤ 450 linhas com o mapa cobrindo os 12 domínios listados.
> - Nenhuma informação sumiu: tudo que saiu tem destino apontado (diff do PR prova).
> - Guard no CI; verificações verdes; `dist/PolicyOps.html` atualizado se o build rodar.
>
> ### Fora do escopo
> Migrar `docs/01..14` para estrutura de Wiki (`docs/wiki/` + sync) — avaliar num épico
> documental próprio, se a numeração atual passar a doer. Extração de módulos dos arquivos
> grandes. Qualquer mudança de comportamento.
>
> ### Atualização da documentação (obrigatório)
> É a própria sessão. Linha da S31 no roadmap; DEC nova se decidir algo (ex.: padrão de âncora).
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push.
