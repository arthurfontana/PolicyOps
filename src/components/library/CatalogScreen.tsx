import { useState } from 'react';
import { Archive, Plus, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { CatalogItem, CatalogItemKind } from '@/core/document/schema';
import { listCatalog } from '@/core/library/catalog';
import { useDocumentStore } from '@/store/document-store';
import { CatalogItemDialog } from './CatalogItemDialog';
import { CatalogTableRow } from './CatalogTableRow';

const KIND_LABELS: Record<CatalogItemKind, string> = {
  DECISION: 'Decisões',
  OFFER: 'Ofertas',
  LIMIT: 'Limites',
  TAG: 'Tags',
};

const KIND_ICONS: Record<CatalogItemKind, React.ReactNode> = {
  DECISION: '✓',
  OFFER: '◇',
  LIMIT: '£',
  TAG: <Tag className="h-4 w-4" />,
};

const KINDS: CatalogItemKind[] = ['DECISION', 'OFFER', 'LIMIT', 'TAG'];

/**
 * Rota `/library/content` — docs/07-ux-e-editor.md §11.
 * Abas por kind com tabela de itens, reordenação por drag e toggle de arquivados.
 */
export function CatalogScreen() {
  const document = useDocumentStore((s) => s.document);
  const [currentKind, setCurrentKind] = useState<CatalogItemKind>('DECISION');
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [editingItem, setEditingItem] = useState<CatalogItem | undefined>();
  const [editingItemHasUsage, setEditingItemHasUsage] = useState(false);

  if (document === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum documento aberto.</p>
      </div>
    );
  }

  const items = listCatalog(document, { kind: currentKind, includeArchived: showArchived });
  const filtered = items.filter(
    (item) =>
      item.code.toLowerCase().includes(search.toLowerCase()) ||
      item.label.toLowerCase().includes(search.toLowerCase()),
  );

  const isEmpty = document.catalog.filter((item) => item.kind === currentKind && !item.archivedAt)
    .length === 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-8">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Biblioteca › Conteúdo
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Itens reutilizáveis das células: decisões, ofertas, limites e tags.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Novo item
        </Button>
      </div>

      <Tabs value={currentKind} onValueChange={(value) => setCurrentKind(value as CatalogItemKind)}>
        <TabsList>
          {KINDS.map((kind) => (
            <TabsTrigger key={kind} value={kind} className="gap-2">
              <span className="text-sm">{KIND_ICONS[kind]}</span>
              <span>{KIND_LABELS[kind]}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {KINDS.map((kind) => (
          <TabsContent key={kind} value={kind} className="space-y-4">
            {isEmpty && !showArchived ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                  <div className="text-2xl">{KIND_ICONS[kind]}</div>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    Nenhum item de {KIND_LABELS[kind].toLowerCase()} ainda. Crie o primeiro para usar nas
                    células.
                  </p>
                  <Button onClick={() => setDialogOpen(true)}>
                    <Plus className="mr-1.5 h-4 w-4" /> Novo {KIND_LABELS[kind].toLowerCase().slice(0, -1)}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <Input
                    placeholder="Buscar por código ou rótulo…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="max-w-sm"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowArchived(!showArchived)}
                    className="gap-2"
                  >
                    <Archive className="h-4 w-4" />
                    {showArchived ? 'Ocultar' : 'Mostrar'} arquivados
                  </Button>
                </div>

                {filtered.length === 0 ? (
                  <Card>
                    <CardContent className="p-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                      {search
                        ? 'Nenhum item corresponde à busca.'
                        : showArchived
                          ? 'Nenhum item arquivado.'
                          : 'Nenhum item disponível.'}
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <Table>
                      <TableHeader>
                        <TableRow className="border-t">
                          <TableHead className="w-12"></TableHead>
                          <TableHead className="w-32">Código</TableHead>
                          <TableHead className="flex-1">Rótulo</TableHead>
                          {kind === 'LIMIT' && <TableHead className="w-32">Valor (BRL)</TableHead>}
                          <TableHead className="w-24">Uso</TableHead>
                          <TableHead className="w-12"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((item) => (
                          <CatalogTableRow
                            key={item.id}
                            item={item}
                            onEdit={() => {
                              setEditingItem(item);
                              setEditingItemHasUsage(item.usage.inPublished > 0 || item.usage.inDraft > 0);
                              setDialogOpen(true);
                            }}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                )}
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <CatalogItemDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingItem(undefined);
            setEditingItemHasUsage(false);
          }
        }}
        kind={currentKind}
        item={editingItem}
        hasUsage={editingItemHasUsage}
      />
    </div>
  );
}
