// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { RichDocEditor } from '@/components/richdoc/RichDocEditor';
import { Toaster } from '@/components/ui/toaster';
import type { Command } from '@/core/command';
import { createComponent } from '@/core/document/components';
import { createSampleDocument } from '@/core/document/create';
import type { RichDoc } from '@/core/document/schema';
import { blockPlainText } from '@/core/richdoc/model';
import { createComponentDraft } from '@/core/versioning/component-lifecycle';
import { useDocumentStore } from '@/store/document-store';

/**
 * O editor de blocos em uso — docs/07 §18.
 *
 * O que estes testes cobrem é o caminho que o teste de núcleo não alcança: a
 * tecla vira comando, o comando vira documento, e o desfazer volta o **texto
 * inteiro** digitado no bloco (coalescência, docs/08 §2). A digitação é
 * simulada pelo evento `input` do `contentEditable` — no jsdom não há motor de
 * edição de verdade, e é exatamente esse evento que o browser dispara.
 */

function dispatch<O>(command: Command<unknown, O>): O {
  const result = useDocumentStore.getState().dispatch(command);
  if (!result.ok) throw new Error(`Comando falhou: ${result.error.code} — ${result.error.message}`);
  return result.data;
}

function setupDraft(): string {
  const doc = createSampleDocument();
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  const projectId = doc.projects[0]!.id;
  const { componentId } = dispatch(
    createComponent({ projectId, code: 'REGRA_TESTE', name: 'Regra de teste', type: 'RULE' }),
  );
  const { versionId } = dispatch(
    createComponentDraft({ componentId, payload: { kind: 'RULE', businessDescription: 'x' } }),
  );
  return versionId;
}

function Harness({ versionId }: { versionId: string }) {
  const document = useDocumentStore((s) => s.document);
  const version = document?.components
    .flatMap((component) => component.versions)
    .find((candidate) => candidate.id === versionId);
  return (
    <>
      <RichDocEditor
        target={{ kind: 'COMPONENT_VERSION_SPEC', versionId }}
        value={version?.spec}
        editable
      />
      <Toaster />
    </>
  );
}

function spec(versionId: string): RichDoc {
  const document = useDocumentStore.getState().document!;
  return (
    document.components
      .flatMap((component) => component.versions)
      .find((candidate) => candidate.id === versionId)?.spec ?? { blocks: [] }
  );
}

function texts(versionId: string): string[] {
  return spec(versionId).blocks.map(blockPlainText);
}

/** Digita no `contentEditable`: o browser altera o DOM e dispara `input`. */
function type(line: HTMLElement, text: string): void {
  for (const letter of text) {
    line.textContent = `${line.textContent ?? ''}${letter}`;
    fireEvent.input(line);
  }
}

function caretAt(line: HTMLElement, offset: number): void {
  const selection = window.getSelection()!;
  const range = document.createRange();
  const node = line.firstChild ?? line;
  range.setStart(node, node.nodeType === Node.TEXT_NODE ? offset : 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

async function startWriting(): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Começar a escrever' }));
  return screen.getByRole('textbox', { name: /Parágrafo da especificação/ });
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
});

describe('RichDocEditor — digitação', () => {
  it('cada tecla vira comando e o texto entra no documento', async () => {
    const versionId = setupDraft();
    render(<Harness versionId={versionId} />);

    const line = await startWriting();
    type(line, 'Cliente reprovado');

    expect(texts(versionId)).toEqual(['Cliente reprovado']);
  });

  it('um Ctrl+Z desfaz o parágrafo inteiro, e refazer devolve tudo', async () => {
    const versionId = setupDraft();
    render(<Harness versionId={versionId} />);

    const line = await startWriting();
    type(line, 'Um parágrafo bem comprido, digitado letra a letra.');
    expect(texts(versionId)).toEqual(['Um parágrafo bem comprido, digitado letra a letra.']);

    fireEvent.keyDown(line, { key: 'z', ctrlKey: true });
    expect(texts(versionId)).toEqual(['']);

    fireEvent.keyDown(line, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(texts(versionId)).toEqual(['Um parágrafo bem comprido, digitado letra a letra.']);
  });

  it('a digitação não empilha um undo por tecla', async () => {
    const versionId = setupDraft();
    render(<Harness versionId={versionId} />);
    const line = await startWriting();
    const antes = useDocumentStore.getState().undoStack.length;
    type(line, 'abcdefghij');
    expect(useDocumentStore.getState().undoStack.length - antes).toBe(1);
  });
});

describe('RichDocEditor — Enter e Backspace', () => {
  it('Enter divide o bloco no cursor', async () => {
    const versionId = setupDraft();
    render(<Harness versionId={versionId} />);

    const line = await startWriting();
    type(line, 'Antes e depois');
    caretAt(line, 5);
    fireEvent.keyDown(line, { key: 'Enter' });

    expect(texts(versionId)).toEqual(['Antes', ' e depois']);
  });

  it('Backspace no início do segundo bloco funde os dois', async () => {
    const versionId = setupDraft();
    render(<Harness versionId={versionId} />);

    const line = await startWriting();
    type(line, 'Antes e depois');
    caretAt(line, 5);
    fireEvent.keyDown(line, { key: 'Enter' });
    expect(texts(versionId)).toHaveLength(2);

    const segunda = screen.getAllByRole('textbox', { name: /Parágrafo da especificação/ })[1]!;
    caretAt(segunda, 0);
    fireEvent.keyDown(segunda, { key: 'Backspace' });

    expect(texts(versionId)).toEqual(['Antes e depois']);
  });

  it('Backspace no primeiro bloco não apaga nada', async () => {
    const versionId = setupDraft();
    render(<Harness versionId={versionId} />);
    const line = await startWriting();
    type(line, 'Só um bloco');
    caretAt(line, 0);
    fireEvent.keyDown(line, { key: 'Backspace' });
    expect(texts(versionId)).toEqual(['Só um bloco']);
  });
});

describe('RichDocEditor — blocos', () => {
  it('"/" numa linha vazia abre o menu de inserção', async () => {
    const versionId = setupDraft();
    render(<Harness versionId={versionId} />);
    const line = await startWriting();

    fireEvent.keyDown(line, { key: '/' });
    expect(await screen.findByRole('menuitem', { name: 'Lista com marcadores' })).toBeInTheDocument();
  });

  it('o menu transforma a linha vazia no tipo escolhido', async () => {
    const user = userEvent.setup();
    const versionId = setupDraft();
    render(<Harness versionId={versionId} />);
    const line = await startWriting();

    fireEvent.keyDown(line, { key: '/' });
    await user.click(await screen.findByRole('menuitem', { name: 'Título 1' }));

    expect(spec(versionId).blocks[0]!.type).toBe('heading1');
  });

  it('inserir tabela cria um bloco table editável célula a célula', async () => {
    const user = userEvent.setup();
    const versionId = setupDraft();
    render(<Harness versionId={versionId} />);
    const line = await startWriting();

    fireEvent.keyDown(line, { key: '/' });
    await user.click(await screen.findByRole('menuitem', { name: 'Tabela' }));
    expect(spec(versionId).blocks[0]!.type).toBe('table');

    const header = screen.getByRole('textbox', { name: 'Cabeçalho da coluna 1' });
    await user.type(header, 'Faixa');
    const table = spec(versionId).blocks[0] as { header: string[] };
    expect(table.header[0]).toBe('Faixa');
  });

  it('remover o bloco tira o bloco da especificação', async () => {
    const user = userEvent.setup();
    const versionId = setupDraft();
    render(<Harness versionId={versionId} />);
    const line = await startWriting();
    type(line, 'Some daqui');

    await user.click(screen.getByRole('button', { name: 'Remover bloco 1' }));
    expect(spec(versionId).blocks).toHaveLength(0);
  });
});

describe('RichDocEditor — colar', () => {
  it('colar HTML do Excel vira um bloco table', async () => {
    const versionId = setupDraft();
    render(<Harness versionId={versionId} />);
    const line = await startWriting();

    fireEvent.paste(line, {
      clipboardData: {
        getData: (format: string) =>
          format === 'text/html'
            ? '<table><tr><td>Faixa</td><td>Limite</td></tr><tr><td>A</td><td>1000</td></tr></table>'
            : 'Faixa\tLimite\nA\t1000',
      },
    });

    const blocks = spec(versionId).blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'table', header: ['Faixa', 'Limite'], rows: [['A', '1000']] });
  });

  it('colar um parágrafo dentro da linha entra no cursor, sem criar bloco novo', async () => {
    const versionId = setupDraft();
    render(<Harness versionId={versionId} />);
    const line = await startWriting();
    type(line, 'Reprova  o cliente');
    caretAt(line, 8);

    fireEvent.paste(line, {
      clipboardData: { getData: (format: string) => (format === 'text/html' ? '' : 'sempre') },
    });

    expect(texts(versionId)).toEqual(['Reprova sempre o cliente']);
  });
});

describe('RichDocEditor — leitura', () => {
  it('versão publicada não tem editor, só o conteúdo', () => {
    const versionId = setupDraft();
    const richDoc: RichDoc = {
      blocks: [
        { id: 'p1__________', type: 'paragraph', text: [{ text: 'Texto publicado' }] },
        { id: 'l1__________', type: 'bulletList', items: [[{ text: 'Serasa' }]] },
      ],
    };
    render(
      <RichDocEditor
        target={{ kind: 'COMPONENT_VERSION_SPEC', versionId }}
        value={richDoc}
        editable={false}
      />,
    );

    expect(screen.getByText('Texto publicado')).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getByText('Serasa')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
