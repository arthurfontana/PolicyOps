# Sessão 05 — Persistência: abrir, salvar, conflito

**Modelo: `Opus`** · **Depende de:** S04 · **Marco M1**

---

> **Por que Opus:** sem servidor, esta camada *é* o banco de dados. O modo de falha é perda de trabalho de outra pessoa — o pior que este produto pode fazer. Detecção de conflito, autosave, recuperação e bloqueio precisam estar certos, e cada um tem casos de borda que só aparecem em produção.

## Prompt

> Você está implementando a Sessão 05 do Policy Matrix Studio — a camada de persistência.
>
> **Leia `docs/06-persistencia-e-concorrencia.md` por inteiro antes de escrever código.** É a especificação completa desta sessão. Leia também `docs/07-ux-e-editor.md` §1 (tela inicial).
>
> ### O cenário real
> O arquivo `PolicyOps.html` fica numa biblioteca do SharePoint. Os dados ficam num `.json` ao lado. Várias pessoas do time abrem o mesmo arquivo ao longo do dia. Duas delas podem abrir às 9h e salvar às 10h — **e ninguém pode perder trabalho por causa disso**.
>
> ### Objetivo
> Abrir, salvar, salvar como, detectar conflito, autosalvar localmente e recuperar de queda. Ao final desta sessão a aplicação já é utilizável de verdade, mesmo sem telas de matriz.
>
> ### Escopo
>
> #### 1. Detecção de recursos — `src/storage/capabilities.ts`
> Conforme §1. **Nada pode ser presumido.** A File System Access API exige contexto seguro e origem não opaca; páginas em `file://` têm origem opaca e na prática não a têm — mas não assuma isso no código: teste a existência da função e faça uma chamada real na primeira interação, capturando a falha e degradando.
>
> Determine `mode: 'FULL' | 'DOWNLOAD_ONLY'` e exponha isso à interface. **Nunca degrade em silêncio** — a tela inicial diz, em português, qual modo está ativo e o que muda.
>
> #### 2. Adapters — `src/storage/`
> A interface `StorageAdapter` de §2, literalmente, e as duas implementações:
> - **`fsa-adapter.ts`** — `showOpenFilePicker`/`showSaveFilePicker`, handle persistido em IndexedDB para os "recentes" reabrirem sem novo seletor, reconfirmação de permissão com um clique quando expirar.
> - **`download-adapter.ts`** — `<input type="file">` + arrastar-e-soltar para abrir; `<a download>` com Blob para salvar.
>
> **A aplicação inteira só conhece a interface.** Nenhum componente pode chamar a File System Access API diretamente.
>
> #### 3. Formato — §3
> `.json` UTF-8 indentado por padrão. Acima de 5 MB, oferecer `.pmz` (gzip via `CompressionStream`). A leitura detecta o formato pelo **magic number**, não pela extensão.
>
> #### 4. Salvamento e conflito — §4 e §5
> - `meta.revision` incrementa; `savedAt`, `savedBy`, `appVersion` carimbados.
> - **`validateDocument` antes de todo salvamento.** Documento inválido **não é gravado** — melhor recusar do que corromper o arquivo do time. Mostre o que está errado e onde.
> - Fluxo de conflito no modo `FULL`: relê o arquivo, compara o hash com o da última leitura, e **não grava** se divergir. Devolve `{ ok: false, reason: 'CONFLICT', remote }`.
> - Interface do conflito com as três saídas de §5: **Ver o que mudou** (por ora, uma lista textual — a tela de diff completa vem na S14), **Salvar como cópia** (`…-conflito-{nome}-{hora}.json`), e **Sobrescrever mesmo assim**, que exige digitar o nome do arquivo. A opção **Mesclar** aparece desabilitada com "disponível na Sessão 17".
> - **Nunca** há sobrescrita silenciosa.
> - No modo `DOWNLOAD_ONLY`, avise explicitamente que a detecção de conflito não está disponível.
>
> #### 5. Bloqueio consultivo — `src/storage/lock.ts`, §6
> Arquivo `.lock.json` ao lado, heartbeat de 60s, obsoleto após 10 min, banner ao abrir arquivo travado por outra pessoa com "Abrir somente leitura" (recomendado) ou "Editar assim mesmo", liberação em `beforeunload`. É **consultivo**, e a interface usa essa palavra.
>
> #### 6. Autosave e recuperação — `src/storage/local-buffer.ts`, §8
> IndexedDB, debounce de 3s, 10 últimos estados em rodízio, oferta de recuperação ao abrir com buffer mais novo, limpeza após salvamento bem-sucedido. Isso cobre queda do navegador, que num produto sem servidor é a principal causa de perda.
>
> #### 7. Backups — §9
> No modo `FULL`, copiar o conteúdo anterior para `_backups/{nome}.{timestamp}.json` antes de gravar, mantendo os 20 mais recentes. Falha de permissão avisa uma vez e segue.
>
> #### 8. Modo de recuperação — §10
> Se `validateDocument` falhar na leitura, **não descarte o arquivo**: abra listando os problemas em português, agrupados por gravidade, com correção automática do que tem `autoFix` e caminho no JSON do que não tem. Nada é gravado até o usuário aceitar, e a gravação é sempre "salvar como".
>
> #### 9. Tela inicial completa — `docs/07-ux-e-editor.md` §1
> Abrir, recentes (com reabertura por handle), novo, exemplo, faixa de modo, diálogo de identidade. Arrastar-e-soltar em qualquer lugar da janela.
>
> #### 10. Barra de status
> Nome do arquivo, `Salvo` / `Alterações não salvas` / `Salvando…` / `Erro`, revisão, detentor do lock. `Ctrl+S` salva, `Ctrl+Shift+S` salva como. `beforeunload` quando houver alterações não salvas.
>
> ### Testes
> Implemente **toda** a lista de §11. Destaques que não podem faltar:
> - round-trip documento → JSON → documento **deep-equal**, e o mesmo com gzip;
> - detecção de formato por magic number;
> - conflito: hash divergente devolve `CONFLICT` e **o arquivo em disco não é alterado** — verifique o conteúdo depois, não só o retorno;
> - autosave: mudança grava buffer, salvar limpa buffer, abrir com buffer mais novo oferece recuperação;
> - lock obsoleto após 10 min; heartbeat renova;
> - recuperação: documento com os 5 defeitos dos fixtures da S02 abre, lista os 5, corrige os corrigíveis, e **o arquivo original não é tocado**;
> - `DOWNLOAD_ONLY`: `save()` produz o blob correto e a aplicação avisa da ausência de detecção de conflito.
>
> E2E: abrir o exemplo → editar o nome do documento → salvar → recarregar → reabrir dos recentes → o estado voltou.
>
> ### Critérios de aceite
> - No Chromium servido por http local, abrir e salvar funcionam de verdade, com conflito detectado.
> - Abrindo por `file://`, a aplicação identifica `DOWNLOAD_ONLY`, avisa o usuário e o ciclo abrir/baixar funciona.
> - Documento inválido nunca é gravado.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes, tamanho no orçamento.
>
> ### Fora do escopo
> Merge de documentos (S17). Tela de diff (S14). Telas de biblioteca e matriz.
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push. **Marco M1**: a partir daqui o arquivo pode ir para o SharePoint e ser testado pelo time.
