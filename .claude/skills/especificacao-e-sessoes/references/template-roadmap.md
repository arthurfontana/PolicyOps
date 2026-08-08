# Template — `Roadmap-e-Sessoes.md`

Página única que responde: o que já foi feito, o que vem agora, em que ordem, com qual
modelo e por quê. É atualizada ao fim de toda sessão (status) e a cada replanejamento.

```markdown
# Roadmap e Sessões

<N> sessões incrementais. Cada uma termina com o sistema 100% funcional, testes verdes,
commitada e pushada. Uma sessão = um PR.

## Quadro geral

| # | Sessão | Modelo | Entrega verificável | Depende de | Status |
|---|---|---|---|---|---|
| 01 | Scaffold e build | `Sonnet` | App abre e mostra o shell | — | ✅ PR #1 |
| 02 | Modelo do documento | `Sonnet` | Schema validado + exemplo + migração | 01 | ✅ PR #2 |
| 03 | Motor de eixos | `Opus` | Tuplas e compatibilidade 100% testadas | 02 | 🚧 |
| … | | | | | ⬜ |

"Entrega verificável" = o que dá para demonstrar a alguém ao final, não "implementar X".

## Por que cada modelo

**Opus (sessões 03, 04…)** — invariantes que corrompem dados em silêncio se saírem
erradas; combinatória com casos de borda que não aparecem em teste; perda de trabalho do
usuário como modo de falha.

**Sonnet (sessões 01, 02…)** — transcrição fiel de especificação já fechada, CRUD e
composição de telas sobre contratos definidos.

**Haiku (sessão 08…)** — CRUD de entidade única / sincronização mecânica.

> Sessão Sonnet/Haiku que encontrar decisão de arquitetura não documentada: **parar e
> perguntar**. Está escrito em todos os prompts.

## Marcos utilizáveis

| Marco | Após | O que já dá para fazer de verdade |
|---|---|---|
| **M1 — <nome>** | S05 | <valor utilizável por uma pessoa real> |
| **M2 — <nome>** | S08 | … |

## Regras transversais (valem para TODAS as sessões)

1. <Comandos de verificação do projeto> verdes ao fim de cada sessão.
2. Escopo é escopo: não implementar sessões futuras "já que estou aqui".
3. Não adicionar dependências fora da lista de `Arquitetura.md` sem perguntar.
4. Documentação atualizada no mesmo PR (regra da documentação viva).
5. <Restrições específicas do projeto: orçamento de bundle, GATEs de teste, etc.>

## Ordem e dependências

Notas sobre por que a ordem é a que é ("05 antes de 06 não é negociável: sem
persistência, cada teste manual começa do zero").
```

## Regras de manutenção

- Sessões novas (pós-MVP, mudanças de escopo) entram no fim da tabela com nota de
  contexto — a tabela é o índice completo do log de execução.
- Se os nomes de modelo da família vigente mudarem, atualize a coluna Modelo e registre
  o mapeamento de tiers aqui.
- Replanejamento (sessão quebrada em partes, ordem alterada) edita esta página ANTES de
  executar — a tabela sempre reflete o plano vigente.
