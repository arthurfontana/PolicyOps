import { describe, expect, it } from 'vitest';
import { deleteImportProfile, saveImportProfile } from '@/core/import/profile-commands';
import { validateDocument } from '@/core/document/validate';
import { apply, expectFailure, testCtx } from '../versioning/fixtures';
import { cineminhaDocument, cineminhaProfile, fixedId } from './fixtures';

/**
 * importProfile/save e importProfile/delete — docs/08-camada-de-comandos.md
 * §3, docs/03-modelo-do-documento.md §7.1/§9 (I21/I22).
 */

describe('importProfile/save', () => {
  it('cria um perfil novo no documento', () => {
    const ctx = testCtx();
    const doc = cineminhaDocument();
    const profile = cineminhaProfile();
    expect(doc.importProfiles).toEqual([]);

    const salvo = apply(doc, ctx, saveImportProfile({ profile }));
    expect(salvo.document.importProfiles).toHaveLength(1);
    expect(salvo.document.importProfiles[0]!.code).toBe('CARGA_CINEMINHA');
    expect(salvo.document.importProfiles[0]!.createdAt).toBe(ctx.now().toISOString());
    expect(salvo.data.profileId).toBe(profile.id);
    expect(validateDocument(salvo.document).ok).toBe(true);
  });

  it('atualiza pelo mesmo id, preservando createdAt e gravando updatedAt', () => {
    const ctx = testCtx();
    const doc = cineminhaDocument();
    const profile = cineminhaProfile();
    const criado = apply(doc, ctx, saveImportProfile({ profile }));
    const createdAt = criado.document.importProfiles[0]!.createdAt;

    ctx.advance(60_000);
    const atualizado = apply(
      criado.document,
      ctx,
      saveImportProfile({ profile: { ...profile, name: 'Carga do cineminha (revisada)' } }),
    );

    expect(atualizado.document.importProfiles).toHaveLength(1);
    expect(atualizado.document.importProfiles[0]!.name).toBe('Carga do cineminha (revisada)');
    expect(atualizado.document.importProfiles[0]!.createdAt).toBe(createdAt);
    expect(atualizado.document.importProfiles[0]!.updatedAt).toBe(ctx.now().toISOString());
  });

  it('colisão de code com outro id falha com IMPORT_PROFILE_DUPLICATE', () => {
    const ctx = testCtx();
    const doc = cineminhaDocument();
    const original = cineminhaProfile();
    const comOriginal = apply(doc, ctx, saveImportProfile({ profile: original })).document;

    const outroPerfil = { ...original, id: fixedId('OUTRO_PERFIL') };
    expectFailure(comOriginal, ctx, saveImportProfile({ profile: outroPerfil }), 'IMPORT_PROFILE_DUPLICATE');
  });

  it('recusa perfil estruturalmente inválido (I21) antes de tocar no documento', () => {
    const ctx = testCtx();
    const doc = cineminhaDocument();
    const semOtherwise = { ...cineminhaProfile(), decisionRules: [] };
    const erro = expectFailure(doc, ctx, saveImportProfile({ profile: semOtherwise }), 'IMPORT_PROFILE_INVALID');
    expect(erro.message).toMatch(/otherwise/);
    expect(doc.importProfiles).toEqual([]);
  });

  it('recusa variableId inexistente (I22)', () => {
    const ctx = testCtx();
    const doc = cineminhaDocument();
    const profile = cineminhaProfile();
    const comEixoQuebrado = {
      ...profile,
      columns: profile.columns.map((column) =>
        column.axis !== undefined ? { ...column, axis: { ...column.axis, variableId: fixedId('fantasma') } } : column,
      ),
    };
    expectFailure(doc, ctx, saveImportProfile({ profile: comEixoQuebrado }), 'IMPORT_PROFILE_INVALID');
  });

  it('desfazer a criação remove o perfil; desfazer a atualização restaura o valor exato anterior', () => {
    const ctx = testCtx();
    const doc = cineminhaDocument();
    const profile = cineminhaProfile();

    const criado = apply(doc, ctx, saveImportProfile({ profile }));
    const desfeitoCriacao = apply(criado.document, ctx, criado.result.inverse);
    expect(desfeitoCriacao.document.importProfiles).toEqual([]);

    ctx.advance(1000);
    const atualizado = apply(
      criado.document,
      ctx,
      saveImportProfile({ profile: { ...profile, name: 'Nome novo' } }),
    );
    // `events` é append-only — desfazer não o encolhe, então a comparação é
    // sobre o campo que a atualização de fato mexeu, não o documento inteiro
    // (mesmo padrão de `catalog/update` em tests/unit/core/library/catalog.test.ts).
    const desfeitoAtualizacao = apply(atualizado.document, ctx, atualizado.result.inverse);
    expect(desfeitoAtualizacao.document.importProfiles).toEqual(criado.document.importProfiles);
  });
});

describe('importProfile/delete', () => {
  it('apaga o perfil e o inverso recria exatamente como estava', () => {
    const ctx = testCtx();
    const doc = cineminhaDocument();
    const profile = cineminhaProfile();
    const criado = apply(doc, ctx, saveImportProfile({ profile }));

    const apagado = apply(criado.document, ctx, deleteImportProfile({ profileId: profile.id }));
    expect(apagado.document.importProfiles).toEqual([]);

    const restaurado = apply(apagado.document, ctx, apagado.result.inverse);
    expect(restaurado.document).toEqual(criado.document);
  });

  it('editar um perfil existente não altera nenhuma carga já aplicada — apagar não é registrado em evento', () => {
    const ctx = testCtx();
    const doc = cineminhaDocument();
    const profile = cineminhaProfile();
    const criado = apply(doc, ctx, saveImportProfile({ profile }));
    const apagado = apply(criado.document, ctx, deleteImportProfile({ profileId: profile.id }));
    expect(apagado.result.events).toEqual([]);
  });

  it('recusa perfil inexistente', () => {
    const ctx = testCtx();
    expectFailure(cineminhaDocument(), ctx, deleteImportProfile({ profileId: 'fantasma' }), 'NOT_FOUND');
  });
});
