import { describe, expect, it } from 'vitest';
import { updateChangeRequest } from '@/core/document/change-requests';
import { updateProject } from '@/core/document/commands';
import { DomainError } from '@/core/errors';
import {
  buildFactoryPackage,
  isFactoryPackageAvailable,
  type FactoryPackage,
} from '@/core/export/factory-package';
import { renderFactoryPackageHtml } from '@/core/export/factory-package-html';
import { renderFactoryPackageMarkdown } from '@/core/export/factory-package-markdown';
import { applyRichDocOp } from '@/core/richdoc/commands';
import { paragraphFromText } from '@/core/richdoc/model';
import { apply, IDS, testCtx } from '../versioning/fixtures';
import { dbPublicavel, dbSubmetivel, politica } from '../document/governance-fixtures';

const AT = new Date('2026-09-05T12:00:00.000Z');

function erro(run: () => void): DomainError {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('Esperava um DomainError, e a chamada passou.');
}

/** Cenário do CT-GOV-01 (docs/14 §10) com o DB-515 pronto (READY_FOR_RELEASE, ≥ APPROVED). */
function cenarioDb515() {
  const ctx = testCtx();
  const cenario = politica(ctx);
  const db = dbPublicavel(cenario.document, ctx, cenario.goodlistId);
  return { ctx, cenario, db };
}

describe('isFactoryPackageAvailable', () => {
  it('só a partir de APPROVED (mesma ordem de isChangeRequestFrozen)', () => {
    expect(isFactoryPackageAvailable('DRAFT')).toBe(false);
    expect(isFactoryPackageAvailable('SUBMITTED')).toBe(false);
    expect(isFactoryPackageAvailable('IN_REVIEW')).toBe(false);
    expect(isFactoryPackageAvailable('APPROVED')).toBe(true);
    expect(isFactoryPackageAvailable('READY_FOR_RELEASE')).toBe(true);
    expect(isFactoryPackageAvailable('PUBLISHED')).toBe(true);
    expect(isFactoryPackageAvailable('CANCELLED')).toBe(true);
  });
});

describe('buildFactoryPackage', () => {
  it('recusa DB antes de APPROVED com CR_TRANSITION_INVALID', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);
    const err = erro(() => buildFactoryPackage(db.document, db.changeRequestId, AT));
    expect(err.code).toBe('CR_TRANSITION_INVALID');
  });

  it('monta identificação, registro de versão, escopo (hoje × proposto) e vigência do DB-515', () => {
    const { db } = cenarioDb515();
    const pkg = buildFactoryPackage(db.document, db.changeRequestId, AT);

    expect(pkg.identification.changeRequestCode).toBe('DB_515');
    expect(pkg.identification.title).toBe('Goodlist passa a olhar o valor do pedido');
    expect(pkg.identification.status).toBe('READY_FOR_RELEASE');
    expect(pkg.identification.generatedAt).toBe(AT.toISOString());

    expect(pkg.versionHistory).toEqual([expect.objectContaining({ action: 'Criação do DB' })]);

    expect(pkg.items).toHaveLength(1);
    expect(pkg.items[0]).toMatchObject({
      componentCode: 'REGRA_GOODLIST',
      componentType: 'RULE',
      changeType: 'UPDATE',
      current: 'Hoje aprova sempre que estiver na lista.',
      proposed: 'Aprova só se o valor do pedido for menor ou igual ao limite em lista.',
    });

    expect(pkg.effectiveDate).toBe('2026-09-01T00:00:00.000Z');
    expect(pkg.motivators).toEqual(['Ajuste de risco']);
  });

  it('DB sem factoryTemplate no projeto → pacote sem boilerplate, sem erro', () => {
    const { db } = cenarioDb515();
    const pkg = buildFactoryPackage(db.document, db.changeRequestId, AT);
    expect(pkg.boilerplate).toBeNull();
    expect(pkg.contacts).toEqual([]);

    // As duas saídas renderizam sem lançar e sem seção de boilerplate.
    const html = renderFactoryPackageHtml(pkg);
    const markdown = renderFactoryPackageMarkdown(pkg);
    expect(html).not.toContain('>Boilerplate<');
    expect(markdown).not.toContain('## Boilerplate');
  });

  it('com factoryTemplate no projeto, o pacote traz boilerplate e contatos', () => {
    const { ctx, db } = cenarioDb515();
    const comContatos = apply(
      db.document,
      ctx,
      updateProject({
        projectId: IDS.projectA,
        factoryContacts: [{ name: 'Equipe de Políticas', role: 'Solicitante' }],
      }),
    );
    const comBoilerplate = apply(
      comContatos.document,
      ctx,
      applyRichDocOp({
        target: { kind: 'PROJECT_FACTORY_BOILERPLATE', projectId: IDS.projectA },
        op: { kind: 'insertBlock', index: 0, block: paragraphFromText('bp1', 'Checklist Serasa.') },
      }),
    );

    const pkg = buildFactoryPackage(comBoilerplate.document, db.changeRequestId, AT);
    expect(pkg.boilerplate).not.toBeNull();
    expect(pkg.contacts).toEqual([{ name: 'Equipe de Políticas', role: 'Solicitante' }]);

    const html = renderFactoryPackageHtml(pkg);
    const markdown = renderFactoryPackageMarkdown(pkg);
    expect(html).toContain('Checklist Serasa.');
    expect(markdown).toContain('Checklist Serasa.');
    expect(html).toContain('Equipe de Políticas');
    expect(markdown).toContain('Equipe de Políticas');
  });

  it('regeneração após editar o DB reflete a edição (RN-GOV-08: sempre derivado)', () => {
    const { ctx, db } = cenarioDb515();
    const antes = buildFactoryPackage(db.document, db.changeRequestId, AT);
    expect(antes.identification.title).toBe('Goodlist passa a olhar o valor do pedido');

    const editado = apply(
      db.document,
      ctx,
      updateChangeRequest({ changeRequestId: db.changeRequestId, title: 'Goodlist — título revisado' }),
    );
    const depois = buildFactoryPackage(editado.document, db.changeRequestId, AT);
    expect(depois.identification.title).toBe('Goodlist — título revisado');
  });
});

describe('snapshot do pacote gerado — DB-515 (CT-GOV-01)', () => {
  function pacoteComTemplate(): FactoryPackage {
    const { ctx, db } = cenarioDb515();
    const comTemplate = apply(
      db.document,
      ctx,
      updateProject({
        projectId: IDS.projectA,
        factoryContacts: [
          { name: 'Equipe de Políticas de Crédito', role: 'Solicitante', email: 'politicas@exemplo.com' },
        ],
      }),
    );
    const comBoilerplate = apply(
      comTemplate.document,
      ctx,
      applyRichDocOp({
        target: { kind: 'PROJECT_FACTORY_BOILERPLATE', projectId: IDS.projectA },
        op: {
          kind: 'insertBlock',
          index: 0,
          block: paragraphFromText('bp1', 'Checklist Serasa — desenvolvimento, DET e pós-produção.'),
        },
      }),
    );
    return buildFactoryPackage(comBoilerplate.document, db.changeRequestId, AT);
  }

  it('HTML de impressão', () => {
    expect(renderFactoryPackageHtml(pacoteComTemplate())).toMatchSnapshot();
  });

  it('Markdown', () => {
    expect(renderFactoryPackageMarkdown(pacoteComTemplate())).toMatchSnapshot();
  });
});
