/**
 * Leitura de arquivo para o passo 1 do assistente de carga — docs/12-carga-de-matrizes.md §5.1.
 *
 * Fica fora de `src/core/`: decodificação de `File` usa a API do navegador
 * (`Blob.text()`), que `core` não pode tocar (docs/02-arquitetura.md §2). O
 * motor (`parseDelimitedTable`) só recebe texto já decodificado.
 */
export async function readImportFile(file: File): Promise<{ text: string; fileName: string }> {
  const text = await file.text();
  return { text, fileName: file.name };
}
