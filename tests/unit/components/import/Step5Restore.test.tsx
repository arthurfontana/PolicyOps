// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { Step5Plan } from '@/components/import/Step5Plan';
import { Step6Apply } from '@/components/import/Step6Apply';
import { archiveMatrix } from '@/core/document/commands';
import { planImport } from '@/core/import/plan';
import type { PolicyOpsDocument } from '@/core/document/schema';
import type { ImportTable } from '@/core/import/parse-table';
import { useDocumentStore } from '@/store/document-store';
import { useImportStore } from '@/store/import-store';
import { useUiStore } from '@/store/ui-store';
import { cineminhaDocument, cineminhaProfile, excerptTable, publishPlan } from '../../core/import/fixtures';

/**
 * DEC-CARGA-018 — restaurar matriz arquivada dentro do assistente de carga,
 * ponta a ponta pela interface (passo 5 e passo 6).
 */

const profile = cineminhaProfile();
const table: ImportTable = excerptTable();
const ARCHIVED_CODE = 'MTZ_G1_SEM_RISCO_DIGITAL';

/** 18 matrizes publicadas, idênticas ao arquivo — uma delas arquivada. */
function archivedFixtureDocument(): PolicyOpsDocument {
  const doc = cineminhaDocument();
  const plan = planImport(doc, table, profile);
  const publicado = publishPlan(doc, plan);
  const alvo = publicado.matrices.find((m) => m.code === ARCHIVED_CODE)!;
  const result = archiveMatrix({ matrixId: alvo.id }).run(publicado, {
    actor: 'Teste',
    now: () => new Date('2026-08-12T00:00:00.000Z'),
    newId: () => `id-${Math.random().toString(36).slice(2)}`,
  });
  if (!result.ok) throw new Error('Fixture não deveria falhar ao arquivar.');
  return result.document;
}

function setup() {
  useDocumentStore.getState().openDocument(archivedFixtureDocument());
  useDocumentStore.getState().setActor('Teste');
  useImportStore.setState({ profile, fileName: 'recorte.csv' });
}

function renderStep5() {
  return render(
    <TooltipProvider>
      <Step5Plan table={table} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useImportStore.getState().reset();
  useUiStore.setState({ importRunFilter: null, reviewedVersionIds: [] });
});

describe('Step5Plan — matriz arquivada (DEC-CARGA-018)', () => {
  it('aparece como Arquivada, sem seleção, com o toggle de restaurar', async () => {
    setup();
    renderStep5();

    // "Arquivada" também é uma opção do filtro de estado — o badge da linha é
    // a segunda ocorrência do texto na tela.
    expect(await screen.findAllByText('Arquivada')).toHaveLength(2);
    const restoreToggle = await screen.findByTestId(`plan-restore-${ARCHIVED_CODE}`);
    expect(restoreToggle).not.toBeChecked();
    expect(screen.getByTestId(`plan-select-${ARCHIVED_CODE}`)).toBeDisabled();
    // As outras 17 seguem inalteradas — nenhuma seleção pendente ainda.
    expect(screen.getByTestId('plan-selected-count')).toHaveTextContent('0 de 0 selecionadas');
  });

  it('confirmar restaurar libera a seleção da matriz automaticamente', async () => {
    const user = userEvent.setup();
    setup();
    renderStep5();

    await user.click(await screen.findByTestId(`plan-restore-${ARCHIVED_CODE}`));

    expect(screen.getByTestId(`plan-restore-${ARCHIVED_CODE}`)).toBeChecked();
    expect(screen.getByTestId(`plan-select-${ARCHIVED_CODE}`)).toBeEnabled();
    expect(screen.getByTestId(`plan-select-${ARCHIVED_CODE}`)).toBeChecked();
    expect(screen.getByText('Será restaurada')).toBeInTheDocument();
    expect(screen.getByTestId('plan-selected-count')).toHaveTextContent('1 de 1 selecionadas');
  });
});

describe('Step6Apply — aplicar a restauração', () => {
  function renderStep6() {
    return render(
      <TooltipProvider>
        <Step6Apply table={table} />
        <Toaster />
      </TooltipProvider>,
    );
  }

  it('desarquiva a matriz e o relatório final conta a restauração', async () => {
    const user = userEvent.setup();
    setup();
    useImportStore.getState().toggleRestoreKey(
      planImport(useDocumentStore.getState().document!, table, profile).matrices.find(
        (e) => e.code === ARCHIVED_CODE,
      )!.key,
    );
    useImportStore.getState().setNotes('Restaura a matriz arquivada do G1 Digital');
    renderStep6();

    await user.click(await screen.findByTestId('apply-import'));

    expect(await screen.findByTestId('import-report')).toBeInTheDocument();
    expect(screen.getByText(/1 matrizes restauradas do arquivo/)).toBeInTheDocument();

    const restaurada = useDocumentStore
      .getState()
      .document!.matrices.find((m) => m.code === ARCHIVED_CODE)!;
    expect(restaurada.archivedAt).toBeUndefined();
  });
});
