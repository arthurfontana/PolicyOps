// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { EvidenceSection } from '@/components/inspector/EvidenceSection';
import { Toaster } from '@/components/ui/toaster';
import { createSampleDocument } from '@/core/document/create';
import { attachEvidence } from '@/core/document/evidence';
import type { AttachmentTarget } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';
import { usePersistenceStore } from '@/store/persistence-store';

/**
 * Seção "Evidências" do inspector — docs/07-ux-e-editor.md §6.3,
 * docs/14-plataforma-local.md §7 e §8.
 *
 * Dois comportamentos que a interface promete e que não dependem do servidor:
 * fora do modo `SERVER` a seção aparece **desabilitada com o motivo**, e o
 * desanexo só tira o vínculo (o arquivo é assunto do salvamento).
 */

function target(): AttachmentTarget {
  return { kind: 'PROJECT', projectId: useDocumentStore.getState().document!.projects[0]!.id };
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useDocumentStore.getState().openDocument(createSampleDocument());
  useDocumentStore.getState().setActor('Arthur');
  useDocumentStore.getState().setIdentity({ username: 'arthur', source: 'windows' });
  usePersistenceStore.setState({ mode: 'DOWNLOAD_ONLY', serverConnection: null });
});

function renderSection() {
  return render(
    <>
      <EvidenceSection target={target()} />
      <Toaster />
    </>,
  );
}

function anexar(fileName = '2026-08-14_DB 513.docx'): void {
  const result = useDocumentStore.getState().dispatch(
    attachEvidence({
      fileName,
      relPath: `politica-pf/${fileName}`,
      sha256: 'a'.repeat(64),
      bytes: 2048,
      addedBy: { username: 'arthur', displayName: 'Arthur' },
      target: target(),
    }),
  );
  expect(result.ok).toBe(true);
}

describe('EvidenceSection — fora do modo SERVER', () => {
  it('aparece desabilitada, com o motivo visível e sem botão de anexar', () => {
    renderSection();

    expect(screen.getByTestId('evidence-unavailable')).toHaveTextContent(/servidor local/);
    expect(screen.queryByRole('button', { name: 'Anexar arquivo' })).not.toBeInTheDocument();
  });

  it('lista o que já está anexado, mas não deixa abrir nem desanexar', () => {
    anexar();
    renderSection();

    expect(screen.getByText('2026-08-14_DB 513.docx')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Abrir/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Desanexar/ })).toBeDisabled();
  });
});

describe('EvidenceSection — modo SERVER', () => {
  beforeEach(() => {
    usePersistenceStore.setState({
      mode: 'SERVER',
      serverConnection: { dataDir: '\\\\rede\\Politicas', username: 'arthur', displayName: 'Arthur' },
    });
  });

  it('mostra quem anexou, quando, o tamanho e o caminho no Explorer', () => {
    anexar();
    renderSection();

    const item = screen.getByTestId('evidence-item');
    expect(item).toHaveTextContent('Arthur');
    expect(item).toHaveTextContent('2 KB');
    expect(item).toHaveTextContent('\\\\rede\\Politicas\\_evidencias\\politica-pf\\2026-08-14_DB 513.docx');
  });

  it('desanexar pede confirmação citando a lixeira e só então tira o vínculo', async () => {
    const user = userEvent.setup();
    anexar();
    renderSection();

    await user.click(screen.getByRole('button', { name: /^Desanexar/ }));
    expect(screen.getByText(/_lixeira/)).toBeInTheDocument();
    expect(screen.getByText(/Ctrl\+Z/)).toBeInTheDocument();
    // Enquanto não confirma, nada muda.
    expect(useDocumentStore.getState().document!.attachments).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Desanexar', exact: true }));
    expect(useDocumentStore.getState().document!.attachments).toBeUndefined();
    // …e o desfazer devolve o vínculo, sem nenhum arquivo ter se mexido.
    act(() => {
      useDocumentStore.getState().undo();
    });
    expect(useDocumentStore.getState().document!.attachments).toHaveLength(1);
  });

  it('sem anexos, diz que não há nada e oferece o botão de anexar', () => {
    renderSection();

    expect(screen.getByText(/Nenhuma evidência deste projeto ainda/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Anexar arquivo/ })).toBeEnabled();
    expect(screen.getByText(/não lê\s+nem indexa o conteúdo/)).toBeInTheDocument();
  });
});
