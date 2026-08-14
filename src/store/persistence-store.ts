import { create } from 'zustand';
import { createEmptyDocument, createSampleDocument } from '@/core/document/create';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { serialize } from '@/core/document/serialize';
import { validateDocument, type ValidationIssue } from '@/core/document/validate';
import { DomainError } from '@/core/errors';
import { mergeDocument, type MergeResolutions } from '@/core/merge';
import type { OpenedFile, SaveResult, StorageAdapter } from '@/storage/adapter';
import {
  classifyPickerFailure,
  detectCapabilities,
  type Capabilities,
  type StorageMode,
} from '@/storage/capabilities';
import { conflictHeadline, summarizeConflict, type ConflictLine } from '@/storage/conflict';
import { createDownloadAdapter } from '@/storage/download-adapter';
import { createFsaAdapter, FsaAdapter } from '@/storage/fsa-adapter';
import {
  conflictCopyName,
  shouldOfferCompression,
  suggestedFileName,
  type FileFormat,
} from '@/storage/format';
import {
  AdvisoryLock,
  describeLock,
  isStale,
  type LockInfo,
} from '@/storage/lock';
import { createLocalBuffer, type BufferEntry, type LocalBuffer } from '@/storage/local-buffer';
import { listRecents, recentId, rememberRecent, type RecentEntry } from '@/storage/recents';
import { repairDocument, type RepairResult } from '@/storage/recovery';
import { useDocumentStore } from './document-store';
import { useUiStore } from './ui-store';

/**
 * Camada de persistência vista pela interface — docs/06-persistencia-e-concorrencia.md.
 *
 * Este store é o **único** ponto do aplicativo que fala com um
 * `StorageAdapter`. Nenhum componente conhece File System Access API,
 * `<input type="file">` ou `<a download>`: eles chamam ações daqui e leem
 * estado daqui.
 *
 * Também é quem garante as três promessas que a sessão faz ao usuário:
 * 1. documento inválido **não é gravado** (§4);
 * 2. **nunca** há sobrescrita silenciosa (§5);
 * 3. degradação de modo **nunca** é silenciosa (§1).
 */

// #region: tipos-de-estado-derivado

export type SaveStatus = 'no-document' | 'saved' | 'dirty' | 'saving' | 'error';

export const SAVE_STATUS_LABEL: Record<SaveStatus, string> = {
  'no-document': 'Nenhum documento aberto',
  saved: 'Salvo',
  dirty: 'Alterações não salvas',
  saving: 'Salvando…',
  error: 'Erro',
};

export type ConflictState = {
  headline: string;
  remote: PolicyOpsDocument;
  lines: ConflictLine[];
  fileName: string;
};

/** Merge em revisão: o documento do arquivo, à espera das decisões (§7). */
export type MergeState = {
  headline: string;
  theirs: PolicyOpsDocument;
  fileName: string;
};

export type RecoveryState = {
  fileName: string;
  issues: ValidationIssue[];
  document: PolicyOpsDocument;
  preview: RepairResult;
};

export type LockState = {
  info: LockInfo;
  stale: boolean;
  description: string;
};

export type InvalidState = {
  issues: ValidationIssue[];
};

export type DegradedState = {
  from: StorageMode;
  message: string;
};

// #region: interface-persistence-state

interface PersistenceState {
  capabilities: Capabilities;
  mode: StorageMode;
  /** Preenchido quando a chamada real ao seletor derrubou o modo (§1). */
  degraded: DegradedState | null;

  fileName: string | null;
  filePath: string | null;
  revision: number;
  lastSavedAt: string | null;
  status: SaveStatus;
  errorMessage: string | null;

  readOnly: boolean;
  lockHeldByOther: LockState | null;
  lockOwned: boolean;
  lockUnavailableReason: string | null;
  backupWarning: string | null;

  conflict: ConflictState | null;
  merge: MergeState | null;
  recovery: RecoveryState | null;
  invalid: InvalidState | null;
  /**
   * Problemas de validação de um documento aberto assim mesmo pelo modo de
   * recuperação (`openRecoveryReadOnly`). Fica visível como aviso na tela do
   * documento — abrir não é mais bloqueado, mas o aviso não desaparece
   * sozinho, porque salvar por cima continua recusado enquanto isso valer
   * (§4).
   */
  openedWithIssues: { fileName: string; issues: ValidationIssue[] } | null;
  bufferOffer: BufferEntry | null;
  /** Documento acima de 5 MB: a aplicação oferece `.pmz` antes de gravar (§3). */
  compressionOffer: { bytes: number } | null;
  /** Formato escolhido para esta sessão de edição; `null` = ainda não perguntado. */
  preferredFormat: FileFormat | null;
  /** O aviso de §5 sobre a ausência de detecção de conflito já foi lido. */
  downloadOnlyWarningDismissed: boolean;

  recents: RecentEntry[];

  init: () => void;
  openWithPicker: () => Promise<void>;
  openDroppedFile: (file: File) => Promise<void>;
  openRecent: (entry: RecentEntry) => Promise<void>;
  newDocument: (name: string) => void;
  openSample: () => void;
  closeDocument: () => Promise<void>;

  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  saveConflictCopy: () => Promise<void>;
  overwriteAnyway: (typedFileName: string) => Promise<void>;
  /** §5 "Mesclar": abre a tela de merge com o documento do arquivo. */
  startMerge: () => void;
  cancelMerge: () => void;
  /** Aplica `document/merge` com as decisões da tela e grava (§7). */
  applyMerge: (resolutions: MergeResolutions) => Promise<void>;
  dismissConflict: () => void;
  dismissInvalid: () => void;
  dismissDownloadOnlyWarning: () => void;
  /** Responde à oferta de compactação e retoma o salvamento (§3). */
  chooseFormat: (format: FileFormat) => Promise<void>;

  acceptRecovery: () => Promise<void>;
  /**
   * Abre o documento assim como está, com os problemas ainda presentes —
   * inclusive os sem correção automática. Só leitura: nada é gravado até o
   * usuário resolver os problemas e usar "salvar como" (§4 continua valendo
   * no salvamento, aqui é só visualização).
   */
  openRecoveryReadOnly: () => void;
  discardRecovery: () => void;

  recoverBuffer: () => void;
  discardBuffer: () => Promise<void>;

  enableFolderFeatures: () => Promise<void>;
  openReadOnly: () => void;
  takeLockAnyway: () => Promise<void>;
  /** `beforeunload`: solta o bloqueio consultivo, em melhor esforço (§6). */
  releaseLockOnUnload: () => Promise<void>;

  /**
   * Troca o adapter ativo. Existe para os testes injetarem um adapter
   * dirigível (handles falsos, pasta em memória) sem que nenhum componente
   * precise conhecer um adapter concreto.
   */
  _setAdapter: (adapter: StorageAdapter) => void;
}

// #region: helpers-de-modulo-fora-do-react

function actorName(): string {
  return useUiStore.getState().actor ?? 'Anônimo';
}

let adapter: StorageAdapter | null = null;
/** Salvamento parado à espera da resposta da oferta de compactação (§3). */
let pendingSave: { kind: 'save' | 'saveAs'; options?: { suggestedName?: string } } | null = null;
let buffer: LocalBuffer | null = null;
let advisoryLock: AdvisoryLock | null = null;
let initialized = false;

function buildAdapter(mode: StorageMode, onBackupUnavailable: (message: string) => void): StorageAdapter {
  return mode === 'FULL'
    ? createFsaAdapter({ getActor: actorName, onBackupUnavailable })
    : createDownloadAdapter({ getActor: actorName });
}

// #region: use-persistence-store

export const usePersistenceStore = create<PersistenceState>((set, get) => {
  // #region: helpers-internos-do-store
  const warnBackup = (message: string) => set({ backupWarning: message });

  function currentAdapter(): StorageAdapter {
    adapter ??= buildAdapter(get().mode, warnBackup);
    return adapter;
  }

  /** Degradação de modo com aviso — nunca silenciosa (§1). */
  function degradeToDownloadOnly(message: string): StorageAdapter {
    const from = get().mode;
    adapter?.close();
    adapter = buildAdapter('DOWNLOAD_ONLY', warnBackup);
    set({
      mode: 'DOWNLOAD_ONLY',
      capabilities: { ...get().capabilities, fileSystemAccess: false, mode: 'DOWNLOAD_ONLY' },
      degraded: { from, message },
    });
    return adapter;
  }

  async function afterOpen(opened: OpenedFile, source: 'picker' | 'drop' | 'recent'): Promise<void> {
    // Modo de recuperação: nada entra no store do documento até o usuário
    // aceitar as correções (§10).
    if (opened.issues.length > 0) {
      set({
        recovery: {
          fileName: opened.fileName,
          issues: opened.issues,
          document: opened.document,
          preview: repairDocument(opened.document, opened.issues),
        },
        status: 'no-document',
      });
      return;
    }

    useDocumentStore.getState().openDocument(opened.document);

    set({
      fileName: opened.fileName,
      filePath: currentAdapter().getHandleInfo()?.path ?? null,
      revision: opened.document.meta.revision,
      lastSavedAt: opened.document.meta.savedAt,
      status: 'saved',
      errorMessage: null,
      conflict: null,
      merge: null,
      invalid: null,
      recovery: null,
      openedWithIssues: null,
      readOnly: false,
    });

    const id = recentId(opened.fileName, opened.document.meta.id);
    const entry: RecentEntry = {
      id,
      fileName: opened.fileName,
      documentName: opened.document.meta.name,
      bytes: opened.raw.bytes,
      openedAt: new Date().toISOString(),
      revision: opened.document.meta.revision,
      mode: get().mode,
      hasHandle: get().mode === 'FULL' && source !== 'drop',
    };
    set({ recents: rememberRecent(entry) });

    const active = currentAdapter();
    if (active instanceof FsaAdapter) await active.rememberHandles(id);

    await acquireLock(opened.document);
    await offerBufferRecovery(opened.document);
  }

  async function acquireLock(doc: PolicyOpsDocument): Promise<void> {
    const active = currentAdapter();
    const directory = active.getDirectory();
    const fileName = get().fileName;
    if (directory === null || fileName === null || active.mode !== 'FULL') {
      set({
        lockOwned: false,
        lockHeldByOther: null,
        lockUnavailableReason:
          active.mode === 'FULL'
            ? 'O bloqueio consultivo e os backups automáticos precisam de acesso à pasta do arquivo — o seletor de arquivos dá acesso só ao arquivo.'
            : null,
      });
      return;
    }

    advisoryLock = new AdvisoryLock({
      directory,
      dataFileName: fileName,
      holder: actorName(),
    });

    const result = await advisoryLock.acquire(doc.meta.revision);
    if (result.ok) {
      advisoryLock.startHeartbeat();
      set({ lockOwned: true, lockHeldByOther: null, lockUnavailableReason: null });
      return;
    }
    if (result.reason === 'HELD') {
      const now = new Date();
      set({
        lockOwned: false,
        lockHeldByOther: {
          info: result.lock,
          stale: isStale(result.lock, now),
          description: describeLock(result.lock, now),
        },
        // "Abrir somente leitura" é o recomendado (§6).
        readOnly: true,
        lockUnavailableReason: null,
      });
      return;
    }
    set({ lockOwned: false, lockHeldByOther: null, lockUnavailableReason: result.message });
  }

  async function offerBufferRecovery(doc: PolicyOpsDocument): Promise<void> {
    buffer ??= createLocalBuffer();
    if (buffer === null) return;
    try {
      set({ bufferOffer: await buffer.recoveryOffer(doc) });
    } catch {
      // IndexedDB indisponível (aba anônima, origem opaca de file://,
      // política corporativa): sem autosave, mas abrir o arquivo continua
      // funcionando. O modo na tela inicial já informa o estado do recurso.
      set({ bufferOffer: null });
    }
  }

  function applySaveResult(result: SaveResult): void {
    if (result.ok) {
      const doc = useDocumentStore.getState().document;
      if (doc !== null) {
        useDocumentStore.getState().markSaved({
          revision: result.revision,
          savedAt: result.savedAt,
          savedBy: actorName(),
          appVersion: doc.meta.appVersion,
        });
      }
      set({
        status: 'saved',
        revision: result.revision,
        lastSavedAt: result.savedAt,
        fileName: result.fileName,
        errorMessage: null,
        conflict: null,
        merge: null,
        invalid: null,
        openedWithIssues: null,
      });
      void buffer?.clearFor(doc?.meta.id ?? '');
      void advisoryLock?.beat(result.revision);
      return;
    }

    if (result.reason === 'CONFLICT') {
      const mine = useDocumentStore.getState().document;
      set({
        status: 'error',
        conflict: {
          headline: conflictHeadline(result.remote),
          remote: result.remote,
          lines: mine === null ? [] : summarizeConflict(mine, result.remote),
          fileName: result.remoteFileName,
        },
        errorMessage: 'Conflito ao salvar: nada foi gravado.',
      });
      return;
    }

    if (result.reason === 'CANCELLED') {
      set({ status: useDocumentStore.getState().dirty ? 'dirty' : 'saved' });
      return;
    }

    set({ status: 'error', errorMessage: result.message });
  }

  async function runSave(kind: 'save' | 'saveAs', options?: { suggestedName?: string }): Promise<void> {
    const doc = useDocumentStore.getState().document;
    if (doc === null) return;

    if (get().readOnly && kind === 'save') {
      set({
        status: 'error',
        errorMessage:
          'Este documento está aberto em modo somente leitura. Use "Editar assim mesmo" no aviso de bloqueio ou salve como uma cópia.',
      });
      return;
    }

    // §4: validação antes de qualquer byte sair daqui. Documento inválido
    // não é gravado — melhor recusar do que corromper o arquivo do time.
    const validated = validateDocument(doc);
    if (!validated.ok) {
      set({ status: 'error', invalid: { issues: validated.issues }, errorMessage: null });
      return;
    }

    // §3: acima de 5 MB a aplicação **oferece** `.pmz` — não decide sozinha.
    // A pergunta é feita uma vez por sessão de edição; a resposta vale para
    // os salvamentos seguintes.
    let format = get().preferredFormat;
    if (format === null) {
      const bytes = new TextEncoder().encode(serialize(validated.document)).byteLength;
      if (shouldOfferCompression(bytes)) {
        pendingSave = { kind, options };
        set({ compressionOffer: { bytes }, status: 'dirty' });
        return;
      }
      format = 'json';
      set({ preferredFormat: format });
    }

    set({ status: 'saving', errorMessage: null });
    const active = currentAdapter();
    const withFormat = { ...options, format };
    try {
      const result =
        kind === 'save' ? await active.save(doc, withFormat) : await active.saveAs(doc, withFormat);
      applySaveResult(result);
    } catch (error) {
      if (classifyPickerFailure(error) === 'CANCELLED') {
        set({ status: useDocumentStore.getState().dirty ? 'dirty' : 'saved' });
        return;
      }
      set({
        status: 'error',
        errorMessage: error instanceof DomainError ? error.message : String(error),
      });
    }
  }

  async function openWith(
    run: (active: StorageAdapter) => Promise<OpenedFile>,
    source: 'picker' | 'drop' | 'recent',
  ): Promise<void> {
    try {
      const opened = await run(currentAdapter());
      await afterOpen(opened, source);
    } catch (error) {
      const failure = classifyPickerFailure(error);
      if (failure === 'CANCELLED') return;

      if (failure === 'UNSUPPORTED' && get().mode === 'FULL') {
        // A chamada real derrubou a suposição da detecção estática (§1).
        const fallback = degradeToDownloadOnly(
          'Este navegador tem a API de arquivos, mas ela não funciona nesta origem (é o caso de abrir o HTML por duplo clique). A aplicação passou para o modo somente download e avisa disso na tela inicial.',
        );
        if (source === 'picker') {
          try {
            await afterOpen(await fallback.open(), 'picker');
          } catch (retryError) {
            if (classifyPickerFailure(retryError) !== 'CANCELLED') {
              set({ status: 'error', errorMessage: String(retryError) });
            }
          }
        }
        return;
      }

      set({
        status: 'error',
        errorMessage:
          error instanceof DomainError
            ? error.message
            : `Não foi possível abrir o arquivo: ${String(error)}`,
      });
    }
  }

  /** Documento que ainda não tem arquivo: novo em branco e exemplo (§1 de docs/07). */
  function adoptInMemory(doc: PolicyOpsDocument): void {
    adapter?.close();
    adapter = buildAdapter(get().mode, warnBackup);
    advisoryLock = null;
    useDocumentStore.getState().openDocument(doc);
    set({
      fileName: null,
      filePath: null,
      revision: doc.meta.revision,
      lastSavedAt: null,
      // Existe só em memória: até salvar, é trabalho não gravado.
      status: 'dirty',
      errorMessage: null,
      conflict: null,
      merge: null,
      invalid: null,
      recovery: null,
      openedWithIssues: null,
      readOnly: false,
      lockHeldByOther: null,
      lockOwned: false,
      bufferOffer: null,
    });
  }

  const capabilities = detectCapabilities();
  // #region: estado-inicial-e-acoes

  return {
    capabilities,
    mode: capabilities.mode,
    degraded: null,

    fileName: null,
    filePath: null,
    revision: 0,
    lastSavedAt: null,
    status: 'no-document',
    errorMessage: null,

    readOnly: false,
    lockHeldByOther: null,
    lockOwned: false,
    lockUnavailableReason: null,
    backupWarning: null,

    conflict: null,
    merge: null,
    recovery: null,
    invalid: null,
    openedWithIssues: null,
    bufferOffer: null,
    compressionOffer: null,
    preferredFormat: null,
    downloadOnlyWarningDismissed: false,

    recents: [],

    init: () => {
      if (initialized) return;
      initialized = true;
      set({ recents: listRecents() });
      buffer ??= createLocalBuffer();

      // Identidade (docs/02 §6): o nome informado na tela inicial carimba
      // `savedBy` **e** o `actor` de todo evento de auditoria. O store do
      // documento é quem monta o `Ctx` dos comandos, então ele precisa de uma
      // cópia — sem isso, todo evento gerado pela interface nasceria sem autor
      // e o documento seria recusado na validação do salvamento (§4).
      const syncActor = (name: string | null): void => {
        useDocumentStore.getState().setActor(name ?? 'Anônimo');
      };
      syncActor(useUiStore.getState().actor);
      useUiStore.subscribe((state, previous) => {
        if (state.actor !== previous.actor) syncActor(state.actor);
      });

      // Autosave: toda mudança no documento agenda a gravação do buffer,
      // com debounce de 3 s (§8).
      useDocumentStore.subscribe((state, previous) => {
        if (state.document === previous.document) return;
        const status = get().status;
        if (state.document === null) {
          set({ status: 'no-document' });
          return;
        }
        if (state.dirty) {
          buffer?.schedule(state.document);
          if (status !== 'saving') set({ status: 'dirty' });
        }
      });
    },

    openWithPicker: () => openWith((active) => active.open(), 'picker'),

    openDroppedFile: (file) => openWith((active) => active.openFromDrop(file), 'drop'),

    openRecent: async (entry) => {
      const active = currentAdapter();
      const opened = await active.openRecent(entry.id).catch(() => null);
      if (opened !== null) {
        await afterOpen(opened, 'recent');
        return;
      }
      // Sem handle (ou permissão negada): cai no seletor, sem fingir que
      // reabriu sozinho.
      await get().openWithPicker();
    },

    newDocument: (name) =>
      adoptInMemory(createEmptyDocument(name.trim() === '' ? 'Novo documento' : name, actorName())),

    openSample: () => adoptInMemory(createSampleDocument()),

    closeDocument: async () => {
      await advisoryLock?.release();
      advisoryLock = null;
      buffer?.cancel();
      adapter?.close();
      useDocumentStore.getState().closeDocument();
      set({
        fileName: null,
        filePath: null,
        revision: 0,
        lastSavedAt: null,
        status: 'no-document',
        errorMessage: null,
        conflict: null,
        merge: null,
        invalid: null,
        recovery: null,
        openedWithIssues: null,
        readOnly: false,
        lockOwned: false,
        lockHeldByOther: null,
        bufferOffer: null,
      });
    },

    save: () => runSave('save'),

    saveAs: () => {
      const doc = useDocumentStore.getState().document;
      return runSave('saveAs', {
        suggestedName:
          get().fileName ?? (doc === null ? undefined : suggestedFileName(doc.meta.name)),
      });
    },

    /** §5 — grava num arquivo novo e **não toca** no original. */
    saveConflictCopy: async () => {
      const conflict = get().conflict;
      const fileName = conflict?.fileName ?? get().fileName ?? 'politicas.json';
      await runSave('saveAs', {
        suggestedName: conflictCopyName(fileName, actorName(), new Date()),
      });
      set({ conflict: null });
    },

    /**
     * §5 — "Sobrescrever mesmo assim". Exige digitar o nome do arquivo:
     * confirmar com um clique seria sobrescrita quase silenciosa.
     */
    overwriteAnyway: async (typedFileName) => {
      const conflict = get().conflict;
      if (conflict === null) return;
      if (typedFileName.trim() !== conflict.fileName) {
        set({
          errorMessage: `Para sobrescrever, digite exatamente o nome do arquivo: ${conflict.fileName}`,
        });
        return;
      }
      currentAdapter().acceptRemoteAsBase();
      set({ conflict: null, errorMessage: null });
      await runSave('save');
    },

    /**
     * §5 — "Mesclar". Troca o diálogo de conflito pela tela de merge; nada é
     * mesclado nem gravado aqui: a tela mostra o resultado antes.
     */
    startMerge: () => {
      const conflict = get().conflict;
      if (conflict === null) return;
      set({
        conflict: null,
        merge: {
          headline: conflict.headline,
          theirs: conflict.remote,
          fileName: conflict.fileName,
        },
        errorMessage: null,
      });
    },

    cancelMerge: () => set({ merge: null, status: 'dirty', errorMessage: null }),

    /**
     * §7 — aplica o merge com as decisões do usuário e grava.
     *
     * Depois de mesclar, o conteúdo do arquivo já está dentro do documento em
     * memória: `acceptRemoteAsBase()` é o que permite o salvamento seguinte
     * gravar por cima em vez de acusar o mesmo conflito de novo.
     */
    applyMerge: async (resolutions) => {
      const merge = get().merge;
      if (merge === null) return;
      const result = useDocumentStore
        .getState()
        .dispatch(mergeDocument({ theirs: merge.theirs, resolutions }));
      if (!result.ok) {
        set({ merge: null, status: 'error', errorMessage: result.error.message });
        return;
      }
      currentAdapter().acceptRemoteAsBase();
      set({ merge: null, conflict: null, errorMessage: null });
      await runSave('save');
    },

    dismissConflict: () => set({ conflict: null, status: 'dirty', errorMessage: null }),

    dismissInvalid: () => set({ invalid: null, status: 'dirty' }),

    dismissDownloadOnlyWarning: () => set({ downloadOnlyWarningDismissed: true }),

    chooseFormat: async (format) => {
      const pending = pendingSave;
      pendingSave = null;
      set({ compressionOffer: null, preferredFormat: format });
      if (pending !== null) await runSave(pending.kind, pending.options);
    },

    /**
     * §10 — aceita as correções automáticas. A gravação seguinte é sempre
     * "salvar como": o arquivo original fica onde está, do jeito que está.
     */
    acceptRecovery: async () => {
      const recovery = get().recovery;
      if (recovery === null) return;
      const repaired = validateDocument(recovery.preview.document);
      if (!repaired.ok) {
        set({ invalid: { issues: repaired.issues } });
        return;
      }
      useDocumentStore.getState().openDocument(repaired.document);
      set({
        recovery: null,
        fileName: null,
        filePath: null,
        revision: repaired.document.meta.revision,
        lastSavedAt: repaired.document.meta.savedAt,
        status: 'dirty',
        errorMessage: null,
      });
      await get().saveAs();
    },

    openRecoveryReadOnly: () => {
      const recovery = get().recovery;
      if (recovery === null) return;
      useDocumentStore.getState().openDocument(recovery.document);
      set({
        recovery: null,
        fileName: recovery.fileName,
        filePath: null,
        revision: recovery.document.meta.revision,
        lastSavedAt: recovery.document.meta.savedAt,
        status: 'saved',
        errorMessage: null,
        readOnly: true,
        openedWithIssues: { fileName: recovery.fileName, issues: recovery.issues },
      });
    },

    discardRecovery: () => set({ recovery: null, status: 'no-document' }),

    recoverBuffer: () => {
      const offer = get().bufferOffer;
      if (offer === null) return;
      useDocumentStore.getState().openDocument(offer.document);
      set({ bufferOffer: null, status: 'dirty', revision: offer.document.meta.revision });
    },

    discardBuffer: async () => {
      const offer = get().bufferOffer;
      set({ bufferOffer: null });
      if (offer !== null) await buffer?.clearFor(offer.docId);
    },

    enableFolderFeatures: async () => {
      const active = currentAdapter();
      const granted = await active.requestDirectoryAccess();
      if (!granted) {
        set({
          lockUnavailableReason:
            'Sem acesso à pasta, o bloqueio consultivo e os backups automáticos continuam indisponíveis. O salvamento funciona normalmente.',
        });
        return;
      }
      set({ lockUnavailableReason: null });
      const doc = useDocumentStore.getState().document;
      if (doc !== null) await acquireLock(doc);
    },

    openReadOnly: () => set({ readOnly: true, lockHeldByOther: null }),

    releaseLockOnUnload: async () => {
      await advisoryLock?.release();
    },

    takeLockAnyway: async () => {
      const doc = useDocumentStore.getState().document;
      set({ readOnly: false });
      if (advisoryLock !== null && doc !== null) {
        const result = await advisoryLock.acquire(doc.meta.revision, { force: true });
        if (result.ok) advisoryLock.startHeartbeat();
      }
      set({ lockHeldByOther: null, lockOwned: advisoryLock?.current !== null });
    },

    _setAdapter: (next) => {
      adapter = next;
      advisoryLock = null;
      set({ mode: next.mode });
    },
  };
});
