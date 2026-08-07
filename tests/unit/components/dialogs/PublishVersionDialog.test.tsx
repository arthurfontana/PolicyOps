// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { PublishVersionDialog } from '@/components/dialogs/PublishVersionDialog';
import { Toaster } from '@/components/ui/toaster';
import { createSampleDocument } from '@/core/document/create';
import { useDocumentStore } from '@/store/document-store';

/**
 * docs/prompts/S13-ciclo-de-vida.md: "Publicar com notas curtas demais é
 * bloqueado" — critério de aceite explícito de teste componente.
 */
function setup() {
  const doc = createSampleDocument();
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  const matrix = doc.matrices.find((candidate) => candidate.code === 'MTZ_LIMITE_PF')!;
  // v2 é rascunho e já vem com todas as células preenchidas no exemplo — dá
  // para testar só o gate de notas, sem esbarrar em UNSET_CELLS_REMAIN.
  const draft = matrix.versions.find((version) => version.state === 'DRAFT')!;
  const published = matrix.versions.find((version) => version.state === 'PUBLISHED')!;
  return { matrix, draft, published };
}

describe('PublishVersionDialog', () => {
  beforeEach(() => {
    useDocumentStore.getState().closeDocument();
  });

  it('bloqueia publicar com notas curtas demais, e com a confirmação de número ausente', async () => {
    const user = userEvent.setup();
    const { matrix, draft, published } = setup();

    render(
      <>
        <PublishVersionDialog
          open
          onOpenChange={() => {}}
          matrix={matrix}
          version={draft}
          publishedVersion={published}
          onPublished={() => {}}
          onUnsetCellsRemain={() => {}}
        />
        <Toaster />
      </>,
    );

    const confirmButton = screen.getByRole('button', { name: `Publicar versão ${draft.number}` });
    expect(confirmButton).toBeDisabled();

    const notes = screen.getByLabelText('Notas desta publicação');
    await user.type(notes, 'curta demais');
    // "curta demais" tem 12 caracteres — válido; o bloqueio real é testado abaixo.
    await user.clear(notes);
    await user.type(notes, 'curta');
    expect(confirmButton).toBeDisabled();

    await user.clear(notes);
    await user.type(notes, 'Notas com mais de dez caracteres para a publicação.');
    // Notas válidas, mas falta digitar o número da versão para confirmar.
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText(/digite o número da versão/i), String(draft.number));
    expect(confirmButton).toBeEnabled();
  });
});
