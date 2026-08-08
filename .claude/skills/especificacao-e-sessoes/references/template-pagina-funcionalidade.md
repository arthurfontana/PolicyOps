# Template — Página de Funcionalidade (`Funcionalidade-<Nome>.md`)

Uma página por domínio funcional. É o retrato vivo daquele domínio: descreve **como o
sistema se comporta hoje** (e, em seções marcadas `🔮 Planejado`, o desejado ainda não
construído). Nunca descreve como o sistema "era" — histórico fica no git da Wiki e no log
de sessões.

Preencha todas as seções; marque explicitamente "Não se aplica" em vez de omitir — a
ausência silenciosa de uma seção é o que gera a pergunta que o handoff deveria evitar.

```markdown
# <Nome da Funcionalidade>

> **Estado**: ✅ Em produção | 🚧 Em construção (sessões S12–S14) | 🔮 Planejado
> **DECs relacionadas**: DEC-XX-001, DEC-XX-004
> **Última sessão que alterou esta página**: S14 (PR #27)

## 1. O que é e para quem

2–4 parágrafos na linguagem do negócio: o problema que resolve, quem usa, onde entra no
fluxo maior do produto. Um analista da área entende esta seção sem glossário.

## 2. Histórias de usuário

### US-01 — <título curto>
**Como** <papel>, **quero** <ação> **para** <valor de negócio>.

**Critérios de aceitação:**
- Critério verificável e binário (dá para responder sim/não olhando o sistema)
- Inclua limites numéricos concretos ("máx. 10 ports", "responde em < 150 ms")
- Inclua o comportamento de erro ("CSV sem cabeçalho → aviso X, importação continua")

### US-02 — ...

## 3. Cenários de teste (Gherkin)

Somente para fluxos com regra de negócio, invariante ou caso de borda — onde ordem e
estado importam. CRUD trivial e polimento visual ficam apenas com os critérios da US.

### CT-01 — <título> (cobre US-01)
```gherkin
Dado   um documento com duas versões publicadas V1 e V2
  E    V2 removeu o domínio "Varejo" do eixo X
Quando o usuário compara V1 com V2
Então  as células de "Varejo" aparecem como REMOVIDAS
  E    o resumo exibe "N células fechadas"
  E    nenhuma célula idêntica aparece no resultado
```

### CT-02 — <caso de borda> (cobre US-01)
Todo cenário de borda que já virou bug ou discussão ganha um CT — é a memória
institucional do que não pode regredir.

## 4. Regras de negócio e invariantes

Lista numerada (RN-01, RN-02…) das regras que valem sempre, com a consequência da
violação. Ex.: "RN-03: limite efetivo = `limitOverride ?? valor do catálogo`, comparado
em Decimal — nunca em ponto flutuante. Violação corrompe comparações históricas."

## 5. Especificação técnica

- **Módulos/arquivos**: onde vive o código deste domínio.
- **Contratos**: assinaturas de tipos/funções públicas, formatos de mensagem/arquivo.
- **Modelo de dados**: campos que este domínio acrescenta às entidades (link para
  `Modelo-de-Dados.md` — não duplique o schema aqui).
- **Desempenho**: orçamentos com número e como são medidos.
- **Erros**: catálogo código → mensagem → ação do usuário.

## 6. Interface (se houver)

Telas/estados com o suficiente para reconstruir sem ver o original: layout em texto ou
captura, estados vazios, loading, erro, atalhos. Referencie componentes reutilizados.

## 7. Fora do escopo

O que esta funcionalidade deliberadamente NÃO faz, com a DEC que justifica quando
existir. Evita que o time de TI "complete" o que foi omitido de propósito.
```

## Regras de manutenção

- IDs (`US-`, `CT-`, `RN-`) são estáveis: nunca renumere ao remover — aposente o ID
  ("US-07: removida pela DEC-XX-009") na própria seção por uma versão e apague depois.
- Ao alterar comportamento, edite a US/CT/RN existente em vez de adicionar variante nova
  ao lado — a página descreve um único estado do sistema.
- Cenários CT são a ponte para os testes automatizados: a sessão que implementa deve
  citar quais CTs cobre na seção "Testes" do prompt.
