# Sessão 29 — Identidade Windows e papéis

**Modelo: `Sonnet`** · **Depende de:** S27 · **Épico: Plataforma · Marco M8**

> **Por que Sonnet:** migração de schema **puramente aditiva** (`meta.acl`, mesmo perfil da S23)
> e composição de telas sobre papéis já fechados em `docs/14-plataforma-local.md` §6. Qualquer
> decisão de enforcement não coberta pela doc: **pare e pergunte**.

---

## Prompt

> Você está implementando a Sessão 29 do Policy Matrix Studio — identidade do Windows carimbando
> tudo, e papéis (`READER`/`EDITOR`/`PUBLISHER`/`ADMIN`) controlando edição e publicação.
>
> **Leia antes de começar:** `docs/14-plataforma-local.md` §6 (a spec desta sessão),
> `docs/03-modelo-do-documento.md` §9–§10 (padrão de invariantes e migração),
> `docs/08-camada-de-comandos.md` (onde os comandos declaram seus efeitos),
> `docs/13-decisoes.md` ADR-003. Não tome decisão de arquitetura fora do documentado — **pare e
> pergunte**.
>
> ### Estado atual
> O modo `SERVER` opera com `whoami` devolvendo `roles: ['PUBLISHER']` fixo (S26). O documento
> está em `schemaVersion: 3`; `savedBy` e auditoria usam o nome digitado do `localStorage`.
>
> ### Objetivo
> Quem abre a aplicação é identificado pelo login de rede sem digitar nada, e um documento com
> ACL definida só aceita publicação/edição de quem tem o papel — com o motivo visível para os
> demais.
>
> ### Escopo
>
> #### 1. Schema e migração — `src/core/document/`
> `schemaVersion: 4`, aditiva: `meta.acl?` exatamente como `docs/14` §6. `validate.ts`: papéis
> válidos, `username` não vazio e único na lista (severidade `ERROR`), e o caso "ACL populada sem
> nenhum `ADMIN`" como `WARNING` (documento externo abre em modo aberto com aviso — a invariante
> dura é de interface). Migração 3→4 não escreve `acl` (ausente = modo aberto).
>
> #### 2. Identidade — store + shell
> No modo `SERVER`, a identidade vem de `GET /api/whoami` e o diálogo de nome não aparece;
> `savedBy`, eventos de auditoria e lock passam a registrar `{ username, displayName?, source:
> 'windows' }`. Nos outros modos, mantém o nome digitado com `source: 'typed'`. Registro no
> formato novo é retrocompatível: eventos antigos (string simples) continuam legíveis no
> histórico — **não migre eventos**.
>
> #### 3. Papéis efetivos — `src/core/` puro
> `resolveRole(doc, username): Role` (ACL ausente/vazia → `PUBLISHER`; listado → papel da lista;
> não listado → `defaultRole`). Gate central na camada de comandos: cada comando declara o papel
> mínimo (tabela de `docs/14` §6 — rascunho/biblioteca/tags = `EDITOR`; publicar, aplicar carga,
> arquivar/restaurar = `PUBLISHER`; `acl/set` = `ADMIN`), e o dispatcher recusa com erro tipado
> `ROLE_REQUIRED` antes de executar. Comando novo `acl/set` com inverso exato e evento
> `ACL_CHANGED { before, after }`.
>
> #### 4. Servidor — `server/`
> `whoami` passa a derivar `roles` de `meta.acl` do documento em disco; `PUT /api/document` de
> papel efetivo `READER` → `403` (`docs/14` §4). O servidor **não** re-deriva permissões por
> comando (ADR-003) — a camada fina é o dispatcher do front.
>
> #### 5. Interface
> Tela de administração da ACL (atrás de `ADMIN`): lista, papel, `defaultRole`, com a invariante
> "nunca ficar sem ADMIN" travada no botão. Ações desabilitadas mostram o motivo ("requer papel
> PUBLISHER — você é EDITOR"). Identidade visível no shell. Texto honesto de `docs/14` §6 na
> tela da ACL: é organização, não segurança.
>
> ### Testes
> - `resolveRole` e o gate: cada linha da tabela de papéis, caso permitido e caso recusado.
> - Migração 3→4 com fixture real de v3 e cadeia 1→4.
> - `validate`: casos válido/inválido das invariantes novas.
> - pytest: `403` para `READER`; `whoami` com ACL ausente, vazia e populada.
> - E2E: com ACL definindo um `READER`, a interface abre em consulta e o save é recusado nas
>   duas camadas.
>
> ### Critérios de aceite
> - Documento v3 existente abre sem mudança de comportamento (modo aberto).
> - Publicação recusada para `EDITOR` com motivo visível; auditoria carimbada com o login real.
> - Verificações do projeto verdes (incluindo pytest); `dist/PolicyOps.html` atualizado.
>
> ### Fora do escopo
> Evidências → S30. Workflow de aprovação com etapas — fora de escopo do produto
> (`docs/01` §7). Autenticação SSPI/Kerberos de verdade — descartada em ADR-003.
>
> ### Atualização da documentação (obrigatório)
> `docs/03-modelo-do-documento.md` (schema 4 + invariantes + nota de migração),
> `docs/08-camada-de-comandos.md` (papel mínimo por comando), `docs/07-ux-e-editor.md` (tela de
> ACL), `docs/14` §6 se o contrato se refinar, linha da S29 e marco M8 no roadmap, DEC nova se
> decidir algo.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
