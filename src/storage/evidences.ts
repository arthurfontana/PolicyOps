import type { Attachment, AttachmentTarget, PolicyOpsDocument } from '@/core/document/schema';
import { DomainError } from '@/core/errors';

/**
 * Cliente das rotas de evidência do servidor local — `POST`/`GET`/`DELETE
 * /api/evidences` (docs/14-plataforma-local.md §4 e §7, ADR-004).
 *
 * O acervo é do servidor; o **registro** dos anexos é o documento
 * (`attachments[]`, `src/core/document/evidence.ts`). Por isso `relPath` e
 * `sha256` viajam daqui para lá em toda chamada: o servidor não tem banco nem
 * índice para resolver um id sozinho, e não interpreta o documento além de
 * `meta.acl` (ADR-002, DEC-PLAT-005).
 *
 * Toda falha vira `DomainError` com mensagem pronta em pt-BR — inclusive o
 * caminho esperado no Explorer, que é a primeira coisa que alguém precisa
 * saber quando um arquivo do acervo foi movido à mão.
 */

/** docs/14 §7 — o mesmo `MAX_EVIDENCE_BYTES` do servidor, para avisar antes da subida. */
export const MAX_EVIDENCE_BYTES = 50 * 1024 * 1024;

export type EvidenceUploadInput = {
  file: File;
  /** Códigos (não nomes) do alvo: é deles que sai a pasta legível do acervo. */
  projectCode: string;
  matrixCode?: string;
  versionNumber?: number;
  /** `AAAA-MM-DD` local — o prefixo do nome do arquivo no acervo. */
  date: string;
};

export type EvidenceUploadResult = {
  id: string;
  relPath: string;
  fileName: string;
  sha256: string;
  bytes: number;
};

export type EvidenceApiOptions = {
  token: string;
  fetchImpl?: typeof fetch;
  /** Pasta de dados do servidor (`GET /api/health`) — só para compor o caminho nas mensagens. */
  dataDir?: string;
};

export const EVIDENCE_DIR_NAME = '_evidencias';
export const EVIDENCE_TRASH_DIR_NAME = '_lixeira';

/** `politica-pf/mtz-limite-pf/v12/2026-08-14_DB.docx` → `…\_evidencias\politica-pf\…` */
export function explorerPath(relPath: string, dataDir?: string): string {
  const windows = `${EVIDENCE_DIR_NAME}\\${relPath.replace(/\//g, '\\')}`;
  return dataDir === undefined ? windows : `${dataDir}\\${windows}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Mensagem do arquivo grande demais — mostrada antes de subir e depois do `413`. */
export function tooLargeMessage(bytes: number): string {
  return `O arquivo tem ${formatBytes(bytes)} e o limite por evidência é ${formatBytes(MAX_EVIDENCE_BYTES)}. Anexe uma versão menor (ou compactada) do documento.`;
}

/** Motivo exibido no lugar da seção quando o modo não é `SERVER` (docs/14 §8). */
export const EVIDENCE_UNAVAILABLE_REASON =
  'Evidências exigem o servidor local: o acervo vive na pasta de rede, e só o servidor pode gravar nela. Abra a aplicação pelo iniciar.bat para anexar arquivos.';

export type EvidenceErrorBody = { code?: string; detail?: string };

export class EvidenceApi {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly dataDir: string | undefined;

  constructor(options: EvidenceApiOptions) {
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.dataDir = options.dataDir;
  }

  private headers(): Record<string, string> {
    return { 'X-PolicyOps-Token': this.token };
  }

  private async failure(response: Response, relPath: string, fallback: string): Promise<DomainError> {
    let body: EvidenceErrorBody = {};
    try {
      body = (await response.json()) as EvidenceErrorBody;
    } catch {
      /* corpo não-JSON: segue com o texto padrão */
    }
    const detail = typeof body.detail === 'string' && body.detail !== '' ? body.detail : fallback;

    if (response.status === 404) {
      return new DomainError(
        'EVIDENCE_NOT_FOUND',
        `${detail} O caminho esperado é ${explorerPath(relPath, this.dataDir)} — se alguém moveu o arquivo à mão, devolva-o para lá (ou procure em ${EVIDENCE_DIR_NAME}\\${EVIDENCE_TRASH_DIR_NAME}).`,
      );
    }
    if (response.status === 409) {
      return new DomainError(
        'DOCUMENT_INVALID',
        `${detail} O conteúdo de ${explorerPath(relPath, this.dataDir)} não confere com o hash registrado quando a evidência foi anexada: ela não vale mais como prova até alguém restaurar o arquivo original.`,
      );
    }
    if (response.status === 403) return new DomainError('ROLE_REQUIRED', detail);
    return new DomainError('DOCUMENT_INVALID', detail);
  }

  private networkError(error: unknown): DomainError {
    return new DomainError(
      'DOCUMENT_INVALID',
      `Não foi possível falar com o servidor local — ele foi fechado? (${String(error)})`,
    );
  }

  /** `POST /api/evidences`: copia o arquivo para o acervo e devolve caminho + hash. */
  async upload(input: EvidenceUploadInput): Promise<EvidenceUploadResult> {
    if (input.file.size > MAX_EVIDENCE_BYTES) {
      throw new DomainError('INVALID_INPUT', tooLargeMessage(input.file.size));
    }

    const form = new FormData();
    form.append('file', input.file, input.file.name);
    form.append('project', input.projectCode);
    if (input.matrixCode !== undefined) form.append('matrix', input.matrixCode);
    if (input.versionNumber !== undefined) form.append('version', String(input.versionNumber));
    form.append('date', input.date);

    let response: Response;
    try {
      response = await this.fetchImpl('/api/evidences', {
        method: 'POST',
        headers: this.headers(),
        body: form,
      });
    } catch (error) {
      throw this.networkError(error);
    }

    if (response.status === 413) {
      throw new DomainError('INVALID_INPUT', tooLargeMessage(input.file.size));
    }
    if (!response.ok) {
      throw await this.failure(response, input.file.name, 'Não foi possível anexar o arquivo ao acervo.');
    }
    return (await response.json()) as EvidenceUploadResult;
  }

  /**
   * `GET /api/evidences/{id}`: os bytes do anexo, **depois** de o servidor
   * conferir o hash registrado. Divergência vira erro aqui, não um download
   * silencioso de conteúdo adulterado.
   */
  async download(attachment: Attachment): Promise<Blob> {
    const query = new URLSearchParams({ relPath: attachment.relPath, sha256: attachment.sha256 });
    let response: Response;
    try {
      response = await this.fetchImpl(`/api/evidences/${encodeURIComponent(attachment.id)}?${query.toString()}`, {
        headers: this.headers(),
      });
    } catch (error) {
      throw this.networkError(error);
    }
    if (!response.ok) {
      throw await this.failure(response, attachment.relPath, 'Não foi possível abrir a evidência.');
    }
    return await response.blob();
  }

  /**
   * `DELETE /api/evidences/{id}`: manda o arquivo para `_evidencias/_lixeira/`.
   * Chamado **só depois** de um salvamento bem-sucedido que já tirou o vínculo
   * (docs/14 §7) — nunca no desanexo, que ainda pode ser desfeito.
   */
  async trash(relPath: string, id = 'x'): Promise<boolean> {
    const query = new URLSearchParams({ relPath });
    let response: Response;
    try {
      response = await this.fetchImpl(`/api/evidences/${encodeURIComponent(id)}?${query.toString()}`, {
        method: 'DELETE',
        headers: this.headers(),
      });
    } catch (error) {
      throw this.networkError(error);
    }
    if (!response.ok) {
      throw await this.failure(response, relPath, 'Não foi possível mover a evidência para a lixeira do acervo.');
    }
    const body = (await response.json()) as { trashed?: boolean };
    return body.trashed === true;
  }
}

/**
 * O que o alvo de um anexo vira em pasta do acervo. Precisa do documento
 * porque o servidor recebe **códigos**, não ids — é o código que sobrevive a
 * um `rename` e que uma pessoa reconhece no Explorer.
 */
export function targetCodes(
  doc: PolicyOpsDocument,
  target: AttachmentTarget,
): { projectCode: string; matrixCode?: string; versionNumber?: number } | null {
  if (target.kind === 'PROJECT') {
    const project = doc.projects.find((candidate) => candidate.id === target.projectId);
    return project === undefined ? null : { projectCode: project.code };
  }
  const matrix = doc.matrices.find((candidate) => candidate.id === target.matrixId);
  if (matrix === undefined) return null;
  const project = doc.projects.find((candidate) => candidate.id === matrix.projectId);
  if (project === undefined) return null;
  return {
    projectCode: project.code,
    matrixCode: matrix.code,
    ...(target.kind === 'VERSION' ? { versionNumber: target.versionNumber } : {}),
  };
}

/** `AAAA-MM-DD` no fuso de quem anexa — é o prefixo que aparece no Explorer. */
export function localDateStamp(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
