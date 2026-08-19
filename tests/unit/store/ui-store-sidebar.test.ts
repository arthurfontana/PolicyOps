// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  parseSidebarWidth,
  useUiStore,
} from '@/store/ui-store';

/**
 * Largura da navegação — docs/07-ux-e-editor.md §2, DEC-UX-005 e CT-UX-05:
 * preferência de interface, persistida em `localStorage`, validada na leitura.
 */

const KEY = 'policyops.sidebarWidth';

beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({ sidebarWidth: SIDEBAR_DEFAULT_WIDTH });
});

describe('parseSidebarWidth — validação do intervalo na leitura', () => {
  it('sem valor guardado usa o padrão', () => {
    expect(parseSidebarWidth(null)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it('valor dentro do intervalo é respeitado', () => {
    expect(parseSidebarWidth('420')).toBe(420);
    expect(parseSidebarWidth(String(SIDEBAR_MIN_WIDTH))).toBe(SIDEBAR_MIN_WIDTH);
    expect(parseSidebarWidth(String(SIDEBAR_MAX_WIDTH))).toBe(SIDEBAR_MAX_WIDTH);
  });

  it('valor fora do intervalo cai no padrão — nem 4px nem 4000px de navegação', () => {
    expect(parseSidebarWidth('12')).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(parseSidebarWidth('4000')).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(parseSidebarWidth('-300')).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it('valor corrompido cai no padrão', () => {
    expect(parseSidebarWidth('largo')).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(parseSidebarWidth('')).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(parseSidebarWidth('{"width":420}')).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(parseSidebarWidth('NaN')).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});

describe('clampSidebarWidth — arrastar não passa dos limites', () => {
  it('prende nos dois extremos e arredonda', () => {
    expect(clampSidebarWidth(100)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(900)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(320.6)).toBe(321);
  });

  it('valor não finito cai no padrão', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});

describe('setSidebarWidth / resetSidebarWidth', () => {
  it('grava a largura em localStorage dentro do intervalo', () => {
    useUiStore.getState().setSidebarWidth(420);
    expect(useUiStore.getState().sidebarWidth).toBe(420);
    expect(localStorage.getItem(KEY)).toBe('420');

    useUiStore.getState().setSidebarWidth(9999);
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_MAX_WIDTH);
    expect(localStorage.getItem(KEY)).toBe(String(SIDEBAR_MAX_WIDTH));

    useUiStore.getState().setSidebarWidth(10);
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
  });

  it('o duplo clique na alça volta ao padrão', () => {
    useUiStore.getState().setSidebarWidth(470);
    useUiStore.getState().resetSidebarWidth();
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(localStorage.getItem(KEY)).toBe(String(SIDEBAR_DEFAULT_WIDTH));
  });

  it('o que foi gravado é o que uma sessão nova lê de volta', () => {
    useUiStore.getState().setSidebarWidth(420);
    expect(parseSidebarWidth(localStorage.getItem(KEY))).toBe(420);
  });
});
