# Template — `Decisoes.md` (ADRs/DECs)

Catálogo numerado das decisões de arquitetura e de produto. É o **porquê** por trás do
retrato vivo: as páginas de funcionalidade dizem *como o sistema é*; as DECs dizem *por
que ficou assim* — inclusive quando uma mudança de escopo reverteu o que estava escrito.

Dois formatos, conforme a escala do projeto:

- **ADR-NNN** — decisões globais de arquitetura (stack, estrutura, padrões).
- **DEC-<ÉPICO>-NNN** — decisões locais de um épico/domínio (ex.: `DEC-EB-004`). Use o
  prefixo do épico para o catálogo escalar sem virar lista única gigante; a página de
  funcionalidade referencia as suas.

```markdown
# Decisões (ADRs e DECs)

## ADR-001: <título da decisão>

**Decisão:** uma frase afirmativa do que foi decidido.

**Contexto:** o problema/pressão que exigiu decisão, incluindo a alternativa que estava
na mesa.

**Justificativa:**
- Argumentos que venceram, em lista.

**Trade-off aceito:** o custo assumido conscientemente — é a parte que evita a mesma
discussão daqui a seis meses.

---

## DEC-XY-001: <título>

| Campo | Conteúdo |
|---|---|
| **Decisão** | resumo em 1–3 frases |
| **Data / gatilho** | quando e o que provocou (pedido do usuário, bug de produção, limitação técnica) |
| **Substitui** | DEC anterior ou comportamento documentado que esta decisão muda, se houver |
| **Páginas afetadas** | `Funcionalidade-X.md` §n, `Modelo-de-Dados.md` §m |
```

## Regras de manutenção

- DEC nunca se apaga nem se edita substantivamente: decisão revertida ganha DEC nova com
  campo **Substitui** apontando a antiga (e a antiga ganha nota "substituída por
  DEC-XY-009" no título). É o único lugar do sistema documental onde histórico é
  bem-vindo.
- Toda mudança de escopo pedida pelo usuário que contraria doc existente gera: (1) DEC
  nova com o gatilho, (2) atualização das páginas afetadas para o novo estado, (3)
  sessão incremental que implementa. Nessa ordem.
- Decisão tomada no meio de uma sessão de execução (dentro do que a doc permite) também
  é registrada — pelo próprio prompt de sessão, na seção de atualização documental.
