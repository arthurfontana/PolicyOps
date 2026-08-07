// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MergeDialog } from '@/components/dialogs/MergeDialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createSampleDocument } from '@/core/document/create';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { updateCatalogItem } from '@/core/library/catalog';
import { useDocumentStore } from '@/store/document-store';
import { usePersistenceStore } from '@/store/persistence-store';

/**
 * A tela de merge — docs/06-persistencia-e-concorrencia.md §7.
 *
 * O que precisa valer no navegador: a lista do que entra sozinho está à
 * vista, o conflito pede decisão, a escolha **campo a campo** funciona, e
 * nada é aplicado antes de confirmar.
 */

function remoteWithOtherLabel(doc: PolicyOpsDocument): PolicyOpsDocument {
  const target = doc.catalog.find((item) => item.code === 'APROVADO')!;
  return {
    ...doc,
    meta: { ...doc.meta, revision: doc.meta.revision + 3, savedBy: 'Beatriz' },
    catalog: doc.catalog.map((item) =>
      item.id === target.id ? { ...item, label: 'Aprovado pelo Bruno', color: '#222222' } : item,
    ),
    // Um evento exclusivo do lado remoto tocando o mesmo item: sem ele, o
    // merge resolveria sozinho (o lado alterado vence) e não haveria conflito.
    events: [
      ...doc.events,
      {
        id: 'evtBeatriz01',
        at: '2026-08-05T12:00:00.000Z',
        actor: 'Beatriz',
        type: 'CATALOG_CHANGED' as const,
        scope: {},
        summary: 'Beatriz editou decisão "APROVADO".',
        payload: { kind: 'DECISION', code: 'APROVADO' },
      },
    ],
  };
}

function setup(): { mine: PolicyOpsDocument; targetId: string } {
  const mine = createSampleDocument();
  const targetId = mine.catalog.find((item) => item.code === 'APROVADO')!.id;

  useDocumentStore.setState({ actor: 'Ana' });
  useDocumentStore.getState().openDocument(mine);
  useDocumentStore
    .getState()
    .dispatch(updateCatalogItem({ id: targetId, label: 'Aprovado pela Ana', color: '#111111' }));

  usePersistenceStore.setState({
    merge: {
      headline: 'Beatriz salvou este arquivo depois de você abri-lo.',
      theirs: remoteWithOtherLabel(mine),
      fileName: 'politicas.json',
    },
  });
  return { mine, targetId };
}

function renderDialog() {
  return render(
    <TooltipProvider>
      <MergeDialog />
    </TooltipProvider>,
  );
}

describe('MergeDialog', () => {
  beforeEach(() => {
    usePersistenceStore.setState({ merge: null, conflict: null });
    useDocumentStore.getState().closeDocument();
  });

  it('lista o que entra sozinho e pede decisão só no que diverge', () => {
    setup();
    renderDialog();

    expect(screen.getByText(/Mesclar com politicas\.json/)).toBeInTheDocument();
    expect(screen.getByTestId('merge-conflict-count')).toHaveTextContent('1 decisão(ões)');
    const conflict = screen.getByTestId('merge-conflict');
    expect(conflict).toHaveTextContent('O item de catálogo "APROVADO — Aprovado pela Ana"');
    // Os dois lados aparecem, e a consequência de cada opção está escrita.
    expect(conflict).toHaveTextContent('Aprovado pela Ana');
    expect(conflict).toHaveTextContent('Aprovado pelo Bruno');
    expect(conflict).toHaveTextContent('O conteúdo do arquivo é descartado neste ponto.');
  });

  it('resolve campo a campo: rótulo do arquivo, cor minha', async () => {
    const { targetId } = setup();
    const user = userEvent.setup();
    renderDialog();

    const rows = within(screen.getByTestId('merge-conflict')).getAllByRole('row');
    const labelRow = rows.find((row) => row.textContent?.includes('Aprovado pelo Bruno'))!;
    await user.click(within(labelRow).getAllByRole('radio')[1]!);

    await user.click(screen.getByTestId('merge-confirm'));

    const merged = useDocumentStore.getState().document!;
    const item = merged.catalog.find((candidate) => candidate.id === targetId)!;
    expect(item.label).toBe('Aprovado pelo Bruno');
    expect(item.color).toBe('#111111');
    expect(merged.events.some((event) => event.type === 'DOCUMENT_MERGED')).toBe(true);
  });

  it('cancelar não muda o documento', async () => {
    const { targetId } = setup();
    const before = useDocumentStore.getState().document!;
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(usePersistenceStore.getState().merge).toBeNull();
    expect(useDocumentStore.getState().document).toBe(before);
    expect(
      useDocumentStore.getState().document!.catalog.find((item) => item.id === targetId)!.label,
    ).toBe('Aprovado pela Ana');
  });
});
