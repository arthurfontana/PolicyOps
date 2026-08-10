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

E, dada a restrição corporativa, ela é uma coisa muito específica: **um único arquivo `.html` que roda no navegador sem instalar nada**, colocado numa biblioteca do SharePoint, que qualquer pessoa do time abre, edita e salva.

O que ela **não** é: motor de decisão, integração com PowerCurve, workflow de aprovação, editor colaborativo em tempo real.

## 3. As duas restrições que definem a arquitetura

### 3.1 Zero instalação

Não há servidor, não há banco de dados, não há Node rodando na máquina de ninguém. A aplicação inteira é um arquivo HTML autocontido (`PolicyOps.html`, ~500 KB) com todo o JavaScript e CSS embutidos, e os dados vivem num arquivo `.json` ao lado dele.

Consequências assumidas:

| Consequência | Como fica |
|---|---|
| Não há login | Cada pessoa informa o próprio nome na primeira abertura; ele carimba as edições e o histórico |
| Não há permissões | Quem abre o arquivo pode editar. Há um modo somente-leitura opcional, por conveniência, não por segurança |
| Não há edição simultânea | Um editor por vez, com aviso de bloqueio e detecção de conflito no salvamento |
| Backup e versionamento do arquivo | Ficam por conta do histórico de versões do SharePoint |

### 3.2 Eixos aninhados

Um eixo não é uma variável — é uma **pilha de até 3 variáveis**. Exemplo real:

```
                          │        Score HVI3            │
                          │  R1   R2   R3   R4   R5   R6 │
──────────────────────────┼──────────────────────────────┤
 Varejo   │ até 100k      │  ██   ██   ██   ██   ██   ██ │
          │ 100k – 500k   │  ██   ██   ██   ██   ██   ██ │
          │ 500k – 1M     │  ██   ██   ██   ██   ██   ██ │
──────────┼───────────────┼──────────────────────────────┤
 Atacado  │ 500k – 1M     │  ██   ██   ██   ██   ██   ██ │
          │ 1M – 10M      │  ██   ██   ██   ██   ██   ██ │
          │ acima de 10M  │  ██   ██   ██   ██   ██   ██ │
```

Repare que **Varejo não tem faixa acima de 1M e Atacado não tem faixa abaixo de 500k**. Essa não é uma decisão tomada matriz a matriz: é conhecimento sobre o negócio, e por isso vive na biblioteca, como **regra de compatibilidade** entre Segmento e Faixa de Faturamento (§4.3).

## 4. Conceitos centrais

### 4.1 Biblioteca de Variáveis

Variáveis são **entidades independentes e versionadas**, não texto digitado dentro de cada matriz.

```
Score HVI3            ORDINAL      R1 R2 R3 R4 R5 R6
Segmento              CATEGORICAL  Varejo · Atacado · Corporate
Faixa de Faturamento  RANGE        até 100k | 100k–500k | 500k–1M | 1M–10M | acima de 10M
Restritivo            CATEGORICAL  Sem · Baixo · Médio · Alto
Tempo de Empresa      RANGE        até 6m | 6–12m | 1–3a | acima de 3a
```

### 4.2 Biblioteca de Conteúdo (catálogo)

Elementos reutilizáveis nas células: **Ofertas**, **Decisões** (Aprovado, Reprovado, Análise Manual, Exceção) e **Limites**. O usuário seleciona, não digita.

### 4.3 Biblioteca de Compatibilidade

Declara, entre um par de variáveis, quais combinações de domínios existem de verdade:

```
Segmento × Faixa de Faturamento
  Varejo     → até 100k, 100k–500k, 500k–1M
  Atacado    → 500k–1M, 1M–10M, acima de 10M
  Corporate  → 1M–10M, acima de 10M
```

Definida uma vez, vale para todas as matrizes que empilharem essas duas variáveis. É versionada como as demais.

### 4.4 Editor visual

A matriz ocupa o centro da tela, com cabeçalhos aninhados e mesclados. Clicar numa célula abre o painel de propriedades. Seleção múltipla e **edição em massa** — inclusive "selecionar tudo que é Varejo" clicando no cabeçalho do nível de cima — são requisitos de MVP.

### 4.5 Versionamento

Nunca se edita a versão publicada.

```
v12 (Vigente) → criar rascunho → editar → publicar → v13 (Vigente), v12 vira Histórico
```

Toda versão permanece consultável, com intervalo de vigência.

### 4.6 Templates

Configurações reutilizáveis de partida ("Matriz padrão PJ" = Segmento › Faturamento × Score, com paleta e pré-preenchimento).

## 5. O insight estruturante: snapshot

Uma variável é a mesma entidade em dezenas de matrizes. Mas **uma versão publicada não pode mudar retroativamente** — perderíamos o lastro.

Por isso, ao criar um rascunho, a versão da matriz **congela**:

- os domínios de cada variável de cada nível de cada eixo;
- e a **lista resolvida de combinações válidas** de cada eixo (as tuplas), já filtrada pelas regras de compatibilidade.

A biblioteca evolui livremente. Versões publicadas continuam exibindo exatamente o que valia na época. Rascunhos mostram um aviso "há versão mais nova" e o usuário decide, explicitamente, se adota. Ao adotar, as combinações novas nascem vazias e o rascunho **não pode ser publicado** enquanto houver célula sem decisão.

Isso é o que torna a solução escalável de 10 para 500 matrizes.

## 6. Escopo do MVP

| # | Entrega |
|---|---------|
| 1 | Arquivo HTML único, sem instalação, abrindo do SharePoint |
| 2 | Abrir / salvar / salvar como, com autosave e recuperação de queda |
| 3 | Detecção de conflito quando duas pessoas salvam o mesmo arquivo |
| 4 | Cadastro de projetos (cada projeto = uma política) |
| 5 | Biblioteca de variáveis versionada |
| 6 | Biblioteca de compatibilidade entre variáveis |
| 7 | Biblioteca de conteúdo (ofertas, decisões, limites) |
| 8 | Matrizes com eixos de até 3 níveis aninhados |
| 9 | Editor visual com cabeçalhos mesclados |
| 10 | Seleção hierárquica e edição em massa |
| 11 | Versionamento (rascunho → publicado) e histórico completo |
| 12 | Comparação visual entre duas versões |
| 13 | Consulta da configuração vigente em qualquer data |
| 14 | Reconciliação de evolução de variáveis e de compatibilidade |
| 15 | Templates |
| 16 | Merge de documentos em conflito |
| 17 | Exportação (CSV / JSON / PNG / impressão) |

Depois do MVP, duas frentes se somaram a partir de casos reais: a evolução da Biblioteca de Variáveis (faixas com agrupamento hierárquico, colagem de tabela, paletas — sessões 18–20) e a **carga de matrizes a partir da tabela do sistema de origem** ([`12-carga-de-matrizes.md`](12-carga-de-matrizes.md), sessões 21–25), que traz uma extração de milhares de linhas para dentro do documento e, nas cargas seguintes, versiona apenas as matrizes que de fato mudaram.

## 7. Fora do MVP

- Servidor, banco de dados, API.
- Login, permissões por usuário, workflow de aprovação.
- Edição colaborativa simultânea.
- Integração online com PowerCurve, publicação automática no motor, leitura direta do sistema de origem. A carga de matrizes (`12-carga-de-matrizes.md`) não contradiz isto: ela é sempre iniciada por uma pessoa, com um arquivo em mãos, sem nenhuma requisição de rede.
- Mais de 3 níveis por eixo.
- Regras de compatibilidade que dependam de mais de dois níveis simultaneamente (ver limitação em `04-eixos-aninhados.md` §5.4).
- Simulador ("dado este cliente, qual célula cai?").

## 8. Premissas assumidas

| Premissa | Decisão |
|---|---|
| Distribuição | Biblioteca do SharePoint (https) ou pasta do OneDrive sincronizada |
| Navegador | Edge ou Chrome corporativo (Chromium 110+). Firefox e Safari funcionam em modo degradado |
| Escala | Centenas de matrizes num único arquivo; alerta em 1.500 células por matriz, teto de 6.000 |
| Tamanho do arquivo de dados | Alvo abaixo de 10 MB; compressão opcional |
| Idioma | Interface e documentação em pt-BR; código em inglês |
| Moeda | BRL, sem multi-moeda |
