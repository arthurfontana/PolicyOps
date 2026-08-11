// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Step1File } from '@/components/import/Step1File';
import { ImportWizard } from '@/components/import/ImportWizard';
import { createSampleDocument } from '@/core/document/create';
import type { PolicyOpsDocument } from '@/core/document/schema';
import type { ImportProfile } from '@/core/import/profile';
import { useDocumentStore } from '@/store/document-store';
import { useImportStore } from '@/store/import-store';

/** "2 linhas · 2 colunas" fica em nós de texto separados (JSX intercala literal e variável). */
function statsText(): string {
  const node = screen.getByText((_, element) => element?.tagName === 'P' && /colunas/.test(element.textContent ?? ''));
  return node.textContent ?? '';
}

function renderStep1() {
  useDocumentStore.getState().openDocument(createSampleDocument());
  useDocumentStore.getState().setActor('Teste');
  return render(
    <TooltipProvider>
      <Step1File />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useImportStore.getState().reset();
});

describe('Step1File — colar e corrigir formato', () => {
  it('reconhece uma tabela separada por vírgula', async () => {
    const user = userEvent.setup();
    renderStep1();
    await user.click(screen.getByLabelText('Ou cole o texto aqui'));
    await user.paste('A,B\n1,2\n3,4');
    expect(await screen.findByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(statsText()).toContain('2 linhas · 2 colunas');
  });

  it('reconhece uma tabela separada por ponto e vírgula', async () => {
    const user = userEvent.setup();
    renderStep1();
    await user.click(screen.getByLabelText('Ou cole o texto aqui'));
    await user.paste('A;B\n1;2\n3;4');
    expect(await screen.findByText('A')).toBeInTheDocument();
    expect(statsText()).toContain('2 linhas · 2 colunas');
  });

  it('corrigir o separador à mão reprocessa a tabela', async () => {
    const user = userEvent.setup();
    renderStep1();
    await user.click(screen.getByLabelText('Ou cole o texto aqui'));
    // Detecção automática escolhe "," (única presente no cabeçalho): 3 colunas.
    await user.paste('A,B,C\n1,2,3');
    expect(await screen.findByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();

    // Corrige à mão para "|", que não aparece no texto: volta a virar uma
    // coluna só — prova que a escolha manual tem precedência sobre a detecção.
    await user.click(screen.getByLabelText('Separador'));
    await user.click(await screen.findByRole('option', { name: 'Barra vertical (|)' }));

    expect(await screen.findByText('A,B,C')).toBeInTheDocument();
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });

  it('arquivo sem cabeçalho reconhecível mostra erro', async () => {
    const user = userEvent.setup();
    renderStep1();
    await user.click(screen.getByLabelText('Ou cole o texto aqui'));
    await user.paste('   \n');
    expect(await screen.findByText(/problema.*no arquivo/i)).toBeInTheDocument();
  });
});

describe('Step1File — CT-12: perfil reconhecido pelo cabeçalho', () => {
  function baseProfile(signature: string[]): ImportProfile {
    return {
      id: 'PRF_TESTE___',
      code: 'CARGA_TESTE',
      name: 'Carga de teste',
      createdAt: '2026-01-01T00:00:00.000Z',
      format: { delimiter: ',', headerRow: 1, hasBom: false, trimValues: true },
      signature,
      projectId: 'algum-projeto',
      columns: signature.map((column) => ({ column, role: 'IGNORE' as const })),
      codeTemplate: 'MTZ_{A}',
      nameTemplate: '{A}',
      decisionRules: [{ otherwise: 'APROVADO' }],
      tagRules: [],
      missingRowPolicy: 'KEEP',
      suppressUnobserved: true,
    };
  }

  it('mostra o atalho quando o cabeçalho é idêntico ao perfil salvo', async () => {
    const user = userEvent.setup();
    const doc: PolicyOpsDocument & { importProfiles?: ImportProfile[] } = {
      ...createSampleDocument(),
      importProfiles: [baseProfile(['A', 'B'])],
    };
    useDocumentStore.getState().openDocument(doc);
    useDocumentStore.getState().setActor('Teste');
    render(
      <TooltipProvider>
        <Step1File />
      </TooltipProvider>,
    );

    await user.click(screen.getByLabelText('Ou cole o texto aqui'));
    await user.paste('A,B\n1,2');

    expect(await screen.findByText('CARGA_TESTE')).toBeInTheDocument();
    expect(screen.getByText(/reconhecido pelo cabeçalho/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir direto ao plano' })).toBeInTheDocument();
  });

  it('cabeçalho com uma coluna a mais não é reconhecido', async () => {
    const user = userEvent.setup();
    const doc: PolicyOpsDocument & { importProfiles?: ImportProfile[] } = {
      ...createSampleDocument(),
      importProfiles: [baseProfile(['A', 'B'])],
    };
    useDocumentStore.getState().openDocument(doc);
    useDocumentStore.getState().setActor('Teste');
    render(
      <TooltipProvider>
        <Step1File />
      </TooltipProvider>,
    );

    await user.click(screen.getByLabelText('Ou cole o texto aqui'));
    await user.paste('A,B,C\n1,2,3');

    expect(screen.queryByText(/reconhecido pelo cabeçalho/)).not.toBeInTheDocument();
  });
});

describe('ImportWizard — passo 1 bloqueia avanço com erro de parse', () => {
  it('não avança com arquivo sem linha de dados', async () => {
    const user = userEvent.setup();
    useDocumentStore.getState().openDocument(createSampleDocument());
    useDocumentStore.getState().setActor('Teste');
    render(
      <TooltipProvider>
        <ImportWizard />
      </TooltipProvider>,
    );

    await user.click(screen.getByLabelText('Ou cole o texto aqui'));
    await user.paste('A,B\n');

    expect(await screen.findByText(/problema.*no arquivo/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Avançar' })).toBeDisabled();
  });
});
