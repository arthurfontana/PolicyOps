import { useMemo } from 'react';
import { TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Domain, DefaultForUnlisted } from '@/core/document/schema';
import { generateTuples, type ApplicableCompatibility } from '@/core/axes/tuples';
import { countAllowedCombinations } from '@/core/queries';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * Editor em matriz de marcação — docs/07-ux-e-editor.md §11.
 *
 * Domínios do pai nas linhas, do filho nas colunas. O preview de tuplas usa
 * `generateTuples` de verdade (`src/core/axes/tuples.ts`, S03) — não uma
 * simulação: é o mesmo motor que o construtor de eixos vai consumir na S09.
 */

export interface CompatibilityMapEditorProps {
  ruleId: string;
  ruleCode: string;
  parentVariableId: string;
  childVariableId: string;
  compatibilityVersionId: string;
  parentLabel: string;
  childLabel: string;
  parentDomains: Domain[];
  childDomains: Domain[];
  allow: Record<string, string[]>;
  defaultForUnlisted: DefaultForUnlisted;
  onChange: (next: { allow: Record<string, string[]>; defaultForUnlisted: DefaultForUnlisted }) => void;
  disabled?: boolean;
}

const DEFAULT_EXPLANATION: Record<DefaultForUnlisted, string> = {
  ALL: 'Domínios do pai que não aparecerem no mapa liberam todos os domínios do filho.',
  NONE: 'Domínios do pai que não aparecerem no mapa não liberam nenhum domínio do filho — o domínio do pai desaparece do eixo.',
};

function orderedDomains(domains: Domain[]): Domain[] {
  return [...domains].sort((a, b) => a.position - b.position);
}

export function CompatibilityMapEditor({
  ruleId,
  ruleCode,
  parentVariableId,
  childVariableId,
  compatibilityVersionId,
  parentLabel,
  childLabel,
  parentDomains: parentDomainsInput,
  childDomains: childDomainsInput,
  allow,
  defaultForUnlisted,
  onChange,
  disabled = false,
}: CompatibilityMapEditorProps) {
  const parentDomains = useMemo(() => orderedDomains(parentDomainsInput), [parentDomainsInput]);
  const childDomains = useMemo(() => orderedDomains(childDomainsInput), [childDomainsInput]);
  const parentCodes = useMemo(() => new Set(parentDomains.map((d) => d.code)), [parentDomains]);
  const childCodes = useMemo(() => new Set(childDomains.map((d) => d.code)), [childDomains]);

  const unknownParentKeys = useMemo(
    () => Object.keys(allow).filter((code) => !parentCodes.has(code)),
    [allow, parentCodes],
  );
  const unknownChildCodes = useMemo(() => {
    const found = new Set<string>();
    for (const codes of Object.values(allow)) {
      for (const code of codes) if (!childCodes.has(code)) found.add(code);
    }
    return [...found];
  }, [allow, childCodes]);
  const hasUnknown = unknownParentKeys.length > 0 || unknownChildCodes.length > 0;

  function rawRow(parentCode: string): string[] {
    const explicit = allow[parentCode];
    if (explicit !== undefined) return explicit;
    return defaultForUnlisted === 'ALL' ? childDomains.map((d) => d.code) : [];
  }

  function isChecked(parentCode: string, childCode: string): boolean {
    return rawRow(parentCode).includes(childCode);
  }

  function emit(nextAllow: Record<string, string[]>, nextDefault: DefaultForUnlisted = defaultForUnlisted) {
    onChange({ allow: nextAllow, defaultForUnlisted: nextDefault });
  }

  function toggleCell(parentCode: string, childCode: string) {
    if (disabled) return;
    const current = new Set(rawRow(parentCode));
    if (current.has(childCode)) current.delete(childCode);
    else current.add(childCode);
    emit({ ...allow, [parentCode]: [...current] });
  }

  function setRow(parentCode: string, checked: boolean) {
    if (disabled) return;
    emit({ ...allow, [parentCode]: checked ? childDomains.map((d) => d.code) : [] });
  }

  function setColumn(childCode: string, checked: boolean) {
    if (disabled) return;
    const nextAllow = { ...allow };
    for (const parent of parentDomains) {
      const current = new Set(childDomains.filter((d) => isChecked(parent.code, d.code)).map((d) => d.code));
      if (checked) current.add(childCode);
      else current.delete(childCode);
      nextAllow[parent.code] = childDomains.filter((d) => current.has(d.code)).map((d) => d.code);
    }
    emit(nextAllow);
  }

  function clearUnknown() {
    if (disabled) return;
    const cleaned: Record<string, string[]> = {};
    for (const [parentCode, codes] of Object.entries(allow)) {
      if (!parentCodes.has(parentCode)) continue;
      cleaned[parentCode] = codes.filter((code) => childCodes.has(code));
    }
    emit(cleaned);
  }

  const overall = useMemo(
    () => countAllowedCombinations({ allow, defaultForUnlisted }, parentDomains, childDomains),
    [allow, defaultForUnlisted, parentDomains, childDomains],
  );

  const preview = useMemo(() => {
    const applicable: ApplicableCompatibility = {
      ruleId,
      ruleCode,
      parentVariableId,
      childVariableId,
      version: {
        id: compatibilityVersionId,
        number: 0,
        state: 'DRAFT',
        createdAt: '',
        createdBy: '',
        parentVariableVersionId: '',
        childVariableVersionId: '',
        allow,
        defaultForUnlisted,
      },
    };
    if (parentDomains.length === 0 || childDomains.length === 0) {
      return { tuples: [] as string[], warnings: [] as ReturnType<typeof generateTuples>['warnings'] };
    }
    try {
      const result = generateTuples({
        levels: [
          { variableId: parentVariableId, domains: parentDomains },
          { variableId: childVariableId, domains: childDomains },
        ],
        compatibility: [applicable],
      });
      return { tuples: result.tuples, warnings: result.warnings };
    } catch {
      return { tuples: [] as string[], warnings: [] as ReturnType<typeof generateTuples>['warnings'] };
    }
  }, [allow, defaultForUnlisted, parentDomains, childDomains, ruleId, ruleCode, parentVariableId, childVariableId, compatibilityVersionId]);

  const labelByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const domain of [...parentDomains, ...childDomains]) map.set(domain.code, domain.shortLabel ?? domain.label);
    return map;
  }, [parentDomains, childDomains]);

  if (parentDomains.length === 0 || childDomains.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        {parentLabel} e {childLabel} precisam ter ao menos um domínio cada para editar o mapa.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {overall.valid} de {overall.total} combinações válidas
        </span>
      </div>

      {hasUnknown && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="flex flex-col gap-1.5">
            <p>
              O mapa cita código(s) que não existem mais na versão pinada da variável:{' '}
              {[...unknownParentKeys, ...unknownChildCodes].map((code) => (
                <code key={code} className="mx-0.5 rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900/50">
                  {code}
                </code>
              ))}
              A variável pode ter evoluído desde que o mapa foi salvo.
            </p>
            {!disabled && (
              <Button size="sm" variant="outline" className="w-fit" onClick={clearUnknown}>
                Limpar códigos desconhecidos
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b border-r border-neutral-200 bg-neutral-50 p-2 text-left align-bottom font-medium text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
                {parentLabel} \ {childLabel}
              </th>
              {childDomains.map((child) => (
                <th
                  key={child.code}
                  className="border-b border-neutral-200 p-2 text-center align-bottom font-medium text-neutral-700 dark:border-neutral-800 dark:text-neutral-300"
                >
                  <div className="flex flex-col items-center gap-1">
                    <span>{child.shortLabel ?? child.label}</span>
                    {!disabled && (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="text-[10px] text-neutral-400 underline-offset-2 hover:underline"
                          onClick={() => setColumn(child.code, true)}
                        >
                          todos
                        </button>
                        <button
                          type="button"
                          className="text-[10px] text-neutral-400 underline-offset-2 hover:underline"
                          onClick={() => setColumn(child.code, false)}
                        >
                          nenhum
                        </button>
                      </div>
                    )}
                    <span className="font-mono text-[10px] text-neutral-400">
                      {parentDomains.filter((p) => isChecked(p.code, child.code)).length} de {parentDomains.length}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parentDomains.map((parent) => {
              const rowCount = childDomains.filter((c) => isChecked(parent.code, c.code)).length;
              return (
                <tr key={parent.code}>
                  <th className="sticky left-0 z-10 border-b border-r border-neutral-200 bg-neutral-50 p-2 text-left align-middle font-medium text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
                    <div className="flex flex-col gap-1">
                      <span>{parent.shortLabel ?? parent.label}</span>
                      <div className="flex items-center gap-1.5">
                        {!disabled && (
                          <>
                            <button
                              type="button"
                              className="text-[10px] text-neutral-400 underline-offset-2 hover:underline"
                              onClick={() => setRow(parent.code, true)}
                            >
                              todos
                            </button>
                            <button
                              type="button"
                              className="text-[10px] text-neutral-400 underline-offset-2 hover:underline"
                              onClick={() => setRow(parent.code, false)}
                            >
                              nenhum
                            </button>
                          </>
                        )}
                        <span className="font-mono text-[10px] text-neutral-400">
                          {rowCount} de {childDomains.length}
                        </span>
                      </div>
                    </div>
                  </th>
                  {childDomains.map((child) => (
                    <td
                      key={child.code}
                      className="border-b border-neutral-100 p-2 text-center dark:border-neutral-900"
                    >
                      <Checkbox
                        checked={isChecked(parent.code, child.code)}
                        disabled={disabled}
                        onCheckedChange={() => toggleCell(parent.code, child.code)}
                        aria-label={`${parent.label} → ${child.label}`}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Quando o domínio do pai não está no mapa
        </span>
        <Select
          value={defaultForUnlisted}
          onValueChange={(value) => emit(allow, value as DefaultForUnlisted)}
          disabled={disabled}
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Libera todos (ALL)</SelectItem>
            <SelectItem value="NONE">Não libera nenhum (NONE)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{DEFAULT_EXPLANATION[defaultForUnlisted]}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Preview do eixo resultante — {preview.tuples.length} tupla(s)
        </span>
        {preview.warnings.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-400">
            {preview.warnings.map((warning, index) => (
              <li key={index} className="flex items-start gap-1.5">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{warning.message}</span>
              </li>
            ))}
          </ul>
        )}
        {preview.tuples.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Nenhuma combinação válida com o mapa atual.
          </p>
        ) : (
          <ul
            className={cn(
              'flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-md border border-neutral-200 p-2 font-mono text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400',
            )}
          >
            {preview.tuples.map((tuple) => {
              const [parentCode, childCode] = tuple.split('|');
              return (
                <li key={tuple}>
                  {labelByCode.get(parentCode ?? '') ?? parentCode} → {labelByCode.get(childCode ?? '') ?? childCode}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
