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
| `POST /api/evidences` | Anexa arquivo (multipart) ao acervo (§7). Campos: `file`, `project`, `matrix?`, `version?`, `date?` — **códigos**, não ids. Papel mínimo `EDITOR` | `201 { id, relPath, fileName, sha256, bytes }` · `413 TOO_LARGE` acima de 50 MB · `403 FORBIDDEN` |
| `GET /api/evidences/{id}?relPath=&sha256=` | Faz o download/stream do arquivo, conferindo o hash antes de responder | `404` se removido; `409 HASH_MISMATCH` se o conteúdo não bate com o hash registrado; `400` se o caminho sai de `_evidencias/` |
| `DELETE /api/evidences/{id}?relPath=` | Move o arquivo para `_evidencias/_lixeira/`. Papel mínimo `EDITOR` | Nunca apaga de verdade (§7). `200 { trashed }` — idempotente |

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
  `LOCKED` (423, com `lock`), `NOT_UTF8` (422), `FORBIDDEN` (403, papel efetivo `READER` em
  `PUT /api/document` — S29, §6), `IO` (500).
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
(`getpass.getuser()`), e o carimba em toda operação. O diálogo "como você quer ser identificado?"
não existe no modo `SERVER`: `savedBy`, o `actor` de todo evento de auditoria e o `holder` do lock
continuam sendo a mesma string legível de sempre (`displayName ?? username`, sem mudança de forma
no schema) — o que muda é a fonte: vem de `GET /api/whoami`, não do nome digitado. Em paralelo, o
front guarda a identidade **estruturada** `{ username, source: 'windows' | 'typed' }`
(`src/store/document-store.ts`, campo `identity`) só para resolver papel: `username` é o login
(imutável, nunca o `displayName`), e é contra ele que `resolveRole` casa `acl.users[].username`.
Nos modos sem servidor, `username` e o nome digitado são o mesmo valor, com `source: 'typed'`.

### Papéis

O documento ganha, no `meta`, uma ACL (`schemaVersion: 4`, migração puramente aditiva — S29):

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

`resolveRole(doc, username)` (`src/core/document/roles.ts`) resolve o papel efetivo: listado → o
papel da lista; não listado → `defaultRole`; ACL ausente, vazia, **ou populada sem nenhum
`ADMIN`** → **modo aberto**, todo mundo `PUBLISHER` — as três condições que `isOpenMode(doc)`
também reconhece. As três colapsam no mesmo caso porque uma ACL sem `ADMIN` é tão inoperante
quanto nenhuma: ninguém poderia mais editá-la de volta pela tela.

Regras:

- **Modo aberto** (as três condições acima) é compatibilidade com o documento existente e com
  times que não querem controle — todos `PUBLISHER`. O controle liga quando um `ADMIN` é definido.
- Enforcement em duas camadas: a **interface** desabilita o que o papel não permite (com o
  motivo visível, "Requer papel X — você é Y."), e o **servidor** recusa `PUT /api/document` de
  quem tem papel efetivo `READER` (`403 FORBIDDEN`). O servidor não re-deriva permissões finas
  por comando — a camada fina é o gate do `dispatch` do front (`docs/08-camada-de-comandos.md`
  §6). É controle de acidente e de organização, não defesa contra usuário malicioso (que sempre
  poderá editar o arquivo na mão; §5) — a tela de acesso é honesta sobre isso.
- A ACL nunca pode ficar sem `ADMIN` por edição da própria tela: o botão de salvar trava com essa
  invariante (`wouldHaveNoAdmin`, `AclScreen.tsx`), e o comando `acl/set` recusa o mesmo caso com
  `ACL_REQUIRES_ADMIN` como segunda linha de defesa. Um documento externo que chegue assim abre
  em modo aberto com aviso (`checkI24`, `WARNING` — `03-modelo-do-documento.md` §9).
- **Bootstrap**: em modo aberto, ninguém tem `ADMIN` — mas alguém precisa poder criar o primeiro,
  senão o controle nunca liga. `acl/set` tem uma exceção estreita para esse caso específico:
  liberado mesmo com papel efetivo `PUBLISHER`, só quando `isOpenMode(doc)` é verdadeiro (gate do
  dispatcher, e a tela de acesso fica visível para todo mundo nesse estado). Fora do modo aberto,
  `acl/set` exige `ADMIN` normalmente.
- Toda mudança de ACL gera evento de auditoria (`ACL_CHANGED`, com `payload: { before, after }`).

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

### Detalhamento fechado na S30 (DEC-PLAT-005)

- **O documento é o registro; o servidor só toca arquivos.** Não existe índice, banco nem
  sidecar de anexos na pasta: `relPath` e `sha256` viajam do `attachments[]` para o servidor em
  toda chamada (`GET`/`DELETE`), e o `{id}` da rota é só o identificador do vínculo. É o que
  mantém ADR-002 de pé — e é o que faz o `DELETE` continuar funcionando **depois** do
  salvamento que já tirou o anexo do documento, que é exatamente quando ele acontece.
- **O caminho é construído, não validado.** O servidor recebe os **códigos** do projeto e da
  matriz (`POLITICA_PF`, estáveis a um `rename`, diferente do nome) e os slugifica para
  `[a-z0-9-]` — um slug não sabe dizer `..`, então a anexação não tem como escrever fora de
  `_evidencias/`. Só o `relPath` que **volta** do documento é validado (segmento `..`, caminho
  absoluto, letra de unidade, e conferência de que o caminho resolvido continua sob a raiz).
- **O prefixo de data é o do usuário, não o do UTC.** O front manda `date` no fuso local; sem
  ele, o servidor carimba a data local da própria máquina. Um anexo às 22h de 14/08 tem que
  aparecer como `2026-08-14_…` na pasta de quem anexou.
- **`id` é gerado pelo servidor** no formato `nanoid(12)` do documento (`NANOID_REGEX`), para
  entrar em `attachments[].id` sem tratamento especial.
- **A ida para a lixeira acontece depois do salvamento.** O desanexo tira só o vínculo; a
  camada de persistência compara, a cada save bem-sucedido, o que o documento reivindica contra
  o que a sessão sabe existir no acervo, e manda para `_lixeira/` o que sobrou. Falha nessa
  etapa vira aviso, nunca "não salvou" — e o arquivo continua no acervo, que é o lado seguro do
  erro. Desfazer um desanexo **antes** de salvar é, por construção, um não-evento no disco.
- **`attachments` não muda o `schemaVersion`** (segue 4): campo novo e opcional é o caso que
  `03-modelo-do-documento.md` §10 registra como "sem necessidade de migração". A contrapartida
  é conhecida: um `PolicyOps.html` anterior à S30 abre um documento com anexos em modo de
  recuperação (o schema é `.strict()`), e perde os vínculos se salvar por cima. No modo `SERVER`
  todo mundo roda o `_app/` publicado pela TI, então o cenário é o mesmo de sempre — atualizar a
  aplicação é substituir a pasta (§9).

## 8. Modos de operação do front

`capabilities.ts` ganha o terceiro modo, e a ordem de preferência é fixa:

| Modo | Quando | O que dá |
|---|---|---|
| **`SERVER`** | SPA servida pelo servidor local (`fetch('/api/health')` responde e o token está presente) | Tudo: salvar direto na rede, conflito, lock, backups, identidade Windows, papéis, evidências |
| **`FULL`** | Sem servidor, mas com File System Access API utilizável | O que já existe hoje (mantido por custo ~zero; cenário OneDrive/https) |
| **`DOWNLOAD_ONLY`** | Duplo clique no HTML sem Python | Fallback universal: abrir por seletor, salvar por download; sem evidências |

O modo `SERVER` entra pela interface existente: `server-adapter.ts` implementa `StorageAdapter`
sobre `fetch` — `save()` traduz `409` em `{ ok: false, reason: 'CONFLICT', remote }` e o fluxo de
conflito/merge da aplicação **não muda uma linha**. Funcionalidades exclusivas do servidor futuras
(evidências, papéis na interface — S29/S30) ficam atrás de um recurso opcional que os componentes
consultam; nos outros modos os pontos de entrada aparecem desabilitados com o motivo. `whoami` já é
usado desde a S27, mas só para resolver o nome que carimba `savedBy` — ver "Detalhamento fechado na
S27" abaixo.

### Detalhamento fechado na S27 (DEC-PLAT-002)

- **Token**: `capabilities.ts` lê `?t=` da URL uma vez, guarda em `sessionStorage` e limpa a URL
  via `history.replaceState` — ele não deve sobreviver num histórico de navegação nem ser colado
  por engano. Recarregar a aba ou navegar por hash lê o token de volta do `sessionStorage`, sem
  precisar do `?t=` de novo. `Capabilities.localServer` só é `true` com token presente **e**
  `GET /api/health` respondendo com `X-PolicyOps-Api` compatível — API mais nova que a do front
  vira aviso (`degraded`) na tela inicial, nunca "tentar mesmo assim" (mesma regra do
  `schemaVersion`).
- **`force` só destrava o lock, nunca o `baseHash`** (DEC-PLAT-002): "sobrescrever mesmo
  assim"/"mesclar" no modo `SERVER` funcionam guardando o `remoteHash` do último `409` e mandando-o
  como `baseHash` do `PUT` seguinte — não existe "ignorar o disco" como no modo `FULL`. Se alguém
  salvar de novo nesse intervalo, o próximo `PUT` ainda recebe `409`.
- **`423` fora do fluxo de lock** (defesa em profundidade do `PUT /api/document`, pouco comum na
  prática porque a interface já bloqueia `save()` enquanto o lock é de outra pessoa): como
  `SaveResult` não tem variante de bloqueio, `server-adapter.ts` traduz em
  `{ reason: 'PERMISSION' }`, citando quem detém o bloqueio.
- **Lock via API**: `lock.ts` ganhou a porta `AdvisoryLockPort`, implementada por `AdvisoryLock`
  (modo `FULL`, sobre `DirectoryPort`) e `ApiAdvisoryLock` (modo `SERVER`, sobre
  `POST`/`DELETE /api/document/lock`) — mesmo `{nome}.lock.json` em disco, mesmo `LockAcquisition`;
  a interface (banner, "editar assim mesmo") não sabe qual dos dois está por trás. O heartbeat de
  `ApiAdvisoryLock` nunca manda `force: true`: o servidor libera a renovação sozinho quando o lock
  já é meu, e mandar `force` reivindicaria de volta um lock que outra pessoa legitimamente tomou
  depois de obsoleto.
- **Identidade** (ADR-003, adiantado da S27): `GET /api/whoami` resolve `savedBy` e o nome exibido
  na barra de status; o diálogo "como você quer ser identificado?" não abre no modo `SERVER`. A ACL
  de papéis (`meta.acl`, enforcement na interface e no servidor) chegou na S29 — ver "Detalhamento
  fechado na S29" abaixo.
- **Sem seletor, sem "salvar como", sem recentes**: o arquivo é fixo pela pasta que o servidor
  serve. `saveAs()` e `openFromDrop()` devolvem falha clara em vez de abrir qualquer coisa;
  `openRecent()` devolve `null` sempre — a tela inicial esconde os cartões correspondentes.

### Detalhamento fechado na S29

- **`whoami.roles` deixa de ser fixo**: o servidor reavalia `resolve_effective_role(config)` a
  cada chamada de `GET /api/whoami` e de `PUT /api/document`, lendo `meta.acl` direto do
  `politicas.json` em disco (`read_document_acl`, defensivo — arquivo ausente, JSON quebrado ou
  `meta`/`acl` fora do formato caem em modo aberto, nunca derrubam o boot nem a chamada). O front
  não confia nesse valor para gate nenhum — ele roda `resolveRole` de novo, contra o documento que
  já tem em memória (mais preciso: vê uma ACL editada na sessão antes do próximo save).
- **O papel efetivo do front usa o `username`, nunca o `displayName`** — `document-store.identity`
  (não o `actor` de exibição) é o que `resolveRole` casa contra `acl.users[].username`; ver
  "Identidade" em §6.
- **`acl/set` e o bootstrap** ficam inteiramente no front (`src/core/document/commands.ts`,
  `src/store/document-store.ts`) — o servidor só enxerga o resultado já salvo em `meta.acl` na
  próxima leitura do documento; ele não participa da decisão de quem pode editar a ACL.
- **`403 FORBIDDEN`** é checado antes de qualquer outra coisa em `PUT /api/document` — antes do
  parse do JSON, antes do lock, antes do hash — porque é o gate mais barato e mais fundamental: um
  `READER` não tem nada a ganhar vendo um `409` ou um `423` em vez do motivo real.

## 9. Distribuição e instalação

Padrão de instalação em camadas do AppCreditoSimulador, que já opera no mesmo ambiente
corporativo (ADR-005), implementado na S28.

- **`instalar.bat`** (uma vez por máquina): localiza o Python (`py -3` ou `python`), cria venv
  descartável em `_app/server/.venv/`, e instala `requirements.txt` linha a linha tentando
  **primeiro o índice pip corporativo e, para o que falhar, as wheels offline** embarcadas em
  `_app/server/wheels/` (`pip install --no-index --find-links wheels`). Termina com um resumo em
  português (quantas dependências foram pelo índice, quantas pelas wheels, quantas falharam) e
  nunca toca o Python do sistema — só cria e escreve dentro do próprio venv. As wheels Windows
  x64 das dependências **são parte do artefato publicado** — a instalação funciona mesmo com pip
  totalmente bloqueado. `requirements.txt` fixa versão em cada dependência (a mais recente que
  ainda roda em Python 3.9 — a próxima já exige 3.10); `scripts/fetch-wheels.mjs`, rodado numa
  máquina com internet antes de publicar o pacote, baixa essas wheels via `pip download
  --platform win_amd64 --only-binary=:all:` para um conjunto de versões de Python (3.9 a 3.13,
  cobrindo o parque — `pydantic-core`, transitiva de `fastapi`, publica uma wheel binária por
  versão menor de Python).
- **`iniciar.bat`** (o dia a dia): usa o Python do venv se existir, senão instrui a rodar
  `instalar.bat` e lembra que o duplo clique no `PolicyOps.html` continua funcionando como plano
  B — nunca instala nada nem trava. Quando o venv existe, chama `server/launcher.py --data-dir
  ".."` (o pai de `_app/`, sobrescrevível por `config.json`). O launcher reaproveita
  `policyops_server.prepare()` (config, porta, app — o mesmo que o CLI direto usa) e sobe o
  `uvicorn` numa thread do próprio processo, não um subprocesso separado: fechar a janela do
  `.bat` ou `Ctrl+C` derruba servidor e thread juntos, sem processo órfão escutando em
  `127.0.0.1`. `wait_for_health()` consulta `/api/health` até responder ou estourar o timeout
  antes de abrir o navegador no endereço com token — só então a janela mostra a instrução de
  encerramento.
- **Atualizar a aplicação** = TI substituir o conteúdo de `_app/` (o `.html` e o `server/`),
  como hoje se substituía um arquivo. Dados, backups e evidências nunca são tocados.
- O repositório continua commitando `dist/PolicyOps.html`; o pacote `_app/` completo
  (`dist/plataforma/`) é gerado por `pnpm build:plataforma` (não commitado — tamanho das wheels) e
  conferido por `pnpm check:plataforma` antes de publicar.

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
