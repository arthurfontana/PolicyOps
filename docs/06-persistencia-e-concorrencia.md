# Persistência e Concorrência

> Sem servidor, o arquivo é o banco. Esta camada é a que impede alguém perder uma tarde de trabalho — trate-a com o mesmo cuidado que se trataria um banco de dados.

## 1. Detecção de recursos — `src/storage/capabilities.ts`

Nada aqui pode ser presumido. A aplicação testa o ambiente na inicialização:

```ts
type Capabilities = {
  fileSystemAccess: boolean;   // window.showOpenFilePicker existe E é utilizável
  origin: 'https' | 'http' | 'file' | 'other';
  indexedDB: boolean;
  compressionStream: boolean;
  mode: 'FULL' | 'DOWNLOAD_ONLY';
};
```

A File System Access API exige contexto seguro e origem não opaca. Páginas abertas por `file://` têm origem opaca e, na prática, não a têm disponível — mas **isso não pode ser assumido no código**: teste a existência da função e faça uma chamada real na primeira interação do usuário, capturando a falha.

`mode`:

- **`FULL`** — abrir/salvar direto no arquivo, autosave, bloqueio consultivo. Requer `fileSystemAccess`. É o cenário SharePoint (https) ou OneDrive sincronizado.
- **`DOWNLOAD_ONLY`** — abrir por seletor/arrastar, salvar por download. Fallback universal.

A tela inicial informa o modo ativo em português e o que muda em cada um. Nunca falhe silenciosamente para o modo pior: diga ao usuário.

## 2. Interface do adapter — `src/storage/adapter.ts`

```ts
interface StorageAdapter {
  readonly mode: 'FULL' | 'DOWNLOAD_ONLY';
  readonly canWriteInPlace: boolean;

  open(): Promise<OpenedFile>;               // seletor ou input
  openFromDrop(file: File): Promise<OpenedFile>;
  save(doc: PolicyOpsDocument): Promise<SaveResult>;      // grava onde abriu
  saveAs(doc: PolicyOpsDocument): Promise<SaveResult>;    // escolhe destino
  reloadCurrent(): Promise<PolicyOpsDocument | null>;     // relê para checar conflito
  getHandleInfo(): { name: string; path?: string } | null;
}

type OpenedFile = {
  document: PolicyOpsDocument;
  raw: { bytes: number; hash: string };
  issues: ValidationIssue[];        // não vazio = modo de recuperação
};

type SaveResult =
  | { ok: true; revision: number; savedAt: string; hash: string }
  | { ok: false; reason: 'CONFLICT'; remote: PolicyOpsDocument }
  | { ok: false; reason: 'CANCELLED' | 'PERMISSION' | 'IO'; message: string };
```

Duas implementações: `fsa-adapter.ts` e `download-adapter.ts`. **A aplicação inteira só conhece a interface.**

## 3. Formato do arquivo

- Padrão: `.json`, UTF-8, `JSON.stringify(doc, null, 2)` — legível, diffável, versionável pelo SharePoint.
- Acima de 5 MB, a aplicação oferece `.pmz` (mesmo JSON com gzip via `CompressionStream`), tipicamente 8–12× menor. A leitura detecta o formato pelo magic number, não pela extensão.
- O nome sugerido em "Salvar como" é `{slug do nome do documento}.json`.

## 4. Salvamento e revisão

`meta.revision` incrementa a cada salvamento bem-sucedido. `meta.savedAt`, `meta.savedBy` e `meta.appVersion` são carimbados. `raw.hash` é SHA-256 do conteúdo serializado, guardado em memória como "o que eu vi por último".

**Antes de todo salvamento**, o documento passa por `validate()` (invariantes de `03-modelo-do-documento.md` §9). Documento inválido **não é gravado** — melhor recusar do que corromper o arquivo compartilhado. A interface mostra o que está errado e onde.

## 5. Detecção de conflito

O caso real: duas pessoas abrem o mesmo arquivo do SharePoint às 9h; uma salva às 10h, a outra às 10h05.

Fluxo de `save()` no modo `FULL`:

```
1. relê o arquivo do disco
2. compara o hash lido com o hash da última leitura desta sessão
3. iguais    → grava, revision++, atualiza o hash
4. diferentes → não grava; devolve { ok: false, reason: 'CONFLICT', remote }
```

No conflito, a interface oferece três saídas, sempre explícitas:

| Opção | O que faz |
|---|---|
| **Ver o que mudou** | Diff entre o documento remoto e o meu, no mesmo componente de comparação das matrizes |
| **Mesclar** | Executa `mergeDocuments` (§7) e mostra o resultado antes de gravar |
| **Salvar como cópia** | Grava num arquivo novo `…-conflito-{nome}-{hora}.json` e não toca no original |

**Nunca** há sobrescrita silenciosa, e a opção "sobrescrever mesmo assim" exige digitar o nome do arquivo.

No modo `DOWNLOAD_ONLY` não há como reler: a aplicação avisa que a detecção de conflito não está disponível e recomenda o bloqueio consultivo (§6) e o salvamento frequente.

## 6. Bloqueio consultivo — `src/storage/lock.ts`

Apenas no modo `FULL`. Ao abrir um documento, a aplicação grava `{nome}.lock.json` ao lado:

```json
{ "holder": "Arthur", "since": "2026-08-05T12:00:00.000Z",
  "heartbeat": "2026-08-05T12:24:00.000Z", "docRevision": 41 }
```

- Heartbeat a cada 60 s enquanto a aba estiver aberta.
- Lock com heartbeat parado há mais de 10 min é considerado **obsoleto** e pode ser tomado.
- Ao abrir um documento com lock ativo de outra pessoa: banner *"Arthur está editando este arquivo desde 09:00"*, com "Abrir somente leitura" (recomendado) ou "Editar assim mesmo".
- Liberado em `beforeunload` e ao fechar o documento.

É **consultivo**: não impede nada, só evita o acidente comum. A interface diz isso com essas palavras.

## 7. Merge de documentos — `src/core/merge/`

```ts
mergeDocuments(mine, theirs): {
  merged: PolicyOpsDocument;
  applied: MergeAction[];
  conflicts: MergeConflict[];
};
```

O modelo de dados foi desenhado para tornar o merge tratável: quase tudo é append-only e imutável depois de publicado.

**Resolvido automaticamente:**

| Situação | Resolução |
|---|---|
| Versão publicada presente só de um lado | União. Versões publicadas são imutáveis; não há como conflitarem |
| Item de biblioteca (variável, regra, catálogo) novo só de um lado | União |
| Projeto ou matriz nova só de um lado | União |
| Eventos de auditoria | União, ordenada por `at`, deduplicada por `id` |
| Mesmo item, um lado inalterado | Vence o lado alterado |

**Conflito, exige decisão do usuário:**

| Situação | Como é apresentado |
|---|---|
| Mesma matriz com rascunhos diferentes dos dois lados | Escolher um, ou manter os dois (o perdedor vira `ARCHIVED` com nota) |
| Mesmo `number` de versão publicada com conteúdo diferente | Erro grave: renumera o perdedor e sinaliza para revisão manual |
| Mesmo item de biblioteca editado dos dois lados | Escolher versão, campo a campo |
| Mesmo `code` criado do zero dos dois lados para entidades diferentes | Renomear um deles |

A tela de merge lista tudo que será aplicado automaticamente e pede decisão só nos conflitos. Nada é mesclado sem o usuário ver. O resultado gera evento `DOCUMENT_MERGED` com o resumo completo.

## 8. Autosave e recuperação — `src/storage/local-buffer.ts`

Independente do modo, e sempre ligado.

- A cada mudança, com debounce de **3 s**, o documento é gravado no IndexedDB local (`policyops-buffer`), com `{ docId, revision, savedAt, document }`.
- Guarda os **10 últimos** estados, em rodízio.
- Ao abrir a aplicação, se houver buffer mais recente que o arquivo aberto (mesmo `meta.id`, `revision` maior ou `savedAt` posterior), mostra: *"Encontramos alterações não salvas de 05/08 às 14:32. Recuperar ou descartar?"*, com preview do que difere.
- O buffer é limpo após salvamento bem-sucedido do mesmo estado.

Isso cobre queda do navegador, fechamento acidental e travamento da máquina — que, num produto sem servidor, são a principal causa de perda.

## 9. Backups automáticos

No modo `FULL`, antes de cada salvamento, a aplicação copia o conteúdo anterior para `_backups/{nome}.{timestamp}.json`, mantendo os **20 mais recentes** e apagando os excedentes.

Se a pasta `_backups` não puder ser criada (permissão), avisa uma vez e segue sem backup — não bloqueia o salvamento.

No SharePoint isso é redundante com o histórico de versões nativo, e a interface diz isso: o backup local é cinto e suspensório.

## 10. Modo de recuperação

Se `validate()` falhar na leitura, a aplicação **não descarta o arquivo**. Abre em modo de recuperação:

- lista os problemas em português, agrupados por gravidade e por entidade;
- oferece correções automáticas para o que é seguro: remover referência a catálogo inexistente, remover célula de coordenada inválida, remover tupla órfã, renumerar `position` com buraco;
- o que não for corrigível automaticamente é mostrado com o caminho no JSON, para correção manual;
- permite exportar um relatório de diagnóstico;
- **nada é gravado** até o usuário aceitar as correções, e a gravação é sempre "salvar como", preservando o arquivo original.

## 11. Testes obrigatórios

- Round-trip: documento → JSON → documento é idêntico (deep equal), incluindo campos opcionais omitidos.
- Round-trip com gzip.
- Detecção de formato por magic number.
- `validate()` para cada invariante de §9 do modelo — caso válido e caso inválido.
- Migração de `schemaVersion` com fixtures reais.
- Arquivo com `schemaVersion` maior é recusado com a mensagem certa.
- Conflito: hash divergente devolve `CONFLICT` e **não grava** (verifique o conteúdo do arquivo depois).
- Merge: cada linha das duas tabelas de §7, com fixture própria.
- Merge é **determinístico e associativo** no caso sem conflito: `merge(a,b)` = `merge(b,a)` quanto ao conteúdo resultante.
- Autosave: mudança → buffer gravado; salvar → buffer limpo; abrir com buffer mais novo → oferece recuperação.
- Lock: obsoleto após 10 min; heartbeat renova; liberado ao fechar.
- Recuperação: documento com 5 defeitos conhecidos abre, lista os 5, corrige os corrigíveis, e o original não é tocado.
- Adapter em `DOWNLOAD_ONLY`: `save()` produz o blob correto e a aplicação avisa da ausência de detecção de conflito.
