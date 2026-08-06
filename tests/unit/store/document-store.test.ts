import { beforeEach, describe, expect, it } from 'vitest';
import type { Command, Ctx } from '@/core/command';
import { defineCommand, irreversible } from '@/core/command';
import { createProject, updateProject } from '@/core/document/commands';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { validateDocument } from '@/core/document/validate';
import { applyCellPatch } from '@/core/versioning/cells';
import {
  discardDraft,
  locateVersion,
  publishVersion,
} from '@/core/versioning/lifecycle';
import { UNDO_STACK_DEPTH, useDocumentStore } from '@/store/document-store';
import {
  apply,
  baseDocument,
  coordsOf,
  createTestMatrix,
  fillAllCells,
  IDS,
  testCtx,
  withoutEvents,
} from '../core/versioning/fixtures';

/**
 * O store é a fronteira de impureza da camada de comandos. Nos testes ele
 * recebe um `Ctx` determinístico, e é isso que permite comparar documentos
 * inteiros depois de desfazer e refazer.
 */
function reset(document: PolicyOpsDocument | null = baseDocument()): Ctx {
  const ctx = testCtx();
  // O ator continua vindo do store; a hora e os ids, do relógio determinístico.
  useDocumentStore.setState({ ctxFactory: (actor) => ({ ...ctx, actor }) });
  useDocumentStore.getState().setActor('Arthur');
  if (document === null) useDocumentStore.getState().closeDocument();
  else useDocumentStore.getState().openDocument(document);
  return ctx;
}

const store = () => useDocumentStore.getState();

beforeEach(() => {
  reset();
});

describe('dispatch', () => {
  it('substitui o documento, empilha, limpa o redo e marca dirty', () => {
    expect(store().dirty).toBe(false);
    const result = store().dispatch(createProject({ code: 'PROJ_C', name: 'Projeto C' }));

    expect(result.ok).toBe(true);
    expect(store().document!.projects).toHaveLength(3);
    expect(store().dirty).toBe(true);
    expect(store().undoStack).toHaveLength(1);
    expect(store().undoStack[0]!.label).toBe('Criar o projeto "PROJ_C"');
    expect(store().canUndo).toBe(true);
    expect(store().canRedo).toBe(false);
  });

  it('erro não altera o documento e não empilha nada', () => {
    const antes = store().document;
    const result = store().dispatch(createProject({ code: 'PROJ_A', name: 'Duplicado' }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('DUPLICATE_CODE');
    expect(store().document).toBe(antes);
    expect(store().undoStack).toHaveLength(0);
    expect(store().dirty).toBe(false);
  });

  it('recusa comandos sem documento aberto', () => {
    reset(null);
    const result = store().dispatch(createProject({ code: 'PROJ_C', name: 'C' }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
    expect(store().undo()).toBeNull();
  });

  it('não empilha comandos sem inverso natural', () => {
    const ctx = reset();
    const created = createTestMatrix(baseDocument(), ctx);
    reset(fillAllCells(created.document, ctx, created.data.versionId));

    const result = store().dispatch(
      publishVersion({ versionId: created.data.versionId, notes: 'Publicação inicial.' }),
    );
    expect(result.ok).toBe(true);
    expect(store().undoStack).toHaveLength(0);
    expect(store().canUndo).toBe(false);
  });

  it('publicar limpa a pilha de undo daquela versão', () => {
    const ctx = reset();
    const created = createTestMatrix(baseDocument(), ctx);
    reset(created.document);
    const versionId = created.data.versionId;
    const coords = coordsOf(created.document, versionId);

    // Duas edições na versão que vai ser publicada, uma em outro projeto.
    store().dispatch(applyCellPatch({ versionId, patch: { coords, set: { decision: 'APROVADO' } } }));
    store().dispatch(createProject({ code: 'PROJ_C', name: 'Projeto C' }));
    store().dispatch(
      applyCellPatch({ versionId, patch: { coords: [coords[0]!], set: { offer: 'OFERTA_A' } } }),
    );
    expect(store().undoStack).toHaveLength(3);

    store().dispatch(publishVersion({ versionId, notes: 'Publicação inicial.' }));

    // Sobra só o comando que não era daquela versão — desfazer uma edição de
    // célula publicada falharia com VERSION_IMMUTABLE.
    expect(store().undoStack.map((entry) => entry.command.type)).toEqual(['project/create']);
    expect(store().canUndo).toBe(true);
  });

  it('limita a pilha a 100 entradas, descartando as mais antigas', () => {
    for (let index = 0; index < UNDO_STACK_DEPTH + 5; index++) {
      const result = store().dispatch(
        updateProject({ projectId: IDS.projectA, name: `Projeto ${index}` }),
      );
      expect(result.ok).toBe(true);
    }
    expect(store().undoStack).toHaveLength(UNDO_STACK_DEPTH);
    expect(store().document!.projects[0]!.name).toBe(`Projeto ${UNDO_STACK_DEPTH + 4}`);
  });

  it('abrir e fechar documento zera as pilhas', () => {
    store().dispatch(createProject({ code: 'PROJ_C', name: 'C' }));
    expect(store().canUndo).toBe(true);

    useDocumentStore.getState().openDocument(baseDocument());
    expect(store().undoStack).toHaveLength(0);
    expect(store().redoStack).toHaveLength(0);
    expect(store().dirty).toBe(false);

    store().dispatch(createProject({ code: 'PROJ_C', name: 'C' }));
    useDocumentStore.getState().closeDocument();
    expect(store().document).toBeNull();
    expect(store().canUndo).toBe(false);
  });

  it('salvar não limpa a pilha — desfazer depois volta a sujar', () => {
    store().dispatch(createProject({ code: 'PROJ_C', name: 'C' }));
    useDocumentStore.getState().markSaved();
    expect(store().dirty).toBe(false);
    expect(store().canUndo).toBe(true);

    store().undo();
    expect(store().dirty).toBe(true);
  });
});

describe('undo e redo', () => {
  it('desfazer e refazer devolvem exatamente o mesmo documento', () => {
    const original = store().document!;
    store().dispatch(createProject({ code: 'PROJ_C', name: 'Projeto C' }));
    const depois = store().document!;

    store().undo();
    expect(withoutEvents(store().document!)).toEqual(withoutEvents(original));
    expect(store().canUndo).toBe(false);
    expect(store().canRedo).toBe(true);

    store().redo();
    expect(withoutEvents(store().document!)).toEqual(withoutEvents(depois));
    expect(store().canUndo).toBe(true);
    expect(store().canRedo).toBe(false);
  });

  it('10 operações, desfazer todas, refazer todas — documento idêntico ao final', () => {
    const ctx = reset();
    const created = createTestMatrix(baseDocument(), ctx);
    reset(created.document);
    const versionId = created.data.versionId;
    const coords = coordsOf(created.document, versionId);
    const inicial = store().document!;

    const operacoes: Array<Command<unknown, unknown>> = [
      createProject({ code: 'PROJ_C', name: 'Projeto C' }),
      updateProject({ projectId: IDS.projectA, name: 'Projeto A renomeado' }),
      applyCellPatch({ versionId, patch: { coords, set: { decision: 'APROVADO' } } }),
      applyCellPatch({ versionId, patch: { coords: coords.slice(0, 3), set: { offer: 'OFERTA_A' } } }),
      applyCellPatch({ versionId, patch: { coords: [coords[0]!], set: { decision: 'REPROVADO' } } }),
      applyCellPatch({ versionId, patch: { coords: [coords[1]!], set: { note: 'Rever' } } }),
      applyCellPatch({ versionId, patch: { coords: [coords[1]!], set: { attrs: { peso: 3 } } } }),
      applyCellPatch({ versionId, patch: { coords: coords.slice(2, 5), set: { color: '#DC2626' } } }),
      applyCellPatch({ versionId, patch: { coords: [coords[0]!], set: { decision: null, offer: null } } }),
      updateProject({ projectId: IDS.projectA, description: 'Descrição nova' }),
    ];

    const estados: PolicyOpsDocument[] = [];
    for (const operacao of operacoes) {
      const result = store().dispatch(operacao);
      expect(result.ok, `falhou: ${operacao.type}`).toBe(true);
      estados.push(store().document!);
    }
    const final = store().document!;
    expect(store().undoStack).toHaveLength(10);

    // Desfaz tudo.
    for (let index = 9; index >= 0; index--) {
      store().undo();
      const esperado = index === 0 ? inicial : estados[index - 1]!;
      expect(withoutEvents(store().document!)).toEqual(withoutEvents(esperado));
    }
    expect(store().canUndo).toBe(false);
    expect(store().redoStack).toHaveLength(10);

    // Refaz tudo.
    for (let index = 0; index < 10; index++) {
      store().redo();
      expect(withoutEvents(store().document!)).toEqual(withoutEvents(estados[index]!));
    }
    expect(withoutEvents(store().document!)).toEqual(withoutEvents(final));
    expect(store().canRedo).toBe(false);
    expect(validateDocument(store().document!).ok).toBe(true);
  });

  it('desfazer gera evento próprio — o histórico registra o arrependimento', () => {
    const ctx = reset();
    const created = createTestMatrix(baseDocument(), ctx);
    reset(created.document);
    const versionId = created.data.versionId;

    const antes = store().document!.events.length;
    store().dispatch(
      applyCellPatch({
        versionId,
        patch: { coords: coordsOf(created.document, versionId).slice(0, 1), set: { decision: 'APROVADO' } },
      }),
    );
    store().undo();

    const events = store().document!.events;
    expect(events).toHaveLength(antes + 2);
    expect(events.slice(-2).map((event) => event.type)).toEqual([
      'CELLS_UPDATED',
      'CELLS_UPDATED',
    ]);
  });

  it('um comando novo invalida o caminho de volta', () => {
    store().dispatch(createProject({ code: 'PROJ_C', name: 'C' }));
    store().undo();
    expect(store().canRedo).toBe(true);

    store().dispatch(createProject({ code: 'PROJ_D', name: 'D' }));
    expect(store().redoStack).toHaveLength(0);
    expect(store().canRedo).toBe(false);
  });

  it('redo sem nada para refazer devolve null', () => {
    expect(store().redo()).toBeNull();
    expect(store().undo()).toBeNull();
  });

  it('descartar rascunho não empilha — não há como desfazer', () => {
    const ctx = reset();
    const created = createTestMatrix(baseDocument(), ctx);
    reset(created.document);

    const draft = store().document!.matrices[0]!.versions[0]!.id;
    const result = store().dispatch(discardDraft({ versionId: draft }));
    expect(result.ok).toBe(true);
    expect(store().undoStack).toHaveLength(0);
    expect(locateVersion(store().document!, draft).version.state).toBe('ARCHIVED');
  });

  it('undo cujo inverso falha devolve o erro sem mexer no documento', () => {
    const ctx = reset();
    const created = createTestMatrix(baseDocument(), ctx);
    reset(created.document);
    const versionId = created.data.versionId;

    // Uma edição de células empilhada...
    store().dispatch(
      applyCellPatch({
        versionId,
        patch: { coords: coordsOf(created.document, versionId), set: { decision: 'APROVADO' } },
      }),
    );
    expect(store().undoStack).toHaveLength(1);

    // ...e a versão é publicada por fora do store (outra aba, um merge, um
    // documento recarregado). O inverso empilhado deixa de ser aplicável.
    const publicado = apply(
      store().document!,
      ctx,
      publishVersion({ versionId, notes: 'Publicação inicial.' }),
    ).document;
    useDocumentStore.setState({ document: publicado });

    const result = store().undo();
    expect(result?.ok).toBe(false);
    expect(result && !result.ok && result.error.code).toBe('VERSION_IMMUTABLE');
    expect(store().document).toBe(publicado);
  });
});

describe('ctx do store', () => {
  it('usa o ator configurado e um inverso irreversível não é empilhado', () => {
    useDocumentStore.getState().setActor('Marina');
    const result = store().dispatch(
      defineCommand({
        type: 'teste/ator',
        input: null,
        label: 'Teste',
        execute: (document, ctx) => ({
          document,
          data: ctx.actor,
          events: [],
          inverse: irreversible('sem inverso'),
        }),
      }),
    );
    expect(result.ok && result.data).toBe('Marina');
    expect(store().undoStack).toHaveLength(0);
  });
});
