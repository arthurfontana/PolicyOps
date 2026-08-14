# Sessão 28 — Launcher e distribuição

**Modelo: `Sonnet`** · **Depende de:** S27 · **Épico: Plataforma · Marco M7 (fecha o marco)**

> **Por que Sonnet:** transcrição de um padrão de launcher/instalação **já validado em produção
> corporativa** no AppCreditoSimulador (ADR-005) — `iniciar.bat` que nunca bloqueia, venv em
> camadas com wheels offline. Composição e empacotamento, sem invariante de dados.

---

## Prompt

> Você está implementando a Sessão 28 do Policy Matrix Studio — o launcher de dois cliques e o
> pacote de distribuição que a TI publica na pasta de rede.
>
> **Leia antes de começar:** `docs/14-plataforma-local.md` §2 e §9 (forma da pasta e instalação
> em camadas), `docs/11-operacao.md` §1 e §4 (o que quem opera a pasta precisa ver funcionando),
> `docs/13-decisoes.md` ADR-005. Não tome decisão de arquitetura fora do documentado — **pare e
> pergunte**.
>
> ### Estado atual
> S26+S27 entregues: o servidor roda por linha de comando e a SPA opera em modo `SERVER`. Falta o
> caminho do usuário final: hoje só quem sabe Python sobe a plataforma. Referência pronta do
> padrão (mesmo ambiente corporativo): `release/iniciar.bat` e `release/python/instalar_motor.bat`
> do repositório AppCreditoSimulador.
>
> ### Objetivo
> Numa máquina limpa com Python 3.9+: `instalar.bat` uma vez, depois `iniciar.bat` — navegador
> aberto na aplicação conectada à pasta de rede, sem nenhuma outra intervenção.
>
> ### Escopo
>
> #### 1. `server/instalar.bat`
> Camadas conforme `docs/14` §9: localizar Python (`py -3`, senão `python`), criar venv em
> `server/.venv/`, para cada linha de `requirements.txt` tentar o índice pip e, em falha, as
> wheels offline (`--no-index --find-links wheels`). Resumo final em português dizendo o que
> instalou e por qual via; falha total instrui sem jargão. Nunca toca o Python do sistema.
>
> #### 2. `server/wheels/`
> Script `scripts/fetch-wheels.mjs` (ou `.py`) que baixa as wheels Windows x64 (`pip download
> --platform win_amd64 --only-binary=:all:`) das três dependências + transitivas, pinadas por
> versão em `requirements.txt`. As wheels **não são commitadas** (tamanho); entram no pacote no
> passo 4. Documente o comando no README do pacote.
>
> #### 3. `server/iniciar.bat`
> Usa `server/.venv/Scripts/python.exe` se existir; senão, orienta a rodar `instalar.bat` e
> lembra o plano B (duplo clique no `PolicyOps.html`) — **nunca instala nada nem bloqueia**.
> Sobe o servidor, espera o `/api/health` responder, abre `http://127.0.0.1:{porta}/?t={token}`
> no navegador padrão e mantém a janela aberta com instrução de encerramento (padrão do
> `iniciar.bat` do AppCreditoSimulador, incluindo `cd /d "%~dp0"`).
>
> #### 4. Pacote — `pnpm build:plataforma`
> Novo script que monta `dist/plataforma/`: `iniciar.bat`, `instalar.bat`, `PolicyOps.html`
> (o build atual) e `server/` (código + `requirements.txt` + `wheels/` baixadas + um
> `LEIAME.txt` de instalação em português espelhando `docs/11` §1). O conteúdo é exatamente o
> `_app/` de `docs/14` §2. `dist/PolicyOps.html` continua sendo gerado e commitado como sempre;
> `dist/plataforma/` **não** é commitado.
>
> ### Testes
> - pytest: resolução de porta ocupada (8770 em uso → 8771), `config.json` sobrescrevendo
>   `--data-dir`, health aguardado pelo launcher.
> - Verificação de pacote: script que confere que `dist/plataforma/` contém tudo e que nenhum
>   arquivo referencia caminho absoluto da máquina de build.
> - Roteiro manual no PR: máquina limpa (ou pasta limpa simulando), instalar → iniciar → editar
>   → salvar → fechar janela → reabrir.
>
> ### Critérios de aceite
> - Dois cliques funcionam com pip **bloqueado** (só wheels) e com pip liberado.
> - `iniciar.bat` sem venv não trava: orienta e sai.
> - Verificações do projeto verdes; `dist/PolicyOps.html` atualizado no commit.
>
> ### Fora do escopo
> Papéis → S29. Evidências → S30. Auto-update do pacote e empacotamento de Python embutido
> (embeddable) — só se um dia o parque não tiver Python.
>
> ### Atualização da documentação (obrigatório)
> `docs/11-operacao.md` §1/§4 e `docs/10-guia-do-usuario.md` com o passo a passo real;
> `docs/14-plataforma-local.md` §9 se o processo se refinar; linha da S28 e o marco M7 no
> roadmap; DEC nova se decidir algo.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Os `.bat` em CP-1252/CRLF sem acentos (padrão do
> AppCreditoSimulador) para não quebrar em `cmd.exe`.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
