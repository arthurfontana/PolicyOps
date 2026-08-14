import { beforeEach, describe, expect, it } from 'vitest';
import type { Command, Ctx } from '@/core/command';
import { defineCommand, irreversible } from '@/core/command';
import { createProject, setAcl, updateProject } from '@/core/document/commands';
import type { Acl, PolicyOpsDocument, Role } from '@/core/document/schema';
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

/** Comando de fachada: só existe para o gate de papéis enxergar um `type` real sem montar fixtures de versão/matriz. */
function fakeCommand(type: string): Command<unknown, void> {
  return defineCommand({
    type,
    input: undefined,
    label: type,
    execute: (document) => ({
      document,
      data: undefined,
      events: [],
      inverse: irreversible(`"${type}" é só de teste, sem inverso.`),
    }),
  });
}

function documentWithAcl(acl: Acl | undefined): PolicyOpsDocument {
  const doc = baseDocument();
  if (acl === undefined) delete doc.meta.acl;
  else doc.meta.acl = acl;
  return doc;
}

describe('gate de papéis no dispatch (docs/14-plataforma-local.md §6, docs/08 §3)', () => {
  const ACL: Acl = {
    users: [
      { username: 'admin1', role: 'ADMIN' },
      { username: 'pub1', role: 'PUBLISHER' },
      { username: 'ed1', role: 'EDITOR' },
      { username: 'read1', role: 'READER' },
    ],
    defaultRole: 'READER',
  };

  function resetAs(username: string): void {
    reset(documentWithAcl(ACL));
    useDocumentStore.getState().setIdentity({ username, source: 'typed' });
  }

  it('sem ACL (modo aberto): qualquer identidade dispara qualquer comando, inclusive acl/set', () => {
    reset(documentWithAcl(undefined));
    useDocumentStore.getState().setIdentity({ username: 'ninguem-na-lista', source: 'typed' });
    expect(store().dispatch(fakeCommand('version/publish')).ok).toBe(true);
    expect(store().dispatch(fakeCommand('acl/set')).ok).toBe(true);
  });

  it.each<[Role, string, string, boolean]>([
    ['READER', 'read1', 'version/createDraft', false],
    ['EDITOR', 'ed1', 'version/createDraft', true],
    ['EDITOR', 'ed1', 'version/publish', false],
    ['PUBLISHER', 'pub1', 'version/publish', true],
    ['PUBLISHER', 'pub1', 'import/apply', true],
    ['PUBLISHER', 'pub1', 'matrix/archive', true],
    ['PUBLISHER', 'pub1', 'acl/set', false],
    ['ADMIN', 'admin1', 'acl/set', true],
    ['ADMIN', 'admin1', 'version/createDraft', true],
    ['ADMIN', 'admin1', 'version/publish', true],
  ])('%s (%s) → %s: permitido = %s', (_role, username, commandType, allowed) => {
    resetAs(username);
    const result = store().dispatch(fakeCommand(commandType));
    expect(result.ok).toBe(allowed);
    if (!allowed) {
      expect(!result.ok && result.error.code).toBe('ROLE_REQUIRED');
      expect(!result.ok && result.error.message).toContain('Requer papel');
    }
  });

  it('username não listado usa o defaultRole da ACL', () => {
    resetAs('alguem-fora-da-lista');
    expect(store().dispatch(fakeCommand('version/createDraft')).ok).toBe(false); // defaultRole READER
  });

  it('ROLE_REQUIRED não altera o documento nem empilha undo', () => {
    resetAs('read1');
    const before = store().document;
    const result = store().dispatch(fakeCommand('version/createDraft'));
    expect(result.ok).toBe(false);
    expect(store().document).toBe(before);
    expect(store().undoStack).toHaveLength(0);
  });

  it('undo/redo não passam pelo gate (executam o inverso de um comando já permitido)', () => {
    resetAs('ed1');
    const result = store().dispatch(createProject({ code: 'PROJ_C', name: 'C' }));
    expect(result.ok).toBe(true);
    // Rebaixa a própria identidade para READER só depois de já ter editado —
    // undo() ainda deve funcionar, porque quem gatilha é `execute`, não `dispatch`.
    useDocumentStore.getState().setIdentity({ username: 'read1', source: 'typed' });
    const undone = store().undo();
    expect(undone?.ok).toBe(true);
  });

  it('acl/set (ADMIN) troca a ACL e o inverso restaura a anterior', () => {
    resetAs('admin1');
    const next: Acl = { users: [{ username: 'admin1', role: 'ADMIN' }], defaultRole: 'EDITOR' };
    const result = store().dispatch(setAcl({ acl: next }));
    expect(result.ok).toBe(true);
    expect(store().document!.meta.acl).toEqual(next);
    expect(store().document!.events.at(-1)!.type).toBe('ACL_CHANGED');

    store().undo();
    expect(store().document!.meta.acl).toEqual(ACL);
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
