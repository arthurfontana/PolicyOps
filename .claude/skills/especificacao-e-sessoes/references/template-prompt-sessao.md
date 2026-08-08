# Template — Prompt de Sessão (`Sessoes/S<NN>-<slug>.md`)

Um arquivo por sessão. O prompt é **incremental**: aplica uma mudança específica sobre o
que já existe, referenciando a versão vigente da documentação — nunca repete a spec
inteira. Se você está colando parágrafos da Wiki no prompt, o conteúdo está no lugar
errado: aponte para a página e a seção.

```markdown
# Sessão NN — <título>

**Modelo:** `<Opus|Sonnet|Haiku>` · **Depende de:** S<MM> · **Épico/Marco:** <ref>

> **Por que <modelo>:** 1–3 frases ligando o perfil de risco da tarefa ao tier
> (invariante que corrompe dados? transcrição de contrato fechado? sincronização
> mecânica?). Se não conseguir justificar em 3 frases, reavalie o tier.

## Prompt

> Você está implementando a Sessão NN de <projeto> — <tema>.
>
> **Leia antes de começar:** `Funcionalidade-<X>.md` §2–§4 (US e cenários que esta
> sessão implementa), `Arquitetura.md` (restrições normativas), `Modelo-de-Dados.md`
> §<n> (entidades tocadas). <Somente as páginas/seções relevantes — leitura dirigida,
> não "leia o projeto inteiro".>
>
> ### Estado atual
> 2–5 linhas: o que já existe e onde (módulos, sessões anteriores relevantes). É o que
> torna o prompt executável numa conversa nova, sem arqueologia.
>
> ### Objetivo
> Uma frase: o que o usuário consegue fazer ao final que não conseguia antes.
>
> ### Escopo
> Blocos numerados do trabalho (motor, tela, integração…), com os contratos-chave
> inline (assinaturas de tipos, nomes de arquivos) e as decisões já tomadas
> referenciadas por DEC. Instruções de reuso explícitas ("reaproveite o componente X
> acrescentando a prop Y — não duplique").
>
> ### Testes
> Lista do que a suíte deve cobrir, incluindo **quais CTs da página de funcionalidade
> esta sessão faz passar** (CT-03, CT-05…) e os casos de borda um a um.
>
> ### Critérios de aceite
> - Verificáveis e binários, na linguagem do negócio quando possível.
> - Comandos de verificação do projeto verdes (lint, typecheck, testes, build) e
>   orçamentos respeitados (tamanho, desempenho).
>
> ### Fora do escopo
> O que fica para sessões futuras, nomeando-as ("Exportação → S17; deixe o botão
> desabilitado"). Escopo é escopo: não implementar sessão futura "já que está aqui".
>
> ### Atualização da documentação (obrigatório)
> Atualize no MESMO PR as páginas afetadas: `Funcionalidade-<X>.md` (comportamento,
> US/CT/RN alterados, estado da página), `Modelo-de-Dados.md` (com nota de migração se
> schema publicado mudou), `Decisoes.md` (decisões tomadas nesta sessão) e a linha desta
> sessão em `Roadmap-e-Sessoes.md`. A documentação descreve o sistema como ele fica
> APÓS esta sessão — sem adendos nem "histórico de mudanças" no corpo das páginas.
>
> ### Regras transversais
> Se aparecer decisão de arquitetura não coberta pela documentação, **pare e pergunte**.
> Não adicione dependências fora da lista de `Arquitetura.md` sem perguntar.
> <Demais regras transversais do projeto — referencie `Roadmap-e-Sessoes.md` §Regras.>
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push. <Artefatos de build que o projeto
> exige no commit, se houver.>
```

## Regras de manutenção

- O prompt é escrito na fase de planejamento, mas **revisado imediatamente antes da
  execução**: se a doc mudou desde o planejamento (mudança de escopo entre sessões), o
  prompt é atualizado para apontar o estado vigente — nunca executado obsoleto.
- Sessão executada não se edita mais (é log); correções viram sessão nova.
- Sessão grande demais (> ~5 blocos de escopo) quebra em partes NNa/NNb/NNc com
  critérios de aceite independentes, cada uma executável sozinha.
