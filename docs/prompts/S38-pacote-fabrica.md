# Sessão 38 — Pacote para a Fábrica

**Modelo:** `Sonnet` · **Depende de:** S36 · **Épico/Marco:** Governança (M12)

> **Por que Sonnet:** geração de documento **derivado** a partir de dados já estruturados —
> template + serialização para HTML de impressão e Markdown, sobre a técnica de export que o
> produto já usa. Sem invariante nova; o contrato do layout está em `docs/14` §8 e nos DBs reais.

## Prompt

> Você está implementando a Sessão 38 do PolicyOps — a geração automática do Pacote de
> Implementação enviado à fábrica.
>
> **Leia antes de começar:** `docs/14-governanca-de-alteracoes.md` §8, §6 (RN-GOV-08), §4
> (US-GOV-06), §12 pergunta 3 (boilerplate — se aberta, pare e pergunte); DEC-GOV-006;
> `src/core/export/` (padrões de export existentes).
>
> ### Estado atual
> DBs publicáveis com itens, rascunhos, critérios, testes e vigência (S36). `RichDoc` renderiza no
> editor (S34). Export existente cobre CSV/JSON/PNG/impressão de matriz. `Project` ainda não tem
> `factoryTemplate` na prática (schema da S32a prevê).
>
> ### Objetivo
> Um clique gera, de um DB aprovado, o documento no padrão dos DBs atuais — boilerplate incluído —
> em HTML imprimível e Markdown.
>
> ### Escopo
> 1. **Template do projeto**: edição do `factoryTemplate` (boilerplate em `RichDoc` com o
>    RichDocEditor, contatos/solicitante/interessados) nas configurações do projeto. Semear o
>    documento de exemplo com o boilerplate real (checklist Serasa dos DBs 513/515/519).
> 2. **Gerador** (`src/core/export/factory-package.ts`, puro): DB + template + documento →
>    estrutura do pacote na ordem do §8 (identificação, registro de versão, contatos, boilerplate,
>    contexto, escopo por item com "hoje × proposto", impactos, critérios, testes, vigência,
>    anexos). Disponível a partir de `APPROVED`; sempre regenerado (RN-GOV-08).
> 3. **Saídas**: HTML de impressão (janela dedicada, imagens embutidas, quebras de página entre
>    seções) e download `.md` (imagens referenciadas por nome de anexo + aviso).
> 4. **Entrada na UI**: botão no DB e na release ("gerar pacotes de todos os DBs").
>
> ### Testes
> Snapshot do pacote gerado para o DB-515 reproduzido (fixture) nas duas saídas; DB sem template →
> pacote sem seção de boilerplate, sem erro; regeneração após editar o DB reflete a edição.
>
> ### Critérios de aceite
> - O pacote do DB-515 impresso é aceitável como substituto do Word atual (validação visual com o
>   documento real ao lado).
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes; 1,5 MB ok;
>   `dist/PolicyOps.html` no commit.
>
> ### Fora do escopo
> Export `.docx` (DEC-GOV-006), envio automático a qualquer lugar, edição do pacote gerado.
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/14-governanca-de-alteracoes.md` (US-GOV-06 ✅, resposta da pergunta 3),
> `docs/10-guia-do-usuario.md` (como gerar o pacote), `docs/13-decisoes.md`, linha da S38 em
> `docs/09`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → pare e pergunte.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
