# Sessão 27 — Modo `SERVER` no front

**Modelo: `Sonnet`** · **Depende de:** S26 · **Épico: Plataforma · Marco M7**

> **Por que Sonnet:** transcrição de um contrato fechado (`StorageAdapter` +
> `docs/14-plataforma-local.md` §4) para um terceiro adapter, com os dois adapters existentes e
> a suíte de contrato deles como gabarito. Nenhuma invariante nova, nenhuma combinatória.

---

## Prompt

> Você está implementando a Sessão 27 do Policy Matrix Studio — o modo `SERVER`: a SPA passa a
> reconhecer quando foi servida pelo servidor local e a persistir através dele.
>
> **Leia antes de começar:** `docs/14-plataforma-local.md` §4–§5 e §8 (contrato da API, token e
> modos), `docs/06-persistencia-e-concorrencia.md` §1–§2 e §5 (capabilities, interface do
> adapter e semântica de conflito), `docs/13-decisoes.md` ADR-002. Não tome decisão de
> arquitetura fora do documentado — **pare e pergunte**.
>
> ### Estado atual
> A S26 entregou o servidor em `server/` com pytest verde: API v1 de documento/lock/backups,
> token por boot e `whoami` devolvendo papéis fixos. O front ainda só conhece
> `fsa-adapter`/`download-adapter`, e `capabilities.ts` só conhece `FULL`/`DOWNLOAD_ONLY`.
>
> ### Objetivo
> Abrir a aplicação pelo servidor local e trabalhar o dia inteiro sem nenhum download: abrir,
> salvar, conflito, merge e lock rodando pela API, em qualquer navegador.
>
> ### Escopo
>
> #### 1. Detecção — `src/storage/capabilities.ts`
> Novo campo `localServer` e modo `SERVER`, conforme `docs/06` §1: token lido de `?t=` na URL
> (guardado em `sessionStorage` e removido da barra de endereço via `history.replaceState`) +
> `fetch('/api/health')` respondendo com `X-PolicyOps-Api` ≤ 1. API maior que a do front →
> tratar como sem servidor e explicar na tela inicial (mesma regra do `schemaVersion`). Ordem de
> preferência fixa `SERVER → FULL → DOWNLOAD_ONLY`.
>
> #### 2. `src/storage/server-adapter.ts`
> Implementa `StorageAdapter` sobre `fetch` com `X-PolicyOps-Token`: `open()` → `GET
> /api/document`; `save()` → `PUT` com `baseHash`, traduzindo `409` em `{ ok: false, reason:
> 'CONFLICT', remote }` e `423` no fluxo de lock existente; `reloadCurrent()` → novo `GET`;
> `saveAs()` indisponível neste modo (o arquivo é fixo — esconda a opção como já se faz com
> recursos ausentes). Lock: `src/storage/lock.ts` ganha a variante via API, mesmo formato em
> disco. Erros de rede local (`fetch` falhou = servidor caiu) → `{ ok: false, reason: 'IO' }`
> com mensagem clara ("o servidor local foi fechado?") e o autosave do IndexedDB continua
> protegendo o trabalho.
>
> #### 3. Tela inicial e shell
> No modo `SERVER`: abre o documento da pasta direto (sem seletor), mostra "Conectado à pasta
> \\…\Politicas como {username}" usando `GET /api/whoami`, e o diálogo "como você quer ser
> identificado?" não aparece (`docs/02` §6). Banner de lock e fluxo de conflito/merge são os
> existentes — **não duplique componente nenhum**.
>
> ### Testes
> - Suíte de contrato de `StorageAdapter` rodando também contra o `server-adapter` (servidor
>   falso via `fetch` mockado): mesmos casos dos outros adapters + tradução de `409`/`423`/rede.
> - `capabilities`: com `/api/health` → `SERVER`; sem → cadeia atual; API maior → sem servidor.
> - E2E (Playwright): sobe o servidor real da S26 contra pasta temporária e roda
>   abrir → editar → salvar → reabrir → conflito simulado (gravação externa no arquivo) → merge.
>
> ### Critérios de aceite
> - Ciclo completo sem nenhum download ou seletor de arquivo no modo `SERVER`.
> - Duplo clique no mesmo `dist/PolicyOps.html` continua caindo em `DOWNLOAD_ONLY` intacto.
> - Verificações do projeto verdes, orçamento de 1,5 MB respeitado, `dist/PolicyOps.html`
>   atualizado no commit.
>
> ### Fora do escopo
> Launcher e `.bat` → S28 (rode o servidor na mão). Papéis na interface → S29. Evidências → S30.
>
> ### Atualização da documentação (obrigatório)
> `docs/06-persistencia-e-concorrencia.md` e `docs/14-plataforma-local.md` §8 se o contrato se
> refinar; `docs/10-guia-do-usuario.md` (o que muda para o usuário nos três modos); linha da
> S27 no roadmap; DEC nova se decidir algo.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md` — atenção à regra 5 na forma nova: a única requisição
> permitida é ao próprio `127.0.0.1`.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
