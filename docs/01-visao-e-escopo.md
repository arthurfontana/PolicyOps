# Policy Matrix Studio — Visão e Escopo

## 1. O problema

Matrizes de política de crédito (os "cineminhas") hoje vivem em Excel, PowerPoint e imagens. Isso produz:

- incerteza sobre qual é a versão vigente;
- ausência de histórico e de rastreabilidade das alterações;
- dificuldade de compartilhar conhecimento no time;
- esforço alto para manter dezenas ou centenas de matrizes;
- risco de divergência entre a documentação e o motor de crédito.

## 2. O que a ferramenta é

**A fonte oficial das matrizes de política**, com representação visual, versionada, auditável e fácil de consultar.

O que ela **não** é (no MVP): motor de decisão, integração com PowerCurve, ferramenta de aprovação com workflow, editor colaborativo em tempo real.

## 3. Conceitos centrais

### 3.1 Biblioteca de Variáveis (coração da solução)

Variáveis são **entidades independentes e versionadas**, não texto digitado dentro de cada matriz.

```
Score HVI3        tipo ORDINAL      domínios: R1 R2 R3 R4 R5 R6
Faixa de Renda    tipo RANGE        domínios: até 2k | 2k–4k | 4k–6k | acima de 6k
Restritivo        tipo CATEGORICAL  domínios: Sem | Baixo | Médio | Alto
Tempo de Empresa  tipo RANGE        domínios: até 6m | 6–12m | 1–3a | acima de 3a
```

Ao criar uma matriz o usuário escolhe Eixo X e Eixo Y da biblioteca. A matriz nasce pronta, sem digitação.

### 3.2 Biblioteca de Conteúdo (catálogo)

Elementos reutilizáveis nas células: **Ofertas**, **Decisões** (Aprovado, Reprovado, Análise Manual, Exceção) e **Limites** (R$ 500, R$ 1.000, …). O usuário seleciona, não digita.

### 3.3 Editor visual

A matriz ocupa o centro da tela. Cada célula é o cruzamento de um domínio de X com um domínio de Y. Clicar abre o painel de propriedades (decisão, oferta, limite, cor, observação). Seleção múltipla e **edição em massa** são requisitos de MVP, não de fase 2.

### 3.4 Versionamento

Nunca se edita a versão publicada.

```
v12 (Vigente) → criar rascunho → editar → publicar → v13 (Vigente), v12 vira Superseded
```

Toda versão permanece consultável, com intervalo de vigência (`effectiveFrom` / `effectiveTo`).

### 3.5 Templates

Configurações reutilizáveis de partida ("Matriz padrão PF" = Score HVI3 × Restritivo, com paleta e defaults).

## 4. O insight estruturante: snapshot de domínio

Uma variável é a mesma entidade em dezenas de matrizes. Mas **uma versão publicada não pode mudar retroativamente** — perderíamos o lastro.

A solução é: **a versão da matriz congela (snapshot) os domínios do eixo no momento em que o rascunho é criado.**

- A variável evolui livremente na biblioteca (nova versão com R6).
- Versões de matriz já publicadas continuam exibindo exatamente o que valia na época.
- Rascunhos mostram um aviso "há versão mais nova da variável X" e o usuário decide, de forma explícita, se adota a nova versão.
- Ao adotar, as células novas nascem **não preenchidas** e o rascunho **não pode ser publicado** enquanto existirem células não preenchidas.

Isso é o que torna a solução escalável de 10 para 500 matrizes.

## 5. Escopo do MVP

| # | Entrega | Status |
|---|---------|--------|
| 1 | Cadastro de projetos (cada projeto = uma política) | MVP |
| 2 | Biblioteca de variáveis com domínios reutilizáveis e versionados | MVP |
| 3 | Biblioteca de conteúdo (ofertas, decisões, limites) | MVP |
| 4 | Criação de matrizes escolhendo eixos da biblioteca | MVP |
| 5 | Editor visual de células | MVP |
| 6 | Seleção múltipla e edição em massa | MVP |
| 7 | Versionamento (rascunho → publicado) | MVP |
| 8 | Histórico completo de versões + auditoria | MVP |
| 9 | Comparação visual entre duas versões | MVP |
| 10 | Consulta da configuração vigente em qualquer data | MVP |
| 11 | Reconciliação de evolução de variáveis | MVP |
| 12 | Templates | MVP |
| 13 | Exportação (CSV / JSON / PNG) | MVP |

## 6. Fora do MVP (roadmap futuro)

- Workflow de aprovação com papéis e trilha de revisão.
- Edição colaborativa simultânea (multiplayer).
- Permissões granulares por projeto.
- Integração com PowerCurve / publicação automática no motor.
- Importação a partir do motor de crédito.
- Matrizes de 3+ dimensões (hoje: 2 eixos).
- Simulador ("dado este cliente, qual célula cai?").

## 7. Premissas assumidas

Estas decisões foram tomadas para destravar a execução. Alterá-las é barato agora e caro depois da Sessão 03.

| Premissa | Decisão | Como mudar |
|----------|---------|-----------|
| Público | Ferramenta interna, dezenas de usuários, não é produto público | — |
| Escala | Centenas de matrizes; matriz típica ≤ 20×20 células, teto de 40×40 | Acima disso, virtualizar o grid |
| Stack | Next.js full-stack + PostgreSQL (ver `02-especificacao-tecnica.md`) | Trocar antes da Sessão 01 |
| Auth | Login simples por credencial, papéis ADMIN/EDITOR/VIEWER | Trocar por SSO na fase 2 |
| Idioma | Interface e documentação em pt-BR; código e identificadores em inglês | — |
| Moeda | BRL, sem multi-moeda | — |
