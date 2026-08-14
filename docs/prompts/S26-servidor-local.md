# Sessão 26 — Servidor Local: núcleo de persistência

**Modelo: `Opus`** · **Depende de:** — (primeira do épico) · **Épico: Plataforma · Marco M7**

> **Por que Opus:** é a camada onde perda de trabalho é o modo de falha — escrita atômica em
> pasta de rede, detecção de conflito e lock consultivo, o mesmo perfil de risco que exigiu Opus
> na S05, agora num runtime novo (Python) sem código existente servindo de rede de segurança.

---

## Prompt

> Você está implementando a Sessão 26 do Policy Matrix Studio — o servidor local do épico
> Plataforma: o processo Python que passa a fazer todo o I/O contra a pasta de rede.
>
> **Leia antes de começar:** `docs/14-plataforma-local.md` §3–§5, §10–§11 (contrato da API,
> segurança e testes — é a spec desta sessão), `docs/06-persistencia-e-concorrencia.md` §4–§6 e
> §9 (semântica de save, conflito, lock e backup que o servidor reproduz),
> `docs/13-decisoes.md` ADR-001, ADR-002 e ADR-005. Não tome decisão de arquitetura fora do
> documentado — **pare e pergunte**.
>
> ### Estado atual
> Não existe nada em `server/`. A persistência hoje é 100% navegador (`src/storage/`, modos
> `FULL`/`DOWNLOAD_ONLY`). Esta sessão cria o servidor **isolado, com pytest** — o front só o
> conhece na S27; nenhuma linha de TypeScript muda aqui.
>
> ### Objetivo
> `python server/policyops_server.py --data-dir <pasta>` sobe em `127.0.0.1`, serve o
> `PolicyOps.html` e expõe a API v1 de documento/lock/backups com escrita atômica e token,
> comprovada por pytest.
>
> ### Escopo
>
> #### 1. Esqueleto e segurança — `server/policyops_server.py`
> App FastAPI com: escolha de porta livre na faixa 8770–8799; bind exclusivo `127.0.0.1`; token
> aleatório por boot (`secrets.token_urlsafe`) exigido em `X-PolicyOps-Token` para tudo em
> `/api/*` exceto `/api/health` (sem/inválido → `401`); header `X-PolicyOps-Api: 1` em toda
> resposta; estáticos (`GET /` serve o `PolicyOps.html` do diretório do próprio servidor, com
> `Cache-Control: no-cache`); `--data-dir` aponta a pasta dos dados (default: pai do diretório
> do script, sobrescrevível por `config.json` ao lado). Nenhuma requisição de saída, nenhum CORS.
>
> #### 2. Documento — `GET/PUT /api/document`
> Conforme `docs/14` §4: leitura devolve `{ raw, hash, bytes, mtime }` (hash SHA-256 do
> conteúdo); gravação recebe `{ baseHash, content }` e reproduz o fluxo de `docs/06` §5 —
> relê o disco, hash divergente → `409 { remoteRaw, remoteHash }` **sem gravar**. Escrita
> atômica obrigatória: `{nome}.tmp` na mesma pasta, `flush` + `os.fsync`, `os.replace`. Antes de
> gravar, cópia do conteúdo anterior para `_backups/{nome}.{timestamp}.json` com rotação de 20
> (`docs/06` §9; falha de permissão em `_backups` avisa no log e não bloqueia). O servidor **não
> valida invariantes do documento** (ADR-002): só JSON sintaticamente válido e envelope correto.
>
> #### 3. Lock consultivo — `POST/DELETE /api/document/lock`
> Mesmo arquivo e formato de `docs/06` §6 (`{nome}.lock.json`, heartbeat, obsoleto aos 10 min),
> para que usuários em modo `FULL` e `SERVER` se enxerguem. `PUT /api/document` com lock ativo
> de outro usuário → `423` (o front decide forçar com `force: true`, espelhando o fluxo atual
> "Editar assim mesmo").
>
> #### 4. Identidade mínima — `GET /api/whoami`
> `getpass.getuser()` + `displayName` opcional vindo de `config.json`. Papéis ficam para a S29:
> aqui devolva `roles: ['PUBLISHER']` fixo (modo aberto), já no formato final do contrato.
>
> #### 5. Backups — `GET /api/backups`
> Lista nome/bytes/mtime de `_backups/`. Sem endpoint de restauração (decisão de `docs/14` §4).
>
> ### Testes (pytest + TestClient, contra `tmp_path`)
> Os de `docs/14` §11 (bloco servidor), exceto os de evidências (S30) e papéis (S29). Em
> especial: conflito verificado **byte a byte** no disco após o `409`; simulação de queda no
> meio da escrita nunca deixa `politicas.json` truncado; rotação exata dos 20 backups; `401`
> sem token; `423` com lock alheio ativo e sucesso com lock obsoleto.
>
> ### Critérios de aceite
> - Subir o servidor contra uma pasta com o `politicas.json` real e fazer um ciclo
>   ler → alterar → gravar → reler via `curl` preservando o conteúdo (roteiro no PR).
> - `python -m pytest server/tests` verde; `pnpm lint && pnpm typecheck && pnpm test:unit &&
>   pnpm build` seguem verdes (nada de TS mudou).
> - `server/requirements.txt` contém somente `fastapi`, `uvicorn`, `python-multipart`.
>
> ### Fora do escopo
> Front (`server-adapter`, detecção de modo) → S27. Launcher/venv/wheels → S28. Papéis reais →
> S29. Evidências → S30. Não crie os `.bat` aqui.
>
> ### Atualização da documentação (obrigatório)
> `docs/14-plataforma-local.md` (qualquer ajuste fino de contrato descoberto na implementação),
> nova DEC em `docs/13-decisoes.md` se alguma decisão for tomada, linha da S26 em
> `docs/09-roadmap-de-entregas.md`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Dependência Python fora da lista fechada exige
> aprovação explícita (ADR-005).
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` inalterado porém
> presente no commit se o build o regenerar.
