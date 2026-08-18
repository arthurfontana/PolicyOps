import {
  buildFactoryPackage,
  factoryPackageMarkdownFileName,
  renderFactoryPackageHtml,
  renderFactoryPackageMarkdown,
} from '@/core/export';
import { isDomainError } from '@/core/errors';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { downloadTextFile } from '@/lib/download';
import { openPrintWindow } from '@/lib/print-window';

/**
 * Ações de UI do Pacote para a Fábrica (docs/14 §8, S38) — puro wiring: monta
 * o pacote com `buildFactoryPackage` e entrega no formato pedido. Nenhum
 * comando aqui: o pacote é sempre derivado, nunca uma cópia gravada no
 * documento (RN-GOV-08).
 */
export type FactoryPackageActionResult = { ok: true } | { ok: false; message: string };

function toResult(fn: () => void): FactoryPackageActionResult {
  try {
    fn();
    return { ok: true };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, message: error.message };
    throw error;
  }
}

export function printFactoryPackage(
  document: PolicyOpsDocument,
  changeRequestId: string,
): FactoryPackageActionResult {
  return toResult(() => {
    const pkg = buildFactoryPackage(document, changeRequestId);
    openPrintWindow(renderFactoryPackageHtml(pkg));
  });
}

export function downloadFactoryPackageMarkdown(
  document: PolicyOpsDocument,
  changeRequestId: string,
): FactoryPackageActionResult {
  return toResult(() => {
    const pkg = buildFactoryPackage(document, changeRequestId);
    const fileName = factoryPackageMarkdownFileName(pkg.identification.changeRequestCode);
    downloadTextFile(fileName, renderFactoryPackageMarkdown(pkg), 'text/markdown;charset=utf-8');
  });
}
