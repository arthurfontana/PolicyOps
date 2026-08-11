// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { Step3Library } from '@/components/import/Step3Library';
import { createSampleDocument } from '@/core/document/create';
import type { ImportTable } from '@/core/import/parse-table';
import { useDocumentStore } from '@/store/document-store';
import { useImportStore } from '@/store/import-store';

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useImportStore.getState().reset();
});

describe('Step3Library — lacunas de catálogo', () => {
  it('"criar todos" cria os itens pelo comando normal e a pendência some da lista', async () => {
    const user = userEvent.setup();
    const doc = createSampleDocument();
    useDocumentStore.getState().openDocument(doc);
    useDocumentStore.getState().setActor('Teste');

    const table: ImportTable = {
      header: ['CLUSTER', 'OFERTA'],
      rows: [
        ['G1', 'OFERTA_A'],
        ['G2', 'OFERTA_B'],
      ],
    };
    useImportStore.setState({
      profile: {
        ...useImportStore.getState().profile,
        projectId: doc.projects[0]!.id,
        signature: table.header,
        columns: [
          { column: 'CLUSTER', role: 'PARTITION' },
          { column: 'OFERTA', role: 'VALUE', value: { field: 'offer' } },
        ],
      },
    });

    render(
      <TooltipProvider>
        <Step3Library table={table} />
        <Toaster />
      </TooltipProvider>,
    );

    expect(await screen.findByText('Catálogo · Ofertas')).toBeInTheDocument();
    expect(screen.getAllByText('OFERTA_A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('OFERTA_B').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Criar todos/ }));

    expect(await screen.findByText(/A biblioteca já tem tudo/)).toBeInTheDocument();
    expect(screen.queryByText('Catálogo · Ofertas')).not.toBeInTheDocument();

    const updated = useDocumentStore.getState().document!;
    expect(updated.catalog.some((item) => item.kind === 'OFFER' && item.code === 'OFERTA_A')).toBe(true);
    expect(updated.catalog.some((item) => item.kind === 'OFFER' && item.code === 'OFERTA_B')).toBe(true);
  });
});
