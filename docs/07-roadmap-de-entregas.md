# Roadmap de Entregas

14 sessões incrementais. Cada uma termina com algo que roda, testado e commitado.

## Quadro geral

| # | Sessão | Modelo | Entrega verificável | Depende de |
|---|--------|--------|---------------------|-----------|
| 01 | Scaffold e infraestrutura | **Sonnet** | `pnpm dev` sobe, login funciona, CI verde | — |
| 02 | Schema, migrations e seed | **Sonnet** | `pnpm db:reset` cria e popula o banco | 01 |
| 03 | Camada de domínio: versionamento e snapshot | **Opus** | Services + 100% de testes das invariantes | 02 |
| 04 | Biblioteca de Variáveis | **Sonnet** | CRUD completo com versionamento de domínios | 03 |
| 05 | Biblioteca de Conteúdo | **Haiku** | CRUD do catálogo | 03 |
| 06 | Projetos e criação de matrizes | **Sonnet** | Criar matriz escolhendo eixos; grid read-only | 03,04,05 |
| 07 | Grid do editor e engine de seleção | **Opus** | Todas as interações de seleção da §3.2 | 06 |
| 08 | Inspector, edição em massa e undo/redo | **Opus** | Editar 50 células de uma vez, desfazer | 07 |
| 09 | Fluxo de versionamento na UI | **Sonnet** | Rascunho → publicar → histórico → auditoria | 08 |
| 10 | Engine de diff e tela de comparação | **Opus** | Comparar v1×v2 nos 3 modos, com resumo | 09 |
| 11 | Vigência por data e viewer | **Sonnet** | "Como estava em 15/03/2026" | 09 |
| 12 | Reconciliação de evolução de variáveis | **Opus** | Adotar nova versão de variável num rascunho | 09 |
| 13 | Templates | **Sonnet** | Criar matriz a partir de template com seed rules | 12 |
| 14 | Exportação, polimento e E2E | **Haiku** | CSV/JSON/PNG, estados vazios, suíte E2E | 13 |

## Por que cada modelo

**Opus** nas sessões 03, 07, 08, 10 e 12. São as que envolvem invariantes que, se saírem erradas, corrompem dados silenciosamente (03, 12), ou máquinas de estado de interação com muitos casos de borda que não aparecem em teste automatizado (07, 08), ou lógica combinatória com semântica de negócio (10).

**Sonnet** nas sessões 01, 02, 04, 06, 09, 11 e 13. São transcrição fiel de especificação, CRUD e composição de telas a partir de contratos já definidos. A decisão de arquitetura já está tomada nos documentos.

**Haiku** nas sessões 05 e 14. CRUD simples e trabalho mecânico de acabamento.

> Se durante uma sessão Sonnet/Haiku aparecer uma decisão de arquitetura não coberta pela documentação, a instrução é **parar e perguntar**, não improvisar. Isso está escrito em todos os prompts.

## Marcos utilizáveis

| Marco | Após a sessão | O que já dá para fazer |
|-------|---------------|------------------------|
| **M1 — Bibliotecas prontas** | 05 | Cadastrar todas as variáveis e ofertas reais da empresa |
| **M2 — Editor funcionando** | 08 | Montar as matrizes de verdade e editá-las |
| **M3 — MVP publicável** | 11 | Usar como fonte oficial: versionar, publicar, comparar, consultar |
| **M4 — MVP completo** | 14 | Escala: templates, evolução de variáveis, exportação |

M3 é o ponto em que a ferramenta já substitui o Excel. As sessões 12–14 são o que a torna sustentável em escala.

## Como conduzir cada sessão

1. Abrir uma sessão nova do Claude Code na raiz do repositório.
2. Selecionar o modelo indicado (`/model`).
3. Colar o conteúdo de `docs/prompts/SXX-*.md`.
4. Ao final, conferir os critérios de aceite listados no próprio prompt antes de commitar.

Uma sessão por vez, na ordem. As dependências na tabela acima não são sugestão — pular a sessão 03 e ir direto para a 07 produz um editor que corrompe versões publicadas.

## Estimativa de esforço

Nenhuma sessão foi dimensionada para caber num único turno de conversa. As de Opus (03, 07, 08, 10, 12) tendem a precisar de idas e vindas; as demais costumam sair em uma passada. Se uma sessão estiver crescendo demais, o prompt já indica onde é seguro cortar.
