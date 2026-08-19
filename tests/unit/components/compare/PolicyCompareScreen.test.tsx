// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { PolicyCompareScreen } from '@/components/compare/PolicyCompareScreen';
import { Toaster } from '@/components/ui/toaster';
import { setChangeRequestRelease } from '@/core/document/change-requests';
import { publishChangeRequest } from '@/core/document/cr-publish';
import { createRelease } from '@/core/document/releases';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';
import {
  dbPublicavel,
  politica,
  politicaComTresMudancas,
} from '../../core/document/governance-fixtures';
import { IDS, apply, testCtx } from '../../core/versioning/fixtures';

/**
 * Tela de comparação da política (docs/07-ux-e-editor.md §20). O cenário é o
 * do épico (`governance-fixtures.ts`, três mudanças em datas conhecidas): a
 * tela não tem regra nenhuma, então o que se verifica aqui é que ela lê o
 * resultado do núcleo e desenha os dois modos.
 */

function open(document: PolicyOpsDocument): void {
  useDocumentStore.getState().openDocument(document);
  useDocumentStore.getState().setActor('Teste');
  useEditorStore.getState().setSelectedProject(IDS.projectA);
}

async function setDates(user: ReturnType<typeof userEvent.setup>, a: string, b: string): Promise<void> {
  const base = screen.getByLabelText('Data base');
  const compared = screen.getByLabelText('Data comparada');
  await user.clear(base);
  await user.type(base, a);
  await user.clear(compared);
  await user.type(compared, b);
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useEditorStore.getState().reset();
  useUiStore.setState({ policyAtDate: null, view: 'policy-compare' });
});

describe('PolicyCompareScreen — data × data', () => {
  it('lista as três mudanças do intervalo, agrupadas e com o resumo do período', async () => {
    const user = userEvent.setup();
    open(politicaComTresMudancas(testCtx()).document);
    render(
      <>
        <PolicyCompareScreen />
        <Toaster />
      </>,
    );

    await setDates(user, '2026-02-15', '2026-09-01');

    expect(screen.getByTestId('policy-change-REGRA_GOODLIST')).toBeTruthy();
    expect(screen.getByTestId('policy-change-REGRA_NOVA')).toBeTruthy();
    expect(screen.getByTestId('policy-change-ESPELHO_CORTE')).toBeTruthy();
    expect(screen.getByText('1 adicionados')).toBeTruthy();
    expect(screen.getByText('2 alterados')).toBeTruthy();
    expect(screen.getByText('0 removidos')).toBeTruthy();

    // Payload campo a campo na regra alterada.
    const goodlist = screen.getByTestId('policy-change-REGRA_GOODLIST');
    expect(goodlist.textContent).toContain('businessDescription');
    expect(goodlist.textContent).toContain('v1 → v2');

    // Matriz: o resumo semântico do diff existente, não as células.
    expect(screen.getByTestId('policy-change-ESPELHO_CORTE').textContent).toContain('célula');
  });

  it('intervalo sem publicação nenhuma diz que nada mudou', async () => {
    const user = userEvent.setup();
    open(politicaComTresMudancas(testCtx()).document);
    render(<PolicyCompareScreen />);

    await setDates(user, '2026-03-10', '2026-05-31');

    expect(screen.getByText('Nada mudou na política entre as duas pontas.')).toBeTruthy();
  });

  it('a ordem das duas datas não importa — a base é sempre a mais antiga', async () => {
    const user = userEvent.setup();
    open(politicaComTresMudancas(testCtx()).document);
    render(<PolicyCompareScreen />);

    await setDates(user, '2026-09-01', '2026-02-15');

    expect(screen.getByText(/15\/02\/2026.*01\/09\/2026/)).toBeTruthy();
    expect(screen.getByTestId('policy-change-REGRA_NOVA').textContent).toContain('adicionado');
  });

  it('aberta pela tela de Vigência, já chega com a data daquela consulta de um lado (§10)', () => {
    useUiStore.setState({ policyAtDate: '2026-05-15' });
    open(politicaComTresMudancas(testCtx()).document);
    render(<PolicyCompareScreen />);

    expect(screen.getByLabelText('Data comparada')).toHaveValue('2026-05-15');
  });

  it('"Ver a política em…" abre a tela de Vigência naquela data (§20.3)', async () => {
    const user = userEvent.setup();
    open(politicaComTresMudancas(testCtx()).document);
    render(<PolicyCompareScreen />);

    await setDates(user, '2026-02-15', '2026-09-01');
    await user.click(screen.getByRole('button', { name: /Ver a política em/ }));

    expect(useUiStore.getState().policyAtDate).toBe('2026-02-15');
    expect(useUiStore.getState().view).toBe('timeline');
  });
});

describe('PolicyCompareScreen — release × release', () => {
  function documentoComRelease(): PolicyOpsDocument {
    const ctx = testCtx();
    const base = politica(ctx);
    const db = dbPublicavel(base.document, ctx, base.goodlistId);
    const release = apply(db.document, ctx, createRelease({ code: '2026.09.01' }));
    const vinculado = apply(
      release.document,
      ctx,
      setChangeRequestRelease({ changeRequestId: db.changeRequestId, releaseId: release.data.releaseId }),
    );
    return apply(vinculado.document, ctx, publishChangeRequest({ changeRequestId: db.changeRequestId })).document;
  }

  it('a mesma release dos dois lados mostra o que ela mudou', async () => {
    const user = userEvent.setup();
    open(documentoComRelease());
    render(<PolicyCompareScreen />);

    await user.click(screen.getByRole('tab', { name: 'Release × release' }));

    expect(screen.getByText(/antes da release 2026\.09\.01/)).toBeTruthy();
    expect(screen.getByText(/depois da release 2026\.09\.01/)).toBeTruthy();
    expect(screen.getByTestId('policy-change-REGRA_GOODLIST').textContent).toContain('v1 → v2');
  });

  it('sem release publicada, o modo explica o que falta em vez de mostrar vazio', async () => {
    const user = userEvent.setup();
    open(politicaComTresMudancas(testCtx()).document);
    render(<PolicyCompareScreen />);

    await user.click(screen.getByRole('tab', { name: 'Release × release' }));

    expect(screen.getByText(/Nenhuma release publicada ainda/)).toBeTruthy();
  });
});
