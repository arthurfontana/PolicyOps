import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PolicyOpsDocument, Role } from '@/core/document/schema';
import {
  describeRoleRequirement,
  minRoleForCommand,
  resolveRole,
  roleAtLeast,
} from '@/core/document/roles';

function loadFixture(name: string): PolicyOpsDocument {
  const path = fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8')) as PolicyOpsDocument;
}

function base(): PolicyOpsDocument {
  return structuredClone(loadFixture('valid-base.json'));
}

describe('resolveRole — docs/14-plataforma-local.md §6', () => {
  it('ACL ausente: todo mundo é PUBLISHER (modo aberto)', () => {
    const doc = base();
    expect(doc.meta.acl).toBeUndefined();
    expect(resolveRole(doc, 'qualquer')).toBe('PUBLISHER');
  });

  it('ACL com users vazio: todo mundo é PUBLISHER (modo aberto)', () => {
    const doc = base();
    doc.meta.acl = { users: [], defaultRole: 'READER' };
    expect(resolveRole(doc, 'qualquer')).toBe('PUBLISHER');
  });

  it('ACL populada sem nenhum ADMIN: também modo aberto (checkI24 é o WARNING correspondente)', () => {
    const doc = base();
    doc.meta.acl = {
      users: [{ username: 'jsilva', role: 'EDITOR' }],
      defaultRole: 'READER',
    };
    expect(resolveRole(doc, 'jsilva')).toBe('PUBLISHER');
    expect(resolveRole(doc, 'msouza')).toBe('PUBLISHER');
  });

  it('username listado: o papel da lista', () => {
    const doc = base();
    doc.meta.acl = {
      users: [
        { username: 'admin1', role: 'ADMIN' },
        { username: 'jsilva', role: 'EDITOR' },
        { username: 'msouza', role: 'PUBLISHER' },
      ],
      defaultRole: 'READER',
    };
    expect(resolveRole(doc, 'admin1')).toBe('ADMIN');
    expect(resolveRole(doc, 'jsilva')).toBe('EDITOR');
    expect(resolveRole(doc, 'msouza')).toBe('PUBLISHER');
  });

  it('username não listado: acl.defaultRole', () => {
    const doc = base();
    doc.meta.acl = {
      users: [{ username: 'admin1', role: 'ADMIN' }],
      defaultRole: 'EDITOR',
    };
    expect(resolveRole(doc, 'desconhecido')).toBe('EDITOR');

    doc.meta.acl.defaultRole = 'READER';
    expect(resolveRole(doc, 'desconhecido')).toBe('READER');
  });
});

describe('roleAtLeast', () => {
  const order: Role[] = ['READER', 'EDITOR', 'PUBLISHER', 'ADMIN'];

  it('todo papel alcança a si mesmo', () => {
    for (const role of order) expect(roleAtLeast(role, role)).toBe(true);
  });

  it('ADMIN alcança todos os papéis', () => {
    for (const role of order) expect(roleAtLeast('ADMIN', role)).toBe(true);
  });

  it('READER só alcança READER', () => {
    expect(roleAtLeast('READER', 'EDITOR')).toBe(false);
    expect(roleAtLeast('READER', 'PUBLISHER')).toBe(false);
    expect(roleAtLeast('READER', 'ADMIN')).toBe(false);
  });

  it('EDITOR não alcança PUBLISHER nem ADMIN', () => {
    expect(roleAtLeast('EDITOR', 'PUBLISHER')).toBe(false);
    expect(roleAtLeast('EDITOR', 'ADMIN')).toBe(false);
  });

  it('PUBLISHER não alcança ADMIN', () => {
    expect(roleAtLeast('PUBLISHER', 'ADMIN')).toBe(false);
  });
});

describe('minRoleForCommand — tabela de papéis de docs/14 §6', () => {
  it('rascunho, biblioteca e tags: EDITOR', () => {
    for (const type of [
      'version/createDraft',
      'version/applyCellPatch',
      'version/applyCellPatches',
      'version/discardDraft',
      'version/addNote',
      'axis/addLevel',
      'axis/removeLevel',
      'axis/reorderLevels',
      'axis/suppressTuples',
      'axis/restoreTuples',
      'axis/resnapshot',
      'variable/create',
      'variable/saveDomains',
      'compat/create',
      'compat/saveMap',
      'catalog/create',
      'matrix/setTags',
      'matrix/create',
      'document/rename',
      'template/create',
      'importProfile/save',
    ]) {
      expect(minRoleForCommand(type)).toBe('EDITOR');
    }
  });

  it('publicar, aplicar carga e arquivar matriz: PUBLISHER', () => {
    expect(minRoleForCommand('version/publish')).toBe('PUBLISHER');
    expect(minRoleForCommand('import/apply')).toBe('PUBLISHER');
    expect(minRoleForCommand('matrix/archive')).toBe('PUBLISHER');
  });

  it('editar a ACL: ADMIN', () => {
    expect(minRoleForCommand('acl/set')).toBe('ADMIN');
  });

  it('comando desconhecido cai no piso padrão EDITOR', () => {
    expect(minRoleForCommand('algo/inventado')).toBe('EDITOR');
  });
});

describe('describeRoleRequirement', () => {
  it('frase pronta em pt-BR', () => {
    expect(describeRoleRequirement('PUBLISHER', 'EDITOR')).toBe(
      'Requer papel PUBLISHER — você é EDITOR.',
    );
  });
});
