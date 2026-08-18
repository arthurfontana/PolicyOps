/**
 * Abre uma janela dedicada com um HTML autocontido e dispara `window.print()`
 * assim que ele terminar de carregar — o mesmo hábito de "imprimir em PDF" já
 * usado pela impressão de matriz (`src/index.css`), aqui para o HTML do
 * Pacote para a Fábrica (docs/14 §8). Sem requisição de rede: o documento é
 * escrito direto no `document` da nova janela (docs/02 §2).
 */
export function openPrintWindow(html: string): void {
  const win = window.open('', '_blank');
  if (win === null) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.addEventListener('load', () => win.print());
}
