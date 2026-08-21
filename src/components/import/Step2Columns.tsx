import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CreateVariableDialog } from '@/components/library/CreateVariableDialog';
import type { ImportTable } from '@/core/import/parse-table';
import {
  columnsWithRole,
  humanizeValue,
  mapColumnValue,
  renderTemplate,
  type ColumnMapping,
  type DocumentWithProfiles,
  type ImportProfile,
  type ValueField,
} from '@/core/import/profile';
import { useDocumentStore } from '@/store/document-store';
import { useImportStore } from '@/store/import-store';
import { Step2CalcPanel } from './Step2CalcPanel';

type RoleOption = 'PARTITION' | 'AXIS_X' | 'AXIS_Y' | 'VALUE' | 'CHECK' | 'IGNORE';

const ROLE_LABEL: Record<RoleOption, string> = {
  PARTITION: 'Partição',
  AXIS_X: 'Eixo X',
  AXIS_Y: 'Eixo Y',
  VALUE: 'Valor',
  CHECK: 'Conferência',
  IGNORE: 'Ignorar',
};

const VALUE_FIELD_LABEL: Record<'offer' | 'limit' | 'limitMin' | 'limitMax' | 'note' | 'attr', string> = {
  offer: 'Oferta',
  limit: 'Limite',
  limitMin: 'Limite mínimo',
  limitMax: 'Limite máximo',
  note: 'Nota',
  attr: 'Atributo…',
};

function roleOptionOf(mapping: ColumnMapping): RoleOption {
  if (mapping.role === 'AXIS') return mapping.axis?.role === 'Y' ? 'AXIS_Y' : 'AXIS_X';
  return mapping.role as RoleOption;
}

/** Chaves de matriz distintas produzidas pelo mapeamento — prévia local, sem exigir eixo válido. */
function previewKeys(table: ImportTable, profile: ImportProfile) {
  const partitions = columnsWithRole(profile, 'PARTITION');
  if (partitions.length === 0) return [];
  const indexOf = new Map(table.header.map((name, index) => [name, index]));
  const seen = new Map<string, Record<string, string>>();
  for (const row of table.rows) {
    const values: Record<string, string> = {};
    for (const p of partitions) {
      const raw = row[indexOf.get(p.column) ?? -1] ?? '';
      values[p.column] = mapColumnValue(p, raw);
    }
    const options = profile.unpivot?.options ?? [undefined];
    for (const option of options) {
      const kv = option === undefined || profile.unpivot === undefined
        ? values
        : { ...values, [profile.unpivot.code]: option.code };
      const key = Object.values(kv).join('|');
      if (!seen.has(key)) seen.set(key, kv);
    }
  }
  return [...seen.entries()];
}

/** Passo 2 — colunas. docs/12-carga-de-matrizes.md US-02, §5.2, §5.3, §6.1. */
export function Step2Columns({ table }: { table: ImportTable }) {
  const document = useDocumentStore((s) => s.document);
  const profile = useImportStore((s) => s.profile);
  const updateColumn = useImportStore((s) => s.updateColumn);
  const setUnpivot = useImportStore((s) => s.setUnpivot);
  const setCodeTemplate = useImportStore((s) => s.setCodeTemplate);
  const setNameTemplate = useImportStore((s) => s.setNameTemplate);
  const setProjectId = useImportStore((s) => s.setProjectId);
  const [creatingVariableFor, setCreatingVariableFor] = useState<string | null>(null);
  const keys = useMemo(() => previewKeys(table, profile), [table, profile]);
  const codeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [, values] of keys) {
      const code = renderTemplate(profile.codeTemplate, values);
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return counts;
  }, [keys, profile.codeTemplate]);

  if (document === null) return null;
  const docWithProfiles = document as DocumentWithProfiles;
  const variables = document.variables;
  const projects = document.projects;
  const valueColumns = columnsWithRole(profile, 'VALUE');

  function patchAxis(column: string, patch: Partial<{ role: 'X' | 'Y'; level: number; variableId: string }>) {
    const current = profile.columns.find((c) => c.column === column);
    const axis = current?.axis ?? { role: 'X' as const, level: 0, variableId: '' };
    updateColumn(column, { axis: { ...axis, ...patch } });
  }

  function handleRoleChange(mapping: ColumnMapping, next: RoleOption) {
    if (next === 'PARTITION') {
      updateColumn(mapping.column, { role: 'PARTITION', axis: undefined, value: undefined, check: undefined });
    } else if (next === 'AXIS_X' || next === 'AXIS_Y') {
      const axis = mapping.axis ?? { role: 'X' as const, level: 0, variableId: '' };
      updateColumn(mapping.column, {
        role: 'AXIS',
        axis: { ...axis, role: next === 'AXIS_Y' ? 'Y' : 'X' },
        value: undefined,
        check: undefined,
      });
    } else if (next === 'VALUE') {
      updateColumn(mapping.column, {
        role: 'VALUE',
        value: mapping.value ?? { field: 'offer' },
        axis: undefined,
        check: undefined,
      });
    } else if (next === 'CHECK') {
      updateColumn(mapping.column, {
        role: 'CHECK',
        check: mapping.check ?? { expected: '' },
        axis: undefined,
        value: undefined,
      });
    } else {
      updateColumn(mapping.column, { role: 'IGNORE', axis: undefined, value: undefined, check: undefined });
    }
  }

  return (
    <div className="flex gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-project">Projeto de destino</Label>
          <Select value={profile.projectId} onValueChange={setProjectId}>
            <SelectTrigger id="import-project" className="w-72">
              <SelectValue placeholder="Selecione o projeto" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Coluna</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Detalhe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profile.columns.map((mapping) => (
                <TableRow key={mapping.column}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{mapping.column}</TableCell>
                  <TableCell className="w-40">
                    <Select
                      value={roleOptionOf(mapping)}
                      onValueChange={(value) => handleRoleChange(mapping, value as RoleOption)}
                    >
                      <SelectTrigger aria-label={`Papel de ${mapping.column}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ROLE_LABEL) as RoleOption[]).map((option) => (
                          <SelectItem key={option} value={option}>
                            {ROLE_LABEL[option]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {mapping.role === 'AXIS' && mapping.axis !== undefined && (
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`level-${mapping.column}`} className="text-xs">
                          Nível
                        </Label>
                        <Input
                          id={`level-${mapping.column}`}
                          aria-label={`Nível de ${mapping.column}`}
                          type="number"
                          min={0}
                          max={2}
                          className="w-16"
                          value={mapping.axis.level}
                          onChange={(event) => patchAxis(mapping.column, { level: Number(event.target.value) || 0 })}
                        />
                        <Select
                          value={mapping.axis.variableId}
                          onValueChange={(value) => {
                            if (value === '__new__') {
                              setCreatingVariableFor(mapping.column);
                              return;
                            }
                            patchAxis(mapping.column, { variableId: value });
                          }}
                        >
                          <SelectTrigger aria-label={`Variável de ${mapping.column}`} className="w-56">
                            <SelectValue placeholder="Selecione a variável" />
                          </SelectTrigger>
                          <SelectContent>
                            {variables.map((variable) => (
                              <SelectItem key={variable.id} value={variable.id}>
                                {variable.code}
                              </SelectItem>
                            ))}
                            <SelectItem value="__new__">
                              <span className="flex items-center gap-1">
                                <Plus className="h-3 w-3" /> Nova variável…
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {mapping.role === 'VALUE' && mapping.value !== undefined && (
                      <div className="flex items-center gap-2">
                        <Select
                          value={mapping.value.field.startsWith('attr:') ? 'attr' : mapping.value.field}
                          onValueChange={(value) => {
                            const field: ValueField = value === 'attr' ? 'attr:campo' : (value as ValueField);
                            updateColumn(mapping.column, { value: { field } });
                          }}
                        >
                          <SelectTrigger aria-label={`Campo de ${mapping.column}`} className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(VALUE_FIELD_LABEL) as Array<keyof typeof VALUE_FIELD_LABEL>).map(
                              (option) => (
                                <SelectItem key={option} value={option}>
                                  {VALUE_FIELD_LABEL[option]}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                        {mapping.value.field.startsWith('attr:') && (
                          <Input
                            className="w-32"
                            value={mapping.value.field.slice(5)}
                            onChange={(event) =>
                              updateColumn(mapping.column, { value: { field: `attr:${event.target.value}` } })
                            }
                            placeholder="nome do atributo"
                          />
                        )}
                      </div>
                    )}
                    {mapping.role === 'CHECK' && mapping.check !== undefined && (
                      <Input
                        className="w-40"
                        value={mapping.check.expected}
                        onChange={(event) => updateColumn(mapping.column, { check: { expected: event.target.value } })}
                        placeholder="valor esperado"
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                Desdobramento (colunas de valor → dimensão)
              </h3>
              {profile.unpivot === undefined ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={valueColumns.length === 0}
                  onClick={() => setUnpivot({ code: 'CANAL', label: 'Canal', options: [] })}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Desdobrar
                </Button>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setUnpivot(undefined)}>
                  <X className="mr-1 h-3.5 w-3.5" /> Remover desdobramento
                </Button>
              )}
            </div>
            {profile.unpivot !== undefined && (
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <Input
                    className="w-40"
                    value={profile.unpivot.code}
                    onChange={(event) =>
                      setUnpivot({ ...profile.unpivot!, code: event.target.value.toUpperCase() })
                    }
                    placeholder="CANAL"
                  />
                  <Input
                    className="w-40"
                    value={profile.unpivot.label}
                    onChange={(event) => setUnpivot({ ...profile.unpivot!, label: event.target.value })}
                    placeholder="Canal"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  {valueColumns.map((column) => {
                    const option = profile.unpivot!.options.find((o) => o.column === column.column);
                    return (
                      <div key={column.column} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          aria-label={`Incluir ${column.column} no desdobramento`}
                          checked={option !== undefined}
                          onCheckedChange={(checked) => {
                            const options = profile.unpivot!.options.filter((o) => o.column !== column.column);
                            if (checked === true) {
                              options.push({
                                column: column.column,
                                code: column.column.toUpperCase(),
                                label: humanizeValue(column.column),
                              });
                            }
                            setUnpivot({ ...profile.unpivot!, options });
                          }}
                        />
                        <span className="w-40 font-mono text-xs">{column.column}</span>
                        {option !== undefined && (
                          <>
                            <Input
                              className="w-32"
                              value={option.code}
                              onChange={(event) =>
                                setUnpivot({
                                  ...profile.unpivot!,
                                  options: profile.unpivot!.options.map((o) =>
                                    o.column === column.column
                                      ? { ...o, code: event.target.value.toUpperCase() }
                                      : o,
                                  ),
                                })
                              }
                            />
                            <Input
                              className="w-32"
                              value={option.label}
                              onChange={(event) =>
                                setUnpivot({
                                  ...profile.unpivot!,
                                  options: profile.unpivot!.options.map((o) =>
                                    o.column === column.column ? { ...o, label: event.target.value } : o,
                                  ),
                                })
                              }
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Código e nome da matriz</h3>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-code-template">Padrão de código</Label>
              <Input
                id="import-code-template"
                value={profile.codeTemplate}
                onChange={(event) => setCodeTemplate(event.target.value.toUpperCase())}
                placeholder="MTZ_{CLUSTER_GRUPO}_{CANAL}"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-name-template">Padrão de nome</Label>
              <Input
                id="import-name-template"
                value={profile.nameTemplate}
                onChange={(event) => setNameTemplate(event.target.value)}
                placeholder="{CLUSTER_GRUPO} · {CANAL}"
              />
            </div>
            {keys.length > 0 && (
              <ul className="flex flex-wrap gap-1.5 text-xs">
                {keys.slice(0, 12).map(([key, values]) => {
                  const code = renderTemplate(profile.codeTemplate, values);
                  const collides = (codeCounts.get(code) ?? 0) > 1;
                  return (
                    <li
                      key={key}
                      className={
                        collides
                          ? 'rounded border border-red-400 bg-red-50 px-1.5 py-0.5 font-mono text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400'
                          : 'rounded border border-neutral-200 px-1.5 py-0.5 font-mono text-neutral-600 dark:border-neutral-800 dark:text-neutral-400'
                      }
                    >
                      {code === '' ? '(vazio)' : code}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Step2CalcPanel doc={docWithProfiles} table={table} profile={profile} matrixCount={keys.length} />

      <CreateVariableDialog
        open={creatingVariableFor !== null}
        onOpenChange={(open) => {
          if (!open) setCreatingVariableFor(null);
        }}
        onCreated={(variableId) => {
          if (creatingVariableFor !== null) patchAxis(creatingVariableFor, { variableId });
          setCreatingVariableFor(null);
        }}
      />
    </div>
  );
}
