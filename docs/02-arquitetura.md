# Arquitetura

> Documento normativo. Sessões de implementação seguem-no literalmente e **não** tomam decisões de arquitetura por conta própria.

## 1. A forma do produto

```
\\SharePoint\Politicas\
   ├── PolicyOps.html          ← a aplicação inteira (~500 KB), nunca muda
   ├── politicas.json          ← todos os dados (bibliotecas, matrizes, versões, histórico)
   └── _backups/
        ├── politicas.2026-08-05T14-32.json
        └── ...
```

O usuário abre `PolicyOps.html`, a aplicação pede o arquivo de dados, e a partir daí tudo acontece no navegador. **Nenhuma requisição de rede sai da página.**

Separar aplicação e dados é deliberado: o `.html` é imutável e a TI o publica uma vez; o `.json` é o que muda, é legível, é diffável e ganha histórico de versões do SharePoint de graça.

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

**Restrições absolutas do bundle:**

- Zero requisições externas em tempo de execução — sem CDN, sem fontes web, sem telemetria. A página precisa funcionar offline e dentro de qualquer política de rede.
- Fontes: pilha do sistema (`ui-sans-serif, system-ui, "Segoe UI", …`).
- Nada de `eval` nem de `new Function` — CSPs corporativas frequentemente bloqueiam.
- Tudo em um arquivo: sem code splitting, sem lazy chunks, sem service worker.
- Orçamento de tamanho: **1,5 MB** para o HTML final. O build falha acima disso. (Elevado do 1 MB original em 2026-08 para acomodar as Sessões 19-20, que já haviam estourado o teto anterior.)

**Proibido sem aprovação explícita:** qualquer backend, IndexedDB como armazenamento primário, biblioteca de grid de terceiros (AG Grid, Handsontable), canvas/WebGL para o grid, framework de estado adicional.

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
│  storage/              Adapters de arquivo, autosave      │
└──────────────────────────────────────────────────────────┘
```

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
│   │   ├── fsa-adapter.ts         # File System Access API
│   │   ├── download-adapter.ts    # fallback: input + download
│   │   ├── local-buffer.ts        # IndexedDB: autosave e recuperação
│   │   ├── capabilities.ts        # detecção de recursos do navegador
│   │   └── lock.ts                # bloqueio consultivo
│   ├── store/
│   │   ├── document-store.ts      # documento + pilha de comandos
│   │   ├── editor-store.ts        # seleção, zoom, foco
│   │   └── ui-store.ts
│   ├── components/
│   │   ├── shell/  grid/  inspector/  library/  dialogs/  ui/
│   ├── lib/                       # colors, format, hash, download
│   └── types/
├── tests/
│   ├── unit/                      # espelha src/core/
│   ├── fixtures/                  # documentos .json de teste
│   └── e2e/
├── vite.config.ts
└── package.json
```

## 5. O artefato buildado é commitado

`dist/PolicyOps.html` **fica versionado no repositório**. Motivo: o usuário final precisa conseguir baixar o arquivo direto do GitHub e colocá-lo no SharePoint, sem instalar Node nem rodar build.

Toda sessão de implementação termina com `pnpm build` e o `dist/PolicyOps.html` atualizado no commit. Isso é critério de aceite de todas elas.

## 6. Identidade do usuário

Não há login. Na primeira abertura, um diálogo pede o nome ("Como você quer ser identificado no histórico?"), guardado em `localStorage`. Esse nome carimba eventos de auditoria e o campo `savedBy` do arquivo.

É identificação, não autenticação — e a interface diz isso, para ninguém confundir com controle de acesso. Um toggle "modo somente leitura" existe por conveniência (evitar edição acidental ao consultar), não como segurança.

## 7. Compatibilidade de navegador

A aplicação **detecta recursos em tempo de execução** (`src/storage/capabilities.ts`) e se adapta:

| Recurso | Chromium 110+ | Firefox / Safari |
|---|---|---|
| File System Access API | ✅ abrir/salvar direto no arquivo | ❌ cai para baixar/enviar |
| `showSaveFilePicker` | ✅ | ❌ |
| IndexedDB (buffer de autosave) | ✅ | ✅ |
| `CompressionStream` | ✅ | ✅ (Safari 16.4+) |
| Drag-and-drop de arquivo | ✅ | ✅ |

A tela inicial informa, em português, qual modo está ativo e o que muda. **Nunca** presuma que a File System Access API existe: toda chamada passa pela detecção.

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
