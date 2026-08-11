import { useState } from 'react';
import { Check, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import type { Domain } from '@/core/document/schema';
import type { DomainsGap } from '@/core/import/library-gaps';
import { validateDomains } from '@/core/library/validate-domains';
import { useDocumentStore } from '@/store/document-store';
import { useImportStore } from '@/store/import-store';
import { DomainsEditor } from '@/components/library/DomainsEditor';
import { applyDomainsGap } from './library-actions';

type Resolution = { kind: 'PENDING' } | { kind: 'MAPPED'; code: string } | { kind: 'IGNORED' };

/** Uma seção do passo 3 por variável de eixo com domínios faltantes — US-03/US-04. */
export function DomainsGapCard({ gap }: { gap: DomainsGap }) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const updateColumn = useImportStore((s) => s.updateColumn);
  const profile = useImportStore((s) => s.profile);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDomains, setEditingDomains] = useState<Domain[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});

  if (document === null) return null;
  const variable = document.variables.find((candidate) => candidate.id === gap.variableId);
  const version =
    variable?.versions.find((v) => v.state === 'DRAFT') ??
    variable?.versions.find((v) => v.state === 'PUBLISHED');
  const existingDomains = version?.domains ?? [];

  const pending = gap.domains.filter((d) => (resolutions[d.code]?.kind ?? 'PENDING') === 'PENDING');

  function resolve(code: string, resolution: Resolution) {
    setResolutions((current) => ({ ...current, [code]: resolution }));
  }

  function mapTo(domain: Domain, existingCode: string) {
    const column = profile.columns.find((c) => c.column === gap.column);
    updateColumn(gap.column, { valueMap: { ...column?.valueMap, [domain.label]: existingCode } });
    resolve(domain.code, { kind: 'MAPPED', code: existingCode });
  }

  function ignore(domain: Domain) {
    const column = profile.columns.find((c) => c.column === gap.column);
    const ignoredValues = [...(column?.ignoredValues ?? []), domain.label];
    updateColumn(gap.column, { ignoredValues });
    resolve(domain.code, { kind: 'IGNORED' });
  }

  function openCreateDialog() {
    setEditingDomains([...existingDomains, ...pending]);
    setDialogOpen(true);
  }

  function handleConfirm() {
    if (document === null) return;
    const result = applyDomainsGap(dispatch, document, gap, editingDomains);
    if (!result.ok) {
      toast({ title: 'Não foi possível salvar os domínios', description: result.message });
      return;
    }
    setDialogOpen(false);
    toast({ title: `Domínios de ${gap.variableCode || gap.variableName} criados e publicados` });
  }

  const variableType = variable?.type ?? 'CATEGORICAL';
  const validationIssues = validateDomains(variableType, editingDomains);
  const issues = validationIssues.ok ? [] : validationIssues.issues;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {gap.variableCode || gap.variableName || '(variável nova)'}
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Eixo {gap.axis} · nível {gap.level} · coluna <span className="font-mono">{gap.column}</span> ·{' '}
              {gap.variablePublished ? `${gap.domains.length} domínios faltando` : 'variável sem versão publicada'}
            </p>
          </div>
          <Button type="button" size="sm" disabled={pending.length === 0} onClick={openCreateDialog}>
            Criar domínios pendentes ({pending.length})
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Rótulo do arquivo</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {gap.domains.map((domain) => {
              const resolution = resolutions[domain.code] ?? { kind: 'PENDING' as const };
              return (
                <TableRow key={domain.code}>
                  <TableCell className="font-mono text-xs">{domain.code}</TableCell>
                  <TableCell className="text-xs">{domain.label}</TableCell>
                  <TableCell className="text-xs">
                    {resolution.kind === 'PENDING' && (
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <Circle className="h-3 w-3" /> pendente
                      </span>
                    )}
                    {resolution.kind === 'MAPPED' && (
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                        <Check className="h-3 w-3" /> mapeado para {resolution.code}
                      </span>
                    )}
                    {resolution.kind === 'IGNORED' && (
                      <span className="text-neutral-500 dark:text-neutral-400">linhas ignoradas</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {resolution.kind === 'PENDING' && (
                      <div className="flex items-center gap-1.5">
                        {existingDomains.length > 0 && (
                          <Select onValueChange={(value) => mapTo(domain, value)}>
                            <SelectTrigger aria-label={`Mapear ${domain.code}`} className="h-7 w-32 text-xs">
                              <SelectValue placeholder="Mapear…" />
                            </SelectTrigger>
                            <SelectContent>
                              {existingDomains.map((existing) => (
                                <SelectItem key={existing.code} value={existing.code}>
                                  {existing.code}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <Button type="button" variant="ghost" size="sm" onClick={() => ignore(domain)}>
                          Ignorar
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Domínios de {gap.variableCode || gap.variableName}</DialogTitle>
            <DialogDescription>
              Revise antes de criar — grava por <span className="font-mono">variable/saveDomains</span> e publica em
              seguida.
            </DialogDescription>
          </DialogHeader>
          <DomainsEditor type={variableType} domains={editingDomains} onChange={setEditingDomains} issues={issues} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleConfirm}>
              Criar e publicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
