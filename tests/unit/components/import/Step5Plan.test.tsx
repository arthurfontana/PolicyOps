// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Step5Plan } from '@/components/import/Step5Plan';
import { createSampleDocument } from '@/core/document/create';
import type { ImportTable } from '@/core/import/parse-table';
import { useDocumentStore } from '@/store/document-store';
import { useImportStore } from '@/store/import-store';

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useImportStore.getState().reset();
});

/**
 * CT-07 — docs/12-carga-de-matrizes.md §3: valor de eixo não mapeado bloqueia
 * o plano (RN-16), com a coluna, o valor e a linha na mensagem.
 */
describe('Step5Plan — CT-07: valor de eixo não mapeado bloqueia o plano', () => {
  it('mostra IMPORT_UNMAPPED_VALUE e nenhuma matriz', async () => {
    const doc = createSampleDocument();
    const scoreVariable = doc.variables.find((v) => v.code === 'SCORE_HVI3')!;
    const restritivoVariable = doc.variables.find((v) => v.code === 'RESTRITIVO')!;
    useDocumentStore.getState().openDocument(doc);
    useDocumentStore.getState().setActor('Teste');

    const table: ImportTable = {
      header: ['CLUSTER', 'MOD_PRC', 'MOD_RESTRITIVO', 'OFERTA'],
      rows: [['G1', 'R30', 'SEM', 'OFERTA_0']],
    };

    useImportStore.setState({
      profile: {
        ...useImportStore.getState().profile,
        projectId: doc.projects[0]!.id,
        signature: table.header,
        columns: [
          { column: 'CLUSTER', role: 'PARTITION' },
          { column: 'MOD_PRC', role: 'AXIS', axis: { role: 'X', level: 0, variableId: scoreVariable.id } },
          {
            column: 'MOD_RESTRITIVO',
            role: 'AXIS',
            axis: { role: 'Y', level: 0, variableId: restritivoVariable.id },
          },
          { column: 'OFERTA', role: 'VALUE', value: { field: 'offer' } },
        ],
        codeTemplate: 'MTZ_{CLUSTER}',
        nameTemplate: '{CLUSTER}',
        decisionRules: [{ otherwise: 'APROVADO' }],
      },
    });

    render(
      <TooltipProvider>
        <Step5Plan table={table} />
      </TooltipProvider>,
    );

    expect(await screen.findByText(/plano está bloqueado/)).toBeInTheDocument();
    const message = await screen.findByText(/sem correspondência na biblioteca/);
    expect(message.textContent).toContain('MOD_PRC');
    expect(message.textContent).toContain('R30');
    expect(message.textContent).toMatch(/linha \d/);
    expect(screen.queryByText('novas')).not.toBeInTheDocument();
  });
});
