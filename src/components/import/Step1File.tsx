import { useEffect, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DELIMITERS, type Delimiter } from '@/core/import/parse-table';
import {
  matchImportProfile,
  nearestImportProfile,
  type DocumentWithProfiles,
} from '@/core/import/profile';
import { readImportFile } from '@/storage/import-file';
import { useDocumentStore } from '@/store/document-store';
import { useImportStore } from '@/store/import-store';
import { FileDropZone } from './FileDropZone';

const DELIMITER_LABEL: Record<Delimiter, string> = {
  ';': 'Ponto e vírgula (;)',
  ',': 'Vírgula (,)',
  '\t': 'Tabulação',
  '|': 'Barra vertical (|)',
};

/** Passo 1 — arquivo. docs/12-carga-de-matrizes.md US-01, §6.1. */
export function Step1File() {
  const document = useDocumentStore((s) => s.document);
  const fileName = useImportStore((s) => s.fileName);
  const rawText = useImportStore((s) => s.rawText);
  const formatOverride = useImportStore((s) => s.formatOverride);
  const parsed = useImportStore((s) => s.parsed);
  const recognizedProfile = useImportStore((s) => s.recognizedProfile);
  const loadText = useImportStore((s) => s.loadText);
  const setFormatOverride = useImportStore((s) => s.setFormatOverride);
  const setRecognizedProfile = useImportStore((s) => s.setRecognizedProfile);
  const jumpToPlan = useImportStore((s) => s.jumpToPlan);
  const headerDiffAcknowledged = useImportStore((s) => s.headerDiffAcknowledged);
  const acknowledgeHeaderDiff = useImportStore((s) => s.acknowledgeHeaderDiff);
  const fileInputRef = useRef<HTMLInputElement>(null);


  const matchedProfile = useMemo(() => {
    if (document === null || parsed === undefined || parsed.header.length === 0) return undefined;
    return matchImportProfile(document as DocumentWithProfiles, parsed.header);
  }, [document, parsed]);

  /**
   * RN-19: reconhecer é igualdade exata. Cabeçalho parecido mas diferente não
   * é reconhecido em silêncio — mostra a diferença coluna a coluna e pede
   * confirmação para seguir no mapeamento manual (CT-12).
   */
  const nearMiss = useMemo(() => {
    if (document === null || parsed === undefined || parsed.header.length === 0) return undefined;
    if (matchedProfile !== undefined) return undefined;
    return nearestImportProfile(document as DocumentWithProfiles, parsed.header);
  }, [document, parsed, matchedProfile]);

  useEffect(() => {
    setRecognizedProfile(matchedProfile);
  }, [matchedProfile, setRecognizedProfile]);

  async function handleFile(file: File) {
    const { text, fileName: name } = await readImportFile(file);
    loadText(text, name);
  }

  return (
    <div className="flex flex-col gap-4">
      <FileDropZone onFile={(file) => void handleFile(file)}>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Arraste o arquivo <code>.csv</code>/<code>.tsv</code> aqui
        </p>
      </FileDropZone>

      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.item(0);
            if (file !== null && file !== undefined) void handleFile(file);
            event.target.value = '';
          }}
        />
        <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
          Selecionar arquivo
        </Button>
        {fileName !== undefined && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">{fileName}</span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="import-paste">Ou cole o texto aqui</Label>
        <Textarea
          id="import-paste"
          rows={4}
          value={rawText ?? ''}
          onChange={(event) => loadText(event.target.value)}
          placeholder="Cole o conteúdo do arquivo delimitado"
        />
      </div>

      {parsed !== undefined && (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-delimiter">Separador</Label>
              <Select
                value={formatOverride.delimiter ?? parsed.format.delimiter}
                onValueChange={(value) => setFormatOverride({ delimiter: value as Delimiter })}
              >
                <SelectTrigger id="import-delimiter" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIMITERS.map((delimiter) => (
                    <SelectItem key={delimiter} value={delimiter}>
                      {DELIMITER_LABEL[delimiter]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-header-row">Linha de cabeçalho</Label>
              <Input
                id="import-header-row"
                type="number"
                min={1}
                className="w-28"
                value={formatOverride.headerRow ?? parsed.format.headerRow}
                onChange={(event) => setFormatOverride({ headerRow: Number(event.target.value) || 1 })}
              />
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {parsed.format.hasBom ? 'Com BOM' : 'Sem BOM'} · {parsed.rows.length} linhas ·{' '}
              {parsed.header.length} colunas
            </p>
          </div>

          {parsed.errors.length > 0 && (
            <Card className="border-red-300 dark:border-red-900">
              <CardContent className="flex flex-col gap-1.5 p-4">
                <p className="text-sm font-medium text-red-700 dark:text-red-400">
                  {parsed.errors.length === 1 ? '1 problema' : `${parsed.errors.length} problemas`} no
                  arquivo — corrija antes de avançar.
                </p>
                <ul className="flex flex-col gap-1 text-xs text-red-600 dark:text-red-400">
                  {parsed.errors.map((issue, index) => (
                    <li key={index}>
                      {issue.line !== undefined && `Linha ${issue.line}: `}
                      {issue.column !== undefined && `[${issue.column}] `}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {parsed.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-400">
              {parsed.warnings.map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </ul>
          )}

          {recognizedProfile !== undefined && (
            <Card className="border-green-300 dark:border-green-900">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <p className="text-sm text-green-700 dark:text-green-400">
                  ✓ Perfil <span className="font-mono">{recognizedProfile.code}</span> reconhecido pelo
                  cabeçalho.
                </p>
                <Button type="button" size="sm" onClick={jumpToPlan}>
                  Ir direto ao plano
                </Button>
              </CardContent>
            </Card>
          )}

          {nearMiss !== undefined && !headerDiffAcknowledged && (
            <Card className="border-amber-300 dark:border-amber-900" data-testid="header-diff">
              <CardContent className="flex flex-col gap-2 p-4">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  O cabeçalho parece o do perfil{' '}
                  <span className="font-mono">{nearMiss.profile.code}</span>, mas não é idêntico —
                  então ele não foi aplicado.
                </p>
                <ul className="flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-400">
                  {nearMiss.missing.map((column) => (
                    <li key={`missing-${column}`}>
                      <span className="font-mono">{column}</span> — o perfil espera esta coluna, e o
                      arquivo não a tem.
                    </li>
                  ))}
                  {nearMiss.extra.map((column) => (
                    <li key={`extra-${column}`}>
                      <span className="font-mono">{column}</span> — o arquivo traz esta coluna, e o
                      perfil não a previa.
                    </li>
                  ))}
                  {nearMiss.reordered && <li>As mesmas colunas, em outra ordem.</li>}
                </ul>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="self-start"
                  data-testid="confirm-manual-mapping"
                  onClick={acknowledgeHeaderDiff}
                >
                  Seguir com o mapeamento manual
                </Button>
              </CardContent>
            </Card>
          )}

          {parsed.errors.length === 0 && parsed.header.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              <Table>
                <TableHeader>
                  <TableRow>
                    {parsed.header.map((name) => (
                      <TableHead key={name} className="whitespace-nowrap font-mono text-xs">
                        {name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.rows.slice(0, 20).map((row, index) => (
                    <TableRow key={index}>
                      {row.map((value, cellIndex) => (
                        <TableCell key={cellIndex} className="whitespace-nowrap text-xs">
                          {value}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
