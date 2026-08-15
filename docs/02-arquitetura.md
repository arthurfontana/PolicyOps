# Arquitetura

> Documento normativo. Sessões de implementação seguem-no literalmente e **não** tomam decisões de arquitetura por conta própria.

## 1. A forma do produto

```
\\rede\Politicas\                       ← pasta de rede do time
   ├── politicas.json                   ← todos os dados (bibliotecas, matrizes, versões, histórico)
   ├── _backups/                        ← cópias automáticas feitas pelo servidor
   ├── _evidencias/                     ← acervo de anexos, navegável no Explorer
   └── _app/                            ← a aplicação, publicada pela TI
        ├── iniciar.bat                 ← o usuário só executa isto
        ├── PolicyOps.html              ← a SPA inteira em arquivo único (~1,2 MB)
        └── server/                     ← servidor local FastAPI + wheels offline
```

Cada usuário executa `iniciar.bat`: um **servidor Python local** sobe em `http://127.0.0.1`,
serve o `PolicyOps.html` e faz todo o I/O contra a pasta de rede. Um servidor **por usuário**,
todos apontando para a mesma pasta — não há máquina central nem serviço para operar. O navegador
nunca toca arquivo; **nenhuma requisição sai da máquina** (a única comunicação é com o próprio
`127.0.0.1`). O contrato completo do servidor, identidade, papéis e evidências está em
[`14-plataforma-local.md`](14-plataforma-local.md); o porquê da mudança, em ADR-001/ADR-002.

Separar aplicação e dados continua deliberado: `_app/` é imutável e a TI o publica; o `.json` é o
que muda, é legível e diffável. E o `PolicyOps.html` continua abrindo sozinho por duplo clique,
sem Python, no modo degradado `DOWNLOAD_ONLY` — fallback universal.

## 2. Stack (decidida)

| Camada | Escolha | Justificativa |
|---|---|---|
| Build | Vite 6 + `vite-plugin-singlefile` | Gera um único HTML com JS/CSS embutidos |
| UI | React 19 + TypeScript `strict` | — |
| Estado | Zustand + Immer | Documento em memória com command pattern para undo/redo |
| Validação | Zod | Valida o documento na leitura — é a única defesa contra arquivo corrompido |
| Estilo | Tailwind CSS v4 (JIT, embutido no bundle) | — |
| Componentes | Radix UI primitives + componentes próprios | shadcn/ui pode ser usado como ponto de partida, copiando o código |
| Ícones | `lucide-react` | Tree-shaking; vira SVG inline no bundle |
| Datas | `date-fns` com locale pt-BR | — |
| Decimais | `decimal.js-light` | Dinheiro nunca em ponto flutuante |
| IDs | `nanoid` | — |
| Export PNG | `html-to-image` | Roda no cliente |
| Testes | Vitest + Testing Library | — |
| E2E | Playwright | Dirige tanto `file://` quanto servidor local |
| Gerenciador | pnpm | — |
| Servidor local | Python 3.9+ · FastAPI + uvicorn + python-multipart | Infraestrutura de I/O e identidade; **nunca** regra de negócio (`14-plataforma-local.md` §3) |
| Testes do servidor | pytest + httpx | — |

**Restrições absolutas do bundle:**

- Zero requisições **externas** em tempo de execução — sem CDN, sem fontes web, sem telemetria. A única comunicação permitida é com o servidor local same-origin (`/api/*`, `14-plataforma-local.md` §5); a página precisa continuar funcionando offline e sem servidor.
- Fontes: pilha do sistema (`ui-sans-serif, system-ui, "Segoe UI", …`).
- Nada de `eval` nem de `new Function` — CSPs corporativas frequentemente bloqueiam.
- Tudo em um arquivo: sem code splitting, sem lazy chunks, sem service worker.

**Proibido sem aprovação explícita:** banco de dados, serviço central sempre ligado, IndexedDB como armazenamento primário, biblioteca de grid de terceiros (AG Grid, Handsontable), canvas/WebGL para o grid, framework de estado adicional, dependência Python fora da lista acima (cada uma exige wheel Windows embarcada — `14-plataforma-local.md` §9).

## 3. Camadas

```
┌──────────────────────────────────────────────────────────┐
│  components/           React, apresentação e interação    │
├──────────────────────────────────────────────────────────┤
│  store/                Zustand: documento + UI + comandos │
├──────────────────────────────────────────────────────────┤
│  core/                 Regra de negócio — TypeScript puro │
│    document/  axes/  versioning/  diff/  reconcile/       │
├──────────────────────────────────────────────────────────┤
│  storage/              Adapters: server (HTTP local),     │
│                        fsa, download; autosave            │
├──────────────────────────────────────────────────────────┤
│  server/  (Python)     I/O na pasta de rede, identidade,  │
│                        lock, backups, evidências          │
└──────────────────────────────────────────────────────────┘
```

O servidor é infraestrutura: valida token, resolve o usuário Windows, grava com escrita atômica e
serve arquivos. **Toda regra de negócio permanece em `src/core/`** — o servidor não conhece o
schema além do envelope `meta.acl` (ADR-002).

### Regra arquitetural inegociável

**`src/core/` é TypeScript puro: sem React, sem Zustand, sem DOM, sem `window`.** São funções que recebem um documento e devolvem um documento novo (ou um erro). É onde vivem versionamento, geração de tuplas, diff e reconciliação, e é o que os testes cobrem exaustivamente.

Componentes e store nunca implementam regra de negócio — apenas invocam `core` e mostram o resultado.

## 4. Estrutura de pastas

```
/
├── docs/
├── dist/
│   └── PolicyOps.html            ← artefato buildado, COMMITADO no repositório
├── public/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── core/
│   │   ├── document/
│   │   │   ├── schema.ts          # tipos + Zod do documento
│   │   │   ├── create.ts          # documento vazio, documento de exemplo
│   │   │   ├── migrate.ts         # migração entre schemaVersion
│   │   │   ├── evidence.ts        # vínculo com o acervo de evidências (14 §7)
│   │   │   └── validate.ts
│   │   ├── axes/
│   │   │   ├── tuples.ts          # geração de tuplas com compatibilidade
│   │   │   ├── header-layout.ts   # spans dos cabeçalhos aninhados
│   │   │   ├── levels.ts          # adicionar/remover/reordenar nível
│   │   │   └── paths.ts           # encode/decode de caminho e chave de célula
│   │   ├── versioning/
│   │   │   ├── snapshot.ts
│   │   │   ├── lifecycle.ts       # criar rascunho, publicar, descartar
│   │   │   └── cells.ts           # patch de células
│   │   ├── library/
│   │   │   ├── variables.ts
│   │   │   ├── compatibility.ts
│   │   │   └── catalog.ts
│   │   ├── diff/
│   │   ├── reconcile/
│   │   ├── timeline/              # vigência por data
│   │   ├── templates/
│   │   ├── merge/                 # merge de documentos em conflito
│   │   ├── export/
│   │   └── errors.ts
│   ├── storage/
│   │   ├── adapter.ts             # interface StorageAdapter
│   │   ├── server-adapter.ts      # HTTP contra o servidor local (modo SERVER)
│   │   ├── fsa-adapter.ts         # File System Access API
│   │   ├── download-adapter.ts    # fallback: input + download
│   │   ├── local-buffer.ts        # IndexedDB: autosave e recuperação
│   │   ├── capabilities.ts        # detecção de recursos do navegador
│   │   ├── evidences.ts           # cliente de /api/evidences (modo SERVER)
│   │   └── lock.ts                # bloqueio consultivo
│   ├── store/
│   │   ├── document-store.ts      # documento + pilha de comandos
│   │   ├── editor-store.ts        # seleção, zoom, foco
│   │   └── ui-store.ts
│   ├── components/
│   │   ├── shell/  grid/  inspector/  library/  dialogs/  ui/
│   ├── lib/                       # colors, format, hash, download
│   └── types/
├── server/
│   ├── policyops_server.py        # servidor FastAPI (14-plataforma-local.md)
│   ├── requirements.txt
│   ├── wheels/                    # wheels Windows x64 embarcadas (contingência do pip)
│   ├── iniciar.bat  instalar.bat
│   └── tests/                     # pytest
├── tests/
│   ├── unit/                      # espelha src/core/
│   ├── fixtures/                  # documentos .json de teste
│   └── e2e/
├── vite.config.ts
└── package.json
```

## 5. O artefato buildado é commitado

`dist/PolicyOps.html` **fica versionado no repositório**. Motivo: o usuário final precisa conseguir baixar o arquivo direto do GitHub e colocá-lo na pasta de rede (`_app/`), sem instalar Node nem rodar build. O pacote completo `dist/plataforma/` (HTML + servidor + wheels) é gerado pelo build a partir da S28 e **não** é commitado.

Toda sessão de implementação termina com `pnpm build` e o `dist/PolicyOps.html` atualizado no commit. Isso é critério de aceite de todas elas.

## 6. Identidade do usuário

No modo `SERVER`, a identidade é o **login de rede do Windows**, capturado automaticamente pelo
servidor local e carimbado em auditoria, `savedBy`, lock e evidências — sem senha e sem diálogo.
O documento pode declarar **papéis** (`READER`/`EDITOR`/`PUBLISHER`/`ADMIN`) em `meta.acl`;
contrato completo e regras de enforcement em [`14-plataforma-local.md`](14-plataforma-local.md) §6.

Nos modos sem servidor, permanece o diálogo de nome guardado em `localStorage`. Em qualquer modo
vale a mesma honestidade: é identificação e organização de trabalho, não segurança — quem tem
acesso de escrita à pasta de rede sempre poderá editar o arquivo diretamente, e a interface diz
isso com essas palavras.

## 7. Compatibilidade de navegador

A aplicação **detecta recursos em tempo de execução** (`src/storage/capabilities.ts`) e se adapta.
No modo `SERVER` (SPA servida pelo servidor local), o navegador deixa de importar: **tudo funciona
em qualquer navegador**, porque quem toca arquivo é o Python. A tabela abaixo vale para os modos
sem servidor:

| Recurso | Chromium 110+ | Firefox / Safari |
|---|---|---|
| File System Access API | ✅ abrir/salvar direto no arquivo | ❌ cai para baixar/enviar |
| `showSaveFilePicker` | ✅ | ❌ |
| IndexedDB (buffer de autosave) | ✅ | ✅ |
| `CompressionStream` | ✅ | ✅ (Safari 16.4+) |
| Drag-and-drop de arquivo | ✅ | ✅ |

Ordem de preferência dos modos: `SERVER` → `FULL` → `DOWNLOAD_ONLY`
(`14-plataforma-local.md` §8). A tela inicial informa, em português, qual modo está ativo e o que
muda. **Nunca** presuma que a File System Access API existe: toda chamada passa pela detecção.

## 8. Desempenho — alvos

| Operação | Alvo |
|---|---|
| Abrir a aplicação (parse do HTML) | < 1 s |
| Carregar documento de 5 MB | < 2 s |
| Renderizar grid de 1.500 células | < 400 ms |
| Aplicar edição em massa em 300 células | < 100 ms (tudo em memória) |
| Diff entre duas versões de 1.500 células | < 150 ms |
| Salvar documento de 5 MB | < 1,5 s |

Grid em DOM puro com CSS Grid. Virtualização por linhas entra apenas acima de 2.000 células visíveis (sessão S09), nunca antes.

## 9. Qualidade

- Cobertura de testes em `src/core/`: mínimo **85%**, com **100%** em `axes/`, `versioning/` e `reconcile/`.
- E2E cobrindo: criar documento → montar biblioteca → criar matriz aninhada → editar → publicar → comparar → salvar → reabrir.
- CI (GitHub Actions): `lint` → `typecheck` → `test:unit` → `build` → verificação do orçamento de tamanho → `test:e2e`.
- Nenhum `any` sem comentário justificando. Nenhum `@ts-ignore`.

## 10. Acessibilidade

- Navegação completa por teclado no grid, incluindo os cabeçalhos aninhados.
- Contraste AA; texto da célula alterna preto/branco pela luminância do fundo.
- Cor nunca é o único portador de informação: a célula sempre mostra o rótulo curto da decisão.
- Tema claro e escuro, com preferência guardada em `localStorage`.
