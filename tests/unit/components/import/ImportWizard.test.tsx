// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ImportWizard } from '@/components/import/ImportWizard';
import { archiveMatrix } from '@/core/document/commands';
import { planImport } from '@/core/import/plan';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';
import { useImportStore } from '@/store/import-store';
import { useUiStore } from '@/store/ui-store';
import { cineminhaDocument, cineminhaProfile, excerptCsv, excerptTable, publishPlan } from '../../core/import/fixtures';
import { parseDelimitedTable } from '@/core/import/parse-table';

/**
 * DEC-CARGA-018 pela casca do assistente: o passo 5 (`Step5Plan`) já libera a
 * matriz arquivada e restaurada para seleção, mas o botão "Avançar" do rodapé
 * do assistente (`ImportWizard`) usava um `planImport` próprio, sem
 * `restoreKeys` — o plano que decide se dá para avançar via `hasApplicable`
 * nunca via a confirmação de restauração e a matriz continuava `ARCHIVED`,
 * travando o passo 5 mesmo com o diff certo e a matriz marcada.
 */

const profile = cineminhaProfile();
const table = excerptTable();
const ARCHIVED_CODE = 'MTZ_G1_SEM_RISCO_DIGITAL';

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
  const parsed = parseDelimitedTable(excerptCsv());
  useImportStore.setState({ profile, fileName: 'recorte.csv', parsed, step: 5 });
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useImportStore.getState().reset();
  useUiStore.setState({ importRunFilter: null, reviewedVersionIds: [] });
});

describe('ImportWizard — passo 5 com matriz arquivada (DEC-CARGA-018)', () => {
  it('"Avançar" fica travado até a restauração ser confirmada, e libera assim que for', async () => {
    const user = userEvent.setup();
    setup();
    render(
      <TooltipProvider>
        <ImportWizard />
      </TooltipProvider>,
    );

    const avancar = await screen.findByRole('button', { name: 'Avançar' });
    expect(avancar).toBeDisabled();

    await user.click(await screen.findByTestId(`plan-restore-${ARCHIVED_CODE}`));

    expect(avancar).toBeEnabled();
  });
});
