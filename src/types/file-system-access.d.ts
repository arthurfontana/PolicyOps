/**
 * Declarações mínimas da File System Access API que a `lib.dom` do
 * TypeScript ainda não traz (os seletores globais, a API de permissão dos
 * handles e o iterador assíncrono de diretório).
 *
 * Preferimos declarar o pouco que usamos a adicionar `@types/wicg-file-system-access`
 * — docs/02-arquitetura.md §2 fecha a lista de dependências, e nada aqui vai
 * para o bundle.
 *
 * Declarar o tipo **não** significa presumir que a API existe: a detecção de
 * verdade está em `src/storage/capabilities.ts` (§1).
 */

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission?(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<'granted' | 'denied' | 'prompt'>;
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  values(): AsyncIterableIterator<FileSystemHandle>;
}

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
  id?: string;
  startIn?: string | FileSystemHandle;
}

interface SaveFilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  suggestedName?: string;
  id?: string;
  startIn?: string | FileSystemHandle;
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: string | FileSystemHandle;
}

interface Window {
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
  showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
