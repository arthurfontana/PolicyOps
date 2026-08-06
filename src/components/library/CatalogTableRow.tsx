import { Archive, MoreVertical, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TableCell, TableRow } from '@/components/ui/table';
import { archiveCatalogItem } from '@/core/library/catalog';
import type { CatalogItemWithUsage } from '@/core/library/catalog';
import { useDocumentStore } from '@/store/document-store';

export interface CatalogTableRowProps {
  item: CatalogItemWithUsage;
  onEdit: () => void;
  _showArchived?: boolean;
}

function formatBRL(value: string | undefined): string {
  if (!value) return '—';
  const num = parseFloat(value);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

export function CatalogTableRow({ item, onEdit }: CatalogTableRowProps) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { kind } = item;

  const handleArchive = () => {
    const result = dispatch(archiveCatalogItem({ id: item.id }));
    if (!result.ok) {
      alert(`Erro: ${result.error.message}`);
    }
  };

  const handleUnarchive = () => {
    // Run archive to get its inverse (which will unarchive)
    const result = dispatch(archiveCatalogItem({ id: item.id }));
    if (result.ok) {
      // Successfully archived, now run the inverse to unarchive
      const undoResult = dispatch(result.inverse);
      if (!undoResult.ok) {
        alert(`Erro: ${undoResult.error.message}`);
      }
    } else {
      alert(`Erro: ${result.error.message}`);
    }
  };

  const totalUsage = item.usage.inPublished + item.usage.inDraft;
  const isArchived = !!item.archivedAt;

  return (
    <TableRow className={isArchived ? 'opacity-50' : ''}>
      <TableCell>
        <div
          className="h-5 w-5 rounded border"
          style={{ backgroundColor: item.color || '#E5E7EB' }}
          title={item.color || 'sem cor'}
        />
      </TableCell>
      <TableCell className="font-mono text-sm text-neutral-600 dark:text-neutral-400">
        {item.code}
      </TableCell>
      <TableCell>
        <div>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.label}</p>
          {item.description && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{item.description}</p>
          )}
          {isArchived && <Badge variant="secondary" className="mt-2">Arquivado</Badge>}
        </div>
      </TableCell>
      {kind === 'LIMIT' && <TableCell className="text-sm">{formatBRL(item.numericValue)}</TableCell>}
      <TableCell className="text-sm text-neutral-600 dark:text-neutral-400">
        {totalUsage === 0 ? (
          '—'
        ) : (
          <div className="space-y-0.5">
            {item.usage.inPublished > 0 && (
              <div className="text-xs">
                {item.usage.inPublished} {item.usage.inPublished === 1 ? 'vigente' : 'vigentes'}
              </div>
            )}
            {item.usage.inDraft > 0 && (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                {item.usage.inDraft} {item.usage.inDraft === 1 ? 'rascunho' : 'rascunhos'}
              </div>
            )}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>Editar</DropdownMenuItem>
            {isArchived ? (
              <DropdownMenuItem onClick={handleUnarchive}>
                <Undo2 className="mr-2 h-4 w-4" />
                Restaurar
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={handleArchive} className="text-red-600 dark:text-red-400">
                <Archive className="mr-2 h-4 w-4" />
                Arquivar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
