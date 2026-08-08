---
name: especificacao-e-sessoes
description: >-
  Fluxo padrão de especificação, documentação viva e planejamento de desenvolvimento por
  sessões incrementais de IA. Use SEMPRE que o usuário quiser: refinar uma necessidade de
  negócio antes de codificar; transformar uma ideia/discussão em documentação técnica e
  funcional; criar ou atualizar páginas de Wiki de um projeto; quebrar um épico ou feature
  em sessões de execução com prompt próprio; escolher qual modelo de IA usar numa tarefa;
  registrar uma decisão de arquitetura (ADR/DEC); tratar um pedido de mudança de escopo
  sobre algo já especificado; preparar handoff de um sistema para um time de TI; ou
  configurar um repositório novo com essa estrutura (incluindo a Action de sincronização
  da Wiki). Também dispara quando o usuário mencionar "sessão de execução", "prompt de
  sessão", "documentação viva", "épico", "especificação" ou "handoff" — mesmo sem pedir a
  skill pelo nome.
---

# Especificação e Sessões — fluxo padrão de desenvolvimento

Este é o método de trabalho do usuário para qualquer projeto de software: **discutir e
refinar a necessidade → documentar como retrato vivo do sistema na Wiki → quebrar em
sessões incrementais de execução, cada uma com prompt e modelo próprios → executar uma
sessão por vez → atualizar a documentação na mesma sessão que muda o comportamento**.

A documentação é a **fonte da verdade do estado atual e desejado do sistema** — detalhada
o suficiente para um time de TI desenvolver sem perguntar nada ao autor. As sessões são o
**log incremental de como se chegou até ali**. Nunca inverta os papéis: prompt de sessão
não substitui documentação, e documentação não guarda histórico de pedidos.

## O fluxo em 5 fases

```
1. REFINAR      Discutir a necessidade de negócio até fechar escopo, invariantes e trade-offs.
2. DOCUMENTAR   Escrever/atualizar as páginas da Wiki: spec funcional (US + cenários) e técnica.
3. PLANEJAR     Quebrar em N sessões incrementais; para cada uma: prompt, modelo e dependências.
4. EXECUTAR     Uma sessão por vez, em conversa nova, no modelo indicado. Termina verde, commitada.
5. SINCRONIZAR  A sessão que muda comportamento atualiza as páginas afetadas no MESMO PR.
```

Nunca pule a fase 2: código só nasce de documentação que já descreve o comportamento
desejado. Se durante a fase 1 o usuário quiser ir direto ao código, proponha ao menos a
página de funcionalidade (com histórias de usuário e cenários) antes da primeira sessão.

## Fase 1 — Refinar a necessidade

Conduza a conversa como analista de requisitos, não como executor:

- Extraia o problema de negócio (quem sofre, o que custa, o que muda com a solução) antes
  de discutir solução técnica.
- Force decisões sobre casos de borda e invariantes ("o que NUNCA pode acontecer?",
  "o que acontece com dados antigos?"). Invariante descoberta na fase 1 vira regra de
  negócio documentada; descoberta na fase 4 vira bug.
- Registre cada decisão de arquitetura relevante como candidata a DEC (ver
  `references/template-decisoes.md`).
- Feche a fase com um resumo de escopo: o que entra, o que explicitamente NÃO entra, e as
  restrições que comandam a arquitetura.

## Fase 2 — Documentar (retrato vivo, na Wiki)

### Onde a documentação mora

**A Wiki do GitHub é o local canônico de leitura; `docs/wiki/` no repositório é o local
canônico de escrita.** Todas as páginas vivem versionadas em `docs/wiki/*.md` e são
publicadas automaticamente na Wiki pela Action `assets/sync-wiki.yml` (copie-a para
`.github/workflows/sync-wiki.yml` do repositório). Nunca edite a Wiki diretamente pela
interface do GitHub — a próxima sincronização sobrescreve.

Isso dá o melhor dos dois mundos: a doc entra no mesmo PR que o código (revisável,
atômica com a mudança) e o time de TI lê numa Wiki navegável sem clonar nada.

### Estrutura de páginas

Catálogo mínimo (crie sob demanda, não tudo de uma vez):

| Página | Conteúdo | Template |
|---|---|---|
| `Home.md` | O que é o sistema em 60 segundos + navegação | — |
| `_Sidebar.md` | Índice lateral da Wiki | — |
| `Visao-e-Escopo.md` | Problema, o que o produto é e NÃO é, restrições que comandam a arquitetura | — |
| `Arquitetura.md` | Stack, estrutura de pastas, padrões, restrições normativas ("não substituir X", "não reorganizar Y") | — |
| `Modelo-de-Dados.md` | Schema/entidades, invariantes, versionamento de schema e notas de migração | — |
| `Funcionalidade-<Nome>.md` (uma por domínio funcional) | **O coração do handoff**: comportamento atual, histórias de usuário, critérios de aceite, cenários de teste, regras de negócio, contratos técnicos | `references/template-pagina-funcionalidade.md` |
| `Decisoes.md` | Catálogo de ADRs/DECs numerados com contexto e justificativa | `references/template-decisoes.md` |
| `Roadmap-e-Sessoes.md` | Tabela de sessões (modelo, entrega verificável, dependências, status), marcos utilizáveis e o "por que cada modelo" | `references/template-roadmap.md` |
| `Sessoes/S<NN>-<slug>.md` | Um arquivo por prompt de sessão | `references/template-prompt-sessao.md` |

Regras de forma:

- Escreva no idioma de trabalho do usuário (pt-BR por padrão) e na **linguagem do
  negócio** — um analista da área precisa entender a spec funcional sem dicionário técnico.
- Especificação técnica usa contratos concretos: assinaturas de tipos/funções, formatos de
  arquivo, orçamentos de desempenho com número ("diff de 1.500 células em < 150 ms"),
  catálogo de erros com código e mensagem.
- Toda página de funcionalidade referencia as DECs que a moldaram — a página diz *como é*,
  a DEC diz *por que ficou assim*.

### Histórias de usuário e cenários de teste

Formato padrão (detalhado em `references/template-pagina-funcionalidade.md`):

- **História de usuário clássica** com ID estável (`US-XX`): "Como <papel>, quero <ação>
  para <valor>", seguida de **critérios de aceitação** em lista verificável.
- **Cenários de teste em Gherkin** (`Dado/Quando/Então`, ID `CT-XX`) apenas para fluxos com
  regra de negócio, invariante ou caso de borda — onde a sequência e o estado importam.
  Polimento visual e CRUD trivial ficam só com critérios de aceitação; Gherkin ali é ruído.
- Cada cenário aponta a US que cobre. Uma US sem nenhum critério verificável está
  incompleta — reescreva antes de planejar sessão.

### A regra da documentação viva (inviolável)

A documentação descreve **o estado atual e o estado desejado do sistema — nunca o
histórico de pedidos**. Consequências práticas:

1. Quando o usuário pedir uma mudança de funcionalidade — mesmo contrariando o que está
   escrito — **atualize a página original** para o novo comportamento. Não acrescente
   "adendo", "v2" nem "atualização de DD/MM": reescreva o trecho como se sempre tivesse
   sido assim. O porquê da mudança vai para `Decisoes.md` (nova DEC) e o como para o log
   de sessões.
2. Toda sessão que muda comportamento **atualiza as páginas afetadas no mesmo PR** (US,
   cenários, modelo de dados, contratos). O prompt de sessão traz essa seção como
   obrigatória — sessão que termina com doc desatualizada não terminou.
3. Documento de handoff datado e congelado ("Handoff v1.0") é um anti-padrão: apodrece no
   dia seguinte. O handoff É a Wiki no estado corrente — se um time de TI a recebesse
   hoje, conseguiria desenvolver sem perguntar nada? Se não, a doc está incompleta.
4. Um snapshot histórico só existe dentro do log de sessões e do histórico git da Wiki —
   nunca como página paralela.

## Fase 3 — Planejar as sessões

Quebre o trabalho em sessões **estritamente incrementais**: cada uma aplica uma mudança
específica sobre o que já existe, termina com o sistema 100% funcional, testes verdes,
commitada e pushada. Uma sessão = um PR.

- Granularidade: uma sessão é o que uma conversa de IA executa com qualidade de ponta a
  ponta — um motor, uma tela, uma integração. Se o prompt precisar de mais de ~5 blocos de
  escopo, quebre em partes (S17a/S17b/S17c) com critérios de aceite independentes.
- Cada sessão declara dependências explícitas e entra na tabela de `Roadmap-e-Sessoes.md`
  com **entrega verificável** (o que dá para demonstrar ao final, não "implementar X").
- Defina **marcos utilizáveis** (M1, M2…): pontos em que o sistema já serve a alguém de
  verdade. Priorize a ordem das sessões pelos marcos, não por afinidade técnica.
- Escreva cada prompt com `references/template-prompt-sessao.md` e salve em
  `docs/wiki/Sessoes/S<NN>-<slug>.md`. O prompt **referencia as páginas da Wiki (com
  seção específica) em vez de repetir a spec** — se está copiando parágrafos da doc para o
  prompt, a doc está no lugar errado.
- Regras transversais do projeto (as que valem para toda sessão: comandos de verificação,
  restrições de dependência, "escopo é escopo") ficam no topo de `Roadmap-e-Sessoes.md` e
  são repetidas por referência em cada prompt.

### Critério de escolha de modelo (obrigatório por sessão)

Toda sessão declara o modelo no cabeçalho com uma justificativa de 1–3 frases ("Por que
<modelo>"). Escolha pelo **perfil de risco da tarefa**, não pelo tamanho:

| Perfil da tarefa | Tier | Modelo atual |
|---|---|---|
| Invariantes cujo erro corrompe dados em silêncio; combinatória com casos de borda que não aparecem em teste; perda de trabalho do usuário como modo de falha (undo, persistência, merge, conflito); migração de schema já publicado; design de algoritmo/otimização; diff e comparação semântica; orquestração e priorização com matemática de borda | **Máximo** | `Opus` (ou o topo de linha vigente) |
| Transcrição fiel de contrato já fechado na documentação; CRUD versionado; composição de telas sobre padrões consolidados; parsers de formato já especificado; integrações ponto a ponto | **Intermediário** | `Sonnet` |
| Sincronização documental mecânica; CRUD de entidade única sem regra; renomeações e boilerplate | **Econômico** | `Haiku` |

Regras de segurança do critério:

- Na dúvida entre dois tiers, suba — o custo de re-executar uma sessão corrompida supera
  a economia.
- **Válvula de escape**: todo prompt de tier Intermediário/Econômico instrui: "se aparecer
  decisão de arquitetura não coberta pela documentação, **pare e pergunte**" — é isso que
  torna seguro usar modelos menores.
- Se os nomes de modelo mudarem, o critério permanece: mapeie os tiers para a família
  vigente e registre o mapeamento em `Roadmap-e-Sessoes.md`.

## Fase 4 — Executar uma sessão

Ao executar (ou preparar a execução de) uma sessão:

1. Conversa **nova**, na raiz do repositório, com o modelo indicado (`/model`).
2. Cole o prompt inteiro do arquivo da sessão.
3. A sessão lê as páginas indicadas antes de escrever código; escopo é escopo — não
   implementar sessões futuras "já que está aqui".
4. Encerramento: verificações do projeto verdes (lint, typecheck, testes, build),
   documentação atualizada (fase 5), commit descritivo na branch de trabalho, push, PR.
5. Atualize a linha da sessão em `Roadmap-e-Sessoes.md` (status, data, PR).

## Fase 5 — Sincronizar a documentação

Checklist obrigatório antes de encerrar qualquer sessão que mudou comportamento:

- [ ] Páginas `Funcionalidade-*` afetadas refletem o comportamento novo (texto, US,
      critérios, cenários)?
- [ ] `Modelo-de-Dados.md` atualizado (com nota de migração se schema publicado mudou)?
- [ ] Decisões tomadas durante a sessão registradas em `Decisoes.md`?
- [ ] `Roadmap-e-Sessoes.md` com o status da sessão?
- [ ] `Home.md`/`_Sidebar.md` apontam para páginas novas?

A Action publica tudo na Wiki no merge para a branch padrão — nenhum passo manual.

## Bootstrap de um repositório novo (ou adoção em repositório existente)

1. Crie `docs/wiki/` com `Home.md`, `_Sidebar.md` e `Visao-e-Escopo.md` (produto da fase 1).
2. Copie `assets/sync-wiki.yml` desta skill para `.github/workflows/sync-wiki.yml`.
3. **Habilite a Wiki** nas configurações do repositório e crie a primeira página pela
   interface (qualquer conteúdo) — o repositório git da Wiki só passa a existir depois
   disso; sem esse passo a Action falha no clone.
4. Rode as fases 2–3 para o primeiro épico; primeira sessão só depois da doc pronta.
5. No `CLAUDE.md` do projeto, mantenha um índice enxuto apontando para as páginas
   normativas — nunca duplique conteúdo da Wiki nele.

## Recursos desta skill

| Arquivo | Quando ler/usar |
|---|---|
| `references/template-pagina-funcionalidade.md` | Ao criar/atualizar página de funcionalidade (US, critérios, Gherkin) |
| `references/template-prompt-sessao.md` | Ao escrever qualquer prompt de sessão |
| `references/template-roadmap.md` | Ao criar `Roadmap-e-Sessoes.md` ou replanejar sessões |
| `references/template-decisoes.md` | Ao registrar uma DEC/ADR |
| `assets/sync-wiki.yml` | Copiar para `.github/workflows/` no bootstrap (workflow pronto) |
