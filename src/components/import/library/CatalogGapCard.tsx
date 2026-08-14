import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import type { CatalogItemKind } from '@/core/document/schema';
import type { CatalogGap } from '@/core/import/library-gaps';
import { useDocumentStore } from '@/store/document-store';
import { applyCatalogItems } from './library-actions';

const KIND_LABEL: Record<CatalogItemKind, string> = {
  DECISION: 'Decisões',
  OFFER: 'Ofertas',
  LIMIT: 'Limites',
  TAG: 'Tags',
  MOTIVATOR: 'Motivadores',
  IMPACT_CATEGORY: 'Categorias de impacto',
};

/** Uma seção do passo 3 por kind de catálogo com itens faltando — US-03/US-04. */
export function CatalogGapCard({ gap }: { gap: CatalogGap }) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const [created, setCreated] = useState<Set<string>>(new Set());

  const pending = gap.items.filter((item) => !created.has(item.code));

  function createOne(item: { code: string; label: string }) {
    const result = applyCatalogItems(dispatch, gap.catalogKind, [item]);
    if (!result.ok) {
      toast({ title: `Não foi possível criar ${item.code}`, description: result.message });
      return;
    }
    setCreated((current) => new Set(current).add(item.code));
  }

  function createAll() {
    const result = applyCatalogItems(dispatch, gap.catalogKind, pending);
    if (!result.ok) {
      toast({ title: 'Não foi possível criar todos os itens', description: result.message });
      return;
    }
    setCreated((current) => new Set([...current, ...pending.map((item) => item.code)]));
    toast({ title: `${pending.length} itens de ${KIND_LABEL[gap.catalogKind]} criados` });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Catálogo · {KIND_LABEL[gap.catalogKind]}
          </h3>
          <Button type="button" size="sm" disabled={pending.length === 0} onClick={createAll}>
            Criar todos ({pending.length})
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Rótulo</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {gap.items.map((item) => (
              <TableRow key={item.code}>
                <TableCell className="font-mono text-xs">{item.code}</TableCell>
                <TableCell className="text-xs">{item.label}</TableCell>
                <TableCell>
                  {created.has(item.code) ? (
                    <span className="text-xs text-green-600 dark:text-green-400">criado</span>
                  ) : (
                    <Button type="button" variant="ghost" size="sm" onClick={() => createOne(item)}>
                      Criar
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
