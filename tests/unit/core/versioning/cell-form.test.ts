import { describe, expect, it } from 'vitest';
import { buildPatchFromForm, computeFieldState, type TouchedFieldKey } from '@/core/versioning/cell-form';
import type { Cell } from '@/core/document/schema';

const COORDS = [{ xPath: 'VAREJO', yPath: 'R1' }];

describe('computeFieldState', () => {
  it('vazio quando não há célula nenhuma selecionada', () => {
    expect(computeFieldState([], 'decision')).toEqual({ kind: 'empty' });
  });

  it('vazio quando nenhuma célula tem o campo', () => {
    const cells: Array<Cell | undefined> = [undefined, {}];
    expect(computeFieldState(cells, 'decision')).toEqual({ kind: 'empty' });
  });

  it('uniforme quando todas as células têm o mesmo valor', () => {
    const cells: Cell[] = [{ decision: 'APROVADO' }, { decision: 'APROVADO' }];
    expect(computeFieldState(cells, 'decision')).toEqual({ kind: 'uniform', value: 'APROVADO' });
  });

  it('divergente quando os valores presentes diferem', () => {
    const cells: Cell[] = [{ decision: 'APROVADO' }, { decision: 'REPROVADO' }];
    expect(computeFieldState(cells, 'decision')).toEqual({ kind: 'divergent' });
  });

  it('divergente quando algumas células têm o campo e outras não', () => {
    const cells: Array<Cell | undefined> = [{ decision: 'APROVADO' }, undefined];
    expect(computeFieldState(cells, 'decision')).toEqual({ kind: 'divergent' });
  });
});

describe('buildPatchFromForm', () => {
  // As 9 combinações de (uniforme / divergente / vazio) × (tocado / intocado)
  // para o campo `decision`. Campo intocado nunca entra — não importa o
  // estado; campo tocado sempre entra, com o valor do formulário.

  it('uniforme + intocado: não entra no patch', () => {
    const touched = new Set<TouchedFieldKey>();
    const patch = buildPatchFromForm(touched, { decision: 'APROVADO' }, COORDS);
    expect(patch).toBeNull();
  });

  it('uniforme + tocado com o mesmo valor: entra com o valor', () => {
    const touched = new Set<TouchedFieldKey>(['decision']);
    const patch = buildPatchFromForm(touched, { decision: 'APROVADO' }, COORDS);
    expect(patch).toEqual({ coords: COORDS, set: { decision: 'APROVADO' } });
  });

  it('uniforme + tocado com null (Limpar): entra como null', () => {
    const touched = new Set<TouchedFieldKey>(['decision']);
    const patch = buildPatchFromForm(touched, { decision: null }, COORDS);
    expect(patch).toEqual({ coords: COORDS, set: { decision: null } });
  });

  it('divergente + intocado: não entra no patch', () => {
    const touched = new Set<TouchedFieldKey>();
    // valor sintético do placeholder "— vários —" nunca é passado como string real
    const patch = buildPatchFromForm(touched, {}, COORDS);
    expect(patch).toBeNull();
  });

  it('divergente + tocado com um novo valor: entra com o valor escolhido', () => {
    const touched = new Set<TouchedFieldKey>(['decision']);
    const patch = buildPatchFromForm(touched, { decision: 'REPROVADO' }, COORDS);
    expect(patch).toEqual({ coords: COORDS, set: { decision: 'REPROVADO' } });
  });

  it('divergente + tocado com null (Limpar): entra como null', () => {
    const touched = new Set<TouchedFieldKey>(['decision']);
    const patch = buildPatchFromForm(touched, { decision: null }, COORDS);
    expect(patch).toEqual({ coords: COORDS, set: { decision: null } });
  });

  it('vazio + intocado: não entra no patch', () => {
    const touched = new Set<TouchedFieldKey>();
    const patch = buildPatchFromForm(touched, {}, COORDS);
    expect(patch).toBeNull();
  });

  it('vazio + tocado com um valor: entra com o valor', () => {
    const touched = new Set<TouchedFieldKey>(['decision']);
    const patch = buildPatchFromForm(touched, { decision: 'ANALISE_MANUAL' }, COORDS);
    expect(patch).toEqual({ coords: COORDS, set: { decision: 'ANALISE_MANUAL' } });
  });

  it('vazio + tocado com null (Limpar): entra como null, mesmo já vazio', () => {
    const touched = new Set<TouchedFieldKey>(['decision']);
    const patch = buildPatchFromForm(touched, { decision: null }, COORDS);
    expect(patch).toEqual({ coords: COORDS, set: { decision: null } });
  });

  // Outros comportamentos essenciais da função pura.

  it('mistura campos tocados e intocados: só os tocados entram', () => {
    const touched = new Set<TouchedFieldKey>(['offer']);
    const patch = buildPatchFromForm(
      touched,
      { decision: 'APROVADO', offer: 'OFERTA_8', limit: 'LIMITE_A' },
      COORDS,
    );
    expect(patch).toEqual({ coords: COORDS, set: { offer: 'OFERTA_8' } });
  });

  it('attrs só entra quando "attrs" está tocado', () => {
    const touched = new Set<TouchedFieldKey>(['attrs']);
    const patch = buildPatchFromForm(touched, { attrs: { risco: 'alto', antigo: null } }, COORDS);
    expect(patch).toEqual({ coords: COORDS, set: { attrs: { risco: 'alto', antigo: null } } });
  });

  it('nada tocado: devolve null', () => {
    expect(buildPatchFromForm(new Set(), {}, COORDS)).toBeNull();
  });

  it('sem coordenadas: devolve null mesmo com campos tocados', () => {
    const touched = new Set<TouchedFieldKey>(['decision']);
    expect(buildPatchFromForm(touched, { decision: 'APROVADO' }, [])).toBeNull();
  });
});
