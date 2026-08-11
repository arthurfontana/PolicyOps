import { useState } from 'react';
import { Archive, MoreVertical, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { archiveCatalogItem, updateCatalogItem } from '@/core/library/catalog';
import type { CatalogItemWithUsage } from '@/core/library/catalog';
import { formatBRL } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';

export interface CatalogTableRowProps {
  item: CatalogItemWithUsage;
  onEdit: () => void;
  _showArchived?: boolean;
}

/** Célula "Grupo" da aba TAG — editável em linha (docs/07-ux-e-editor.md §15). */
function GroupCell({ item }: { item: CatalogItemWithUsage }) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const [value, setValue] = useState(item.group ?? '');
  const [editing, setEditing] = useState(false);

  function commit() {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed === (item.group ?? '')) return;
    const result = dispatch(updateCatalogItem({ id: item.id, group: trimmed.length === 0 ? null : trimmed }));
    if (!result.ok) {
      setValue(item.group ?? '');
      alert(`Erro: ${result.error.message}`);
    }
  }

  return (
    <Input
      value={editing ? value : (item.group ?? '')}
      placeholder="Sem grupo"
      onFocus={() => setEditing(true)}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setValue(item.group ?? '');
          setEditing(false);
          e.currentTarget.blur();
        }
      }}
      className="h-8 border-transparent bg-transparent text-sm hover:border-neutral-200 focus:border-neutral-300 dark:hover:border-neutral-800 dark:focus:border-neutral-700"
    />
  );
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

  const totalUsage = item.usage.inPublished + item.usage.inDraft + item.usage.inMatrices;
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
      {kind === 'TAG' && (
        <TableCell>
          <GroupCell item={item} />
        </TableCell>
      )}
      <TableCell className="text-sm text-neutral-600 dark:text-neutral-400">
        {totalUsage === 0 ? (
          '—'
        ) : (
          <div className="space-y-0.5">
            {item.usage.inMatrices > 0 && (
              <div className="text-xs">
                {item.usage.inMatrices} {item.usage.inMatrices === 1 ? 'matriz' : 'matrizes'}
              </div>
            )}
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
