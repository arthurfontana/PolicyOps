# Sessão 30 — Evidências: acervo navegável

**Modelo: `Opus`** · **Depende de:** S27, S29 · **Épico: Plataforma · Marco M9**

> **Por que Opus:** evidência de auditoria tem perda e corrupção silenciosa como modos de falha —
> cópia parcial em rede instável, colisão de nome, vínculo apontando para arquivo errado, hash
> divergente não detectado. Errar aqui destrói o valor probatório que justifica a feature.

---

## Prompt

> Você está implementando a Sessão 30 do Policy Matrix Studio — anexar arquivos de evidência
> (DBs, ofícios, estudos) a projetos, matrizes e versões, num acervo navegável na pasta de rede.
>
> **Leia antes de começar:** `docs/14-plataforma-local.md` §7 (a spec desta sessão) e §4 (rotas
> de evidência), `docs/03-modelo-do-documento.md` §9–§10, `docs/13-decisoes.md` ADR-004,
> `docs/11-operacao.md` §1 (regras operacionais do acervo). Não tome decisão de arquitetura fora
> do documentado — **pare e pergunte**.
>
> ### Estado atual
> Modo `SERVER` completo com identidade e papéis (S29, `schemaVersion: 4`). Não existe nenhum
> conceito de anexo; `_evidencias/` não existe.
>
> ### Objetivo
> Anexar um `.docx` a uma versão publicada, vê-lo listado no inspector com quem/quando, abri-lo
> com integridade conferida — e encontrá-lo à mão pelo Explorer em
> `_evidencias/{projeto}/{matriz}/v{n}/`.
>
> ### Escopo
>
> #### 1. Servidor — `server/`
> Rotas de `docs/14` §4: `POST /api/evidences` (multipart; papel mínimo `EDITOR`) copia para o
> caminho legível `{projeto-slug}/{matriz-slug}/v{n}/{AAAA-MM-DD}_{nome original}` (alvo
> `PROJECT` omite os níveis internos), streaming com SHA-256 calculado durante a cópia, escrita
> atômica (`.tmp` + `os.replace`), colisão → sufixo ` (2)`, limite 50 MB → `413` com mensagem
> clara. `GET /api/evidences/{id}` faz stream conferindo o hash registrado — divergência →
> `409 HASH_MISMATCH`. `DELETE` move para `_evidencias/_lixeira/{caminho original}` preservando
> a árvore — **nada jamais é apagado**. O servidor resolve caminhos sempre sob `_evidencias/`
> (rejeite path traversal por construção e por teste).
>
> #### 2. Schema — `src/core/document/`
> `attachments?` exatamente como `docs/14` §7 (ainda `schemaVersion: 4` — campo opcional novo é
> aditivo; confirme com a regra de `docs/03` §10 e **pare e pergunte** se concluir que exige 5).
> Invariantes (`validate.ts`): `target` referencia entidade existente; `sha256`/`relPath` não
> vazios; `relPath` único. Comandos `evidence/attach` e `evidence/detach` com inverso exato e
> eventos `EVIDENCE_ATTACHED`/`EVIDENCE_DETACHED`; detach remove o vínculo e **pede ao servidor
> a mudança para a lixeira só no save bem-sucedido** — nunca antes (undo de detach não pode
> depender de arquivo que já se moveu).
>
> #### 3. Interface
> Seção "Evidências" no inspector de projeto, matriz e versão: anexar (arquivo + nota opcional),
> listar (nome, quem, quando, tamanho), abrir/baixar, desanexar (com confirmação citando a
> lixeira). Anexo em versão publicada é permitido e não altera o snapshot (a lista é
> append-only por alvo — `docs/14` §7). Fora do modo `SERVER`, a seção aparece desabilitada com
> o motivo. Erros da API (413, HASH_MISMATCH, 404 de arquivo movido à mão) em português, com o
> caminho esperado no texto.
>
> ### Testes
> - pytest: todos os casos de evidências de `docs/14` §11 — caminho legível exato, hash,
>   colisão, adulteração → `HASH_MISMATCH`, lixeira preservando árvore, path traversal recusado,
>   413, papel mínimo.
> - Vitest: comandos attach/detach com inverso; invariantes novas; append-only sobre versão
>   publicada (o snapshot não muda — deep equal antes/depois).
> - E2E: anexar em versão publicada → reabrir → abrir o arquivo → adulterar no disco → a
>   aplicação denuncia a divergência.
>
> ### Critérios de aceite
> - O arquivo anexado é encontrável e legível **pelo Explorer**, com nome original, sem a
>   aplicação aberta (ADR-004 — critério central).
> - Desanexar seguido de undo restaura o vínculo sem tocar no arquivo.
> - Verificações do projeto verdes (incluindo pytest); orçamento de 1,5 MB; `dist/PolicyOps.html`
>   atualizado.
>
> ### Fora do escopo
> Pré-visualização/indexação de conteúdo dos anexos; evidências nos modos sem servidor;
> esvaziamento automático da lixeira (ato manual, `docs/11` §1).
>
> ### Atualização da documentação (obrigatório)
> `docs/03-modelo-do-documento.md` (attachments + invariantes), `docs/07-ux-e-editor.md`
> (seção do inspector), `docs/10-guia-do-usuario.md`, `docs/14` §7 se o contrato se refinar,
> linha da S30 e marco M9 no roadmap, DEC nova se decidir algo.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
