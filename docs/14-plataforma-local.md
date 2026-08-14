# Plataforma Local

> Documento normativo do épico **Plataforma** (sessões 26–31). Define o servidor local por
> usuário, o contrato da API, a identidade Windows com papéis e o acervo de evidências.
> O **porquê** de cada escolha está em `13-decisoes.md` (ADR-001 a ADR-006).

## 1. Por que a plataforma mudou de forma

A estratégia original — `PolicyOps.html` aberto direto do SharePoint — dependia da File System
Access API, que só existe em contexto seguro (`https`). No ambiente real, o time abre o arquivo
por caminho de rede ou cópia local (`file://`), onde a origem é opaca e a API nunca está
disponível: **o modo `FULL` nunca funcionou na prática** e todo salvamento caía em
`DOWNLOAD_ONLY`. Ao mesmo tempo, o ambiente real oferece duas coisas que a premissa original
proibia: **pastas de rede compartilhadas** e **Python instalável nas máquinas do time**.

A resposta é mover a responsabilidade de tocar arquivos do navegador para um **servidor local por
usuário**: um processo Python que roda na máquina de quem usa, serve a aplicação em
`http://127.0.0.1` e lê/grava direto na pasta de rede. O navegador nunca mais toca arquivo — e
com isso salvamento direto, lock, backup, conflito, identidade e anexos funcionam em qualquer
navegador (ADR-001, ADR-002).

O que **não** muda: a SPA React/TypeScript inteira, `src/core/` puro, o modelo do documento, o
versionamento e o arquivo `politicas.json` como banco. O servidor entra **por baixo** da
interface `StorageAdapter` — nenhuma regra de negócio se move para o Python.

## 2. A forma do produto

```
\\rede\Politicas\                       ← pasta de rede do time (a "instalação")
   ├── politicas.json                   ← todos os dados (inalterado)
   ├── _backups\                        ← cópias automáticas (agora feitas pelo servidor)
   ├── _evidencias\                     ← acervo de anexos, navegável no Explorer (§7)
   │    ├── credito-varejo\cineminha-digital\v12\2026-08-14_DB-513-Ajuste.docx
   │    └── _lixeira\
   └── _app\                            ← a aplicação, publicada pela TI
        ├── iniciar.bat                 ← o usuário SÓ executa isto
        ├── instalar.bat                ← 1ª vez por máquina (venv em camadas)
        ├── PolicyOps.html              ← o mesmo build de arquivo único de hoje
        ├── server\policyops_server.py  ← servidor FastAPI
        ├── server\requirements.txt
        └── server\wheels\              ← contingência offline do pip (§9)
```

Cada usuário dá dois cliques em `iniciar.bat`; o script sobe o servidor na própria máquina e abre
o navegador. **Um servidor por usuário, todos apontando para a mesma pasta de rede.** Não há
máquina central, serviço para operar nem porta a liberar na rede — a coordenação entre usuários
continua sendo feita pelos arquivos na pasta (hash de conflito + lock consultivo,
`06-persistencia-e-concorrencia.md`), agora executada pelo servidor em vez do navegador.

O mesmo `PolicyOps.html` continua abrindo sozinho, sem Python, no modo degradado
`DOWNLOAD_ONLY` — é o fallback universal e o plano B se o Python de alguma máquina quebrar.

## 3. Stack do servidor

| Camada | Escolha | Justificativa |
|---|---|---|
| Linguagem | Python **3.9+** (o disponível no parque corporativo) | ADR-005 |
| Framework | **FastAPI** + uvicorn | Escolha do produto; instalação garantida pelas wheels offline (§9) |
| Testes | pytest + httpx (`TestClient`) | Cobertura da API sem subir servidor real |
| Dependências | `fastapi`, `uvicorn`, `python-multipart` — **e nada mais** | Cada dependência precisa de wheel Windows embarcada; adicionar exige aprovação (regra 3) |

O servidor vive em `server/` na raiz do repositório, com testes em `server/tests/`. É **um
componente de infraestrutura, não de negócio**: valida token, resolve identidade, faz I/O
atômico e serve arquivos. Ele **nunca interpreta o conteúdo do documento** além do envelope
mínimo (`meta.acl` para papéis, §6) — schema, invariantes e migração continuam sendo assunto
exclusivo de `src/core/` (ADR-002).

## 4. Contrato da API — v1

Handshake: toda resposta carrega `X-PolicyOps-Api: 1`. O front recusa operar contra uma versão de
API maior que a sua (mesma regra do `schemaVersion`: nunca "tentar mesmo assim").

| Método e rota | Faz | Resposta / erros |
|---|---|---|
| `GET /` e estáticos | Serve `PolicyOps.html` | — |
| `GET /api/health` | Ping sem token | `{ app, apiVersion, dataDir, dataFile, started }` |
| `GET /api/whoami` | Identidade da sessão (§6) | `{ username, displayName, roles }` |
| `GET /api/document` | Lê `politicas.json` | `{ raw, hash, bytes, mtime }` · `404` se não existe |
| `PUT /api/document` | Salva com detecção de conflito | Corpo `{ baseHash, content, force? }`. `200 { hash, savedAt, bytes, backup }` · `409 { remoteRaw, remoteHash }` se o hash em disco ≠ `baseHash` · `423 { lock }` se lock ativo de outro usuário e `force` ausente |
| `POST /api/document/lock` | Adquire/renova o lock consultivo | Corpo `{ docRevision?, force? }` · `200 { lock }` · `423 { lock }`. Espelha `{nome}.lock.json` de `06` §6 |
| `DELETE /api/document/lock` | Libera o lock | `200 { released }` · `409 LOCK_NOT_OWNED` — só o próprio dono libera |
| `GET /api/backups` | Lista `_backups/` | `{ backups: [{ name, bytes, mtime }] }`, do mais novo para o mais antigo. Restauração é manual e documentada (`11-operacao.md`) — a API não restaura |
| `POST /api/evidences` | Anexa arquivo (multipart) ao acervo (§7) | `201 { id, relPath, sha256, bytes }` |
| `GET /api/evidences/{id}` | Faz o download/stream do arquivo | `404` se removido; `409 HASH_MISMATCH` se o conteúdo não bate com o hash registrado |
| `DELETE /api/evidences/{id}` | Move o arquivo para `_evidencias/_lixeira/` | Nunca apaga de verdade (§7) |

Regras transversais da API:

- **Salvar continua sendo o documento inteiro** — o servidor não tem endpoints por entidade. O
  modelo de concorrência (hash + merge) permanece o de `06-persistencia-e-concorrencia.md`.
- Toda escrita é **atômica**: grava em `{nome}.tmp` na mesma pasta, `flush` + `fsync`,
  `os.replace`. Queda de rede no meio do save nunca deixa `politicas.json` truncado.
- Antes de todo `PUT /api/document` bem-sucedido, o conteúdo anterior vai para
  `_backups/` (mesma política de 20 cópias de `06` §9), agora sem depender do navegador.
- O servidor **não valida invariantes do documento** — quem valida é o front via
  `src/core/document/validate.ts`, antes de chamar a API (como hoje). O servidor só recusa JSON
  sintaticamente inválido e corpo sem `baseHash`.

### Detalhamento fechado na S26 (DEC-PLAT-001)

- **`content` é texto, não objeto.** O servidor grava exatamente os bytes que o front serializou,
  para que o `hash` devolvido seja o mesmo que o front calculou. Formatação canônica
  (`JSON.stringify(doc, null, 2)`, chaves ordenadas) continua sendo assunto de
  `src/core/document/serialize.ts` — o Python nunca reserializa (ADR-002).
- **`hash` é SHA-256 em hexadecimal** dos bytes do arquivo, idêntico ao `hashDocument()` do front.
  `baseHash: null` significa "eu não vi arquivo nenhum": se já existir um no disco, é `409`.
  Arquivo apagado por outra pessoa também é `409` (com `remoteHash: null`), nunca gravação nova
  silenciosa.
- **Datas** (`mtime`, `savedAt`, `since`, `heartbeat`, `started`) são ISO 8601 em UTC com
  milissegundos e sufixo `Z` — o mesmo formato do `Date#toISOString()` do front.
- **Envelope de erro uniforme**: `{ code, detail, ...extra }`, sempre com `X-PolicyOps-Api`.
  Códigos da v1: `UNAUTHORIZED` (401), `BAD_REQUEST` e `INVALID_JSON` (400), `NOT_FOUND` e
  `HTML_NOT_FOUND` (404), `CONFLICT` (409, com `remoteRaw`/`remoteHash`), `LOCK_NOT_OWNED` (409),
  `LOCKED` (423, com `lock`), `NOT_UTF8` (422), `IO` (500).
- **Lock**: o servidor escreve o mesmo `{nome}.lock.json` do modo `FULL` e acrescenta um campo
  aditivo `username`, que passa a ser o critério de propriedade (o `holder` continua sendo o
  rótulo exibido: `displayName` ou o login). Lock escrito pelo modo `FULL`, sem `username`, é
  reconhecido pelo `holder` — os dois modos se enxergam nas duas direções.
- **Backup**: dois saves dentro do mesmo segundo colidiriam no nome
  (`{nome}.{AAAA-MM-DDThh-mm-ss}.json`); o servidor avança o carimbo de um segundo até achar um
  nome livre em vez de sobrescrever — o formato do nome é compartilhado com o front e não comporta
  sufixo. Falha na pasta `_backups` vira aviso no log e **não** bloqueia o salvamento (`06` §9).
- **Estáticos**: só `GET /` e `GET /PolicyOps.html` são servidos, do diretório do próprio servidor
  — não há árvore de estáticos para percorrer nem caminho arbitrário a pedir. Em checkout de
  desenvolvimento, o servidor aceita o build em `../dist/PolicyOps.html`; `--html` aponta um
  arquivo explícito.
- **Configuração**: precedência linha de comando > `config.json` ao lado do servidor > padrão
  (`--data-dir` cai no pai do diretório do script, `--data-file` em `politicas.json`). Chaves
  reconhecidas no `config.json`: `dataDir`, `dataFile`, `displayName`, `html`. Arquivo ausente ou
  inválido é ignorado com aviso — configuração errada não impede o servidor de subir.

## 5. Segurança do processo local

Herdada do padrão validado no AppCreditoSimulador (ADR-005):

- Bind **exclusivo em `127.0.0.1`**, porta livre escolhida na faixa 8770–8799. Nada escuta na
  rede; outro colega não alcança o seu servidor.
- **Token aleatório por boot**: o launcher abre `http://127.0.0.1:{porta}/?t={token}`; o front
  guarda o token e o envia em `X-PolicyOps-Token` em toda chamada `/api/*` (exceto `/api/health`).
  Requisição sem token válido: `401`.
- **Zero rede externa**: o servidor não faz nenhuma requisição de saída; a SPA continua
  autocontida. A regra "zero requisições de rede" do produto passa a ser lida como **"zero
  requisições externas"** — a única comunicação permitida é com o próprio `127.0.0.1` (ADR-002).
- Sem CORS: a SPA é servida pela mesma origem da API.

Isso é proteção de processo local, não perímetro de segurança corporativo: quem tem acesso de
escrita à pasta de rede sempre poderá editar `politicas.json` na mão. A interface e a
documentação continuam honestas sobre isso (§6).

## 6. Identidade e papéis

### Identidade

O servidor resolve o usuário **uma vez, no boot**, pelo login de rede do Windows
(`getpass.getuser()`), e o carimba em toda operação. O diálogo atual "como você quer ser
identificado?" deixa de existir no modo `SERVER`: `savedBy`, eventos de auditoria, lock e
evidências passam a registrar `{ username, displayName }` — `username` é o login (imutável),
`displayName` é opcional e editável (apenas cosmético). Nos modos sem servidor, o comportamento
atual (nome digitado) permanece, e a auditoria marca a procedência: `source: 'windows' | 'typed'`.

### Papéis

O documento ganha, no `meta`, uma ACL (`schemaVersion: 4`, migração puramente aditiva):

```ts
meta.acl?: {
  users: Array<{ username: string; role: 'READER' | 'EDITOR' | 'PUBLISHER' | 'ADMIN' }>;
  defaultRole: 'READER' | 'EDITOR';   // papel de quem não está na lista
}
```

| Papel | Pode |
|---|---|
| `READER` | Abrir, consultar, comparar, exportar |
| `EDITOR` | + criar/editar rascunhos, biblioteca, tags |
| `PUBLISHER` | + publicar versões, aplicar carga, restaurar/arquivar matriz |
| `ADMIN` | + editar a própria ACL |

Regras:

- **ACL ausente ou vazia = modo aberto** (todos `PUBLISHER`) — compatibilidade com o documento
  existente e com times que não querem controle. O controle liga quando um `ADMIN` é definido.
- Enforcement em duas camadas: a **interface** desabilita o que o papel não permite (com o
  motivo visível), e o **servidor** recusa `PUT /api/document` de quem tem papel efetivo
  `READER` (`403`). O servidor não re-deriva permissões finas por comando — a camada fina é da
  aplicação. É controle de acidente e de organização, não defesa contra usuário malicioso
  (que sempre poderá editar o arquivo na mão; §5).
- A ACL nunca pode ficar sem `ADMIN` por edição da própria tela (invariante de interface); um
  documento externo que chegue assim abre em modo aberto com aviso.
- Toda mudança de ACL gera evento de auditoria (`ACL_CHANGED`, com antes/depois).

## 7. Evidências — o acervo navegável

Necessidade: anexar às políticas os arquivos que as justificam (DBs, ofícios, e-mails exportados,
planilhas de estudo). Decisões de forma (ADR-004):

- **Anexar = copiar.** O arquivo é copiado para `_evidencias/` na pasta de rede; o original do
  usuário não é referenciado. Link nunca quebra porque o acervo pertence à aplicação.
- **O acervo é navegável por humanos.** Estrutura de pastas legível
  (`{projeto}/{matriz}/{versão}/`) e nome de arquivo preservado com prefixo de data
  (`2026-08-14_DB-513-Ajuste.docx`). **Nada de criptografia, nada de nome opaco**: se a
  aplicação quebrar, o time abre a pasta no Explorer e os arquivos históricos estão lá,
  utilizáveis. A aplicação é a porta de entrada preferencial, não a única.
- **Evidência é imutável e nunca some.** Não existe "editar anexo" (anexa-se outra versão) e
  `DELETE` move para `_evidencias/_lixeira/{caminho original}` — o desanexo tira o vínculo do
  documento, não o arquivo do mundo. Esvaziar a lixeira é ato manual de quem opera a pasta.
- **Integridade por hash.** O servidor calcula SHA-256 na cópia; o documento guarda o hash; o
  download confere e denuncia divergência (`HASH_MISMATCH`) — é o que dá valor de auditoria ao
  acervo sem esconder os arquivos.

No documento (`schemaVersion: 4`, aditivo):

```ts
attachments?: Array<{
  id: string;                 // nanoid
  fileName: string;           // nome original
  relPath: string;            // caminho relativo dentro de _evidencias/
  sha256: string;
  bytes: number;
  addedBy: { username: string; displayName?: string };
  addedAt: string;            // ISO
  note?: string;
  target:                     // a que a evidência está presa
    | { kind: 'PROJECT'; projectId: string }
    | { kind: 'MATRIX'; matrixId: string }
    | { kind: 'VERSION'; matrixId: string; versionNumber: number };
}>
```

Regras de negócio:

- Anexo em **versão publicada é permitido** (é o caso típico: a evidência chega depois da
  publicação) e não fere a imutabilidade da versão: `attachments` vive fora do snapshot, como os
  eventos de auditoria — a lista de anexos é append-only por alvo.
- Colisão de nome no mesmo diretório recebe sufixo ` (2)`, ` (3)`… — nunca sobrescreve.
- Limite de tamanho por arquivo: **50 MB** (recusa com mensagem clara); sem restrição de tipo,
  mas a interface avisa que o conteúdo não é lido nem indexado pela aplicação.
- Anexos aparecem no inspector do alvo e o evento `EVIDENCE_ATTACHED` / `EVIDENCE_DETACHED`
  entra na auditoria.

## 8. Modos de operação do front

`capabilities.ts` ganha o terceiro modo, e a ordem de preferência é fixa:

| Modo | Quando | O que dá |
|---|---|---|
| **`SERVER`** | SPA servida pelo servidor local (`fetch('/api/health')` responde e o token está presente) | Tudo: salvar direto na rede, conflito, lock, backups, identidade Windows, papéis, evidências |
| **`FULL`** | Sem servidor, mas com File System Access API utilizável | O que já existe hoje (mantido por custo ~zero; cenário OneDrive/https) |
| **`DOWNLOAD_ONLY`** | Duplo clique no HTML sem Python | Fallback universal: abrir por seletor, salvar por download; sem evidências |

O modo `SERVER` entra pela interface existente: `server-adapter.ts` implementa `StorageAdapter`
sobre `fetch` — `save()` traduz `409` em `{ ok: false, reason: 'CONFLICT', remote }` e o fluxo de
conflito/merge da aplicação **não muda uma linha**. Funcionalidades exclusivas do servidor
(evidências, whoami, papéis) ficam atrás de um `ServerFeatures` opcional que os componentes
consultam; nos outros modos os pontos de entrada aparecem desabilitados com o motivo.

## 9. Distribuição e instalação

Padrão de instalação em camadas do AppCreditoSimulador, que já opera no mesmo ambiente
corporativo (ADR-005):

- **`instalar.bat`** (uma vez por máquina): localiza o Python (`py -3` ou `python`), cria venv
  descartável em `_app/server/.venv/`, e instala `requirements.txt` tentando **primeiro o índice
  pip corporativo e, para o que falhar, as wheels offline** embarcadas em `_app/server/wheels/`
  (`pip install --no-index --find-links wheels`). As wheels Windows x64 das dependências **são
  parte do artefato publicado** — a instalação funciona mesmo com pip totalmente bloqueado.
- **`iniciar.bat`** (o dia a dia): usa o Python do venv se existir, sobe o servidor apontando
  para a pasta de dados (o pai de `_app/`, sobrescrevível por `config.json`), espera o
  `/api/health` e abre o navegador com o token. Se o venv não existe, instrui a rodar
  `instalar.bat` — e lembra que o duplo clique no `PolicyOps.html` continua funcionando como
  plano B.
- **Atualizar a aplicação** = TI substituir o conteúdo de `_app/` (o `.html` e o `server/`),
  como hoje se substituía um arquivo. Dados, backups e evidências nunca são tocados.
- O repositório continua commitando `dist/PolicyOps.html`; o pacote `_app/` completo
  (`dist/plataforma/`) passa a ser gerado pelo build a partir da sessão S28.

## 10. Orçamentos de desempenho

| Operação (documento de 5 MB, pasta de rede corporativa) | Alvo |
|---|---|
| Abrir documento via `GET /api/document` | < 2 s |
| Salvar via `PUT /api/document` (backup + atômico) | < 2 s |
| Boot do launcher (venv pronto) até navegador aberto | < 8 s |
| Anexar evidência de 50 MB | < 15 s |
| Download de evidência com verificação de hash | < 5 s para 50 MB |

## 11. Testes obrigatórios

Servidor (pytest, rodando contra diretório temporário):

- Escrita atômica: matar a escrita no meio (simulado) nunca deixa `politicas.json` inválido.
- Conflito: `PUT` com `baseHash` divergente devolve `409` e **não grava**; o conteúdo em disco
  permanece o anterior (verificado byte a byte).
- Lock: adquirir, heartbeat, obsolescência aos 10 min, `423` para o segundo usuário, liberação.
- Backup: todo save bem-sucedido gera cópia; a 21ª apaga a mais antiga.
- Token: chamada sem/inválida devolve `401`; `/api/health` responde sem token.
- Whoami: papéis efetivos derivados de `meta.acl` (com ACL vazia, ausente e populada).
- `403` para save de `READER`.
- Evidências: upload → arquivo existe no caminho legível esperado, hash bate; colisão de nome
  gera sufixo; download com arquivo adulterado devolve `HASH_MISMATCH`; delete move para
  `_lixeira/` preservando o caminho; nada jamais é apagado.

Front (Vitest + Playwright):

- `server-adapter` cumpre o contrato de `StorageAdapter` (mesma suíte de contrato dos outros
  dois adapters, incluindo a tradução de `409` em `CONFLICT`).
- Detecção de modo: com `/api/health` respondendo → `SERVER`; sem → cadeia atual.
- E2E: subir o servidor real contra pasta temporária e rodar o fluxo
  abrir → editar → salvar → conflito simulado → merge → anexar evidência → reabrir.
