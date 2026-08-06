import { useEffect, useState } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  createCatalogItem,
  updateCatalogItem,
  type CreateCatalogItemInput,
  type UpdateCatalogItemInput,
} from '@/core/library/catalog';
import type { CatalogItemKind, CatalogItem } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';

export interface CatalogItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: CatalogItemKind;
  item?: CatalogItem;
  hasUsage?: boolean;
}

const KIND_LABELS: Record<CatalogItemKind, string> = {
  DECISION: 'Decisão',
  OFFER: 'Oferta',
  LIMIT: 'Limite',
  TAG: 'Tag',
};

export function CatalogItemDialog({ open, onOpenChange, kind, item, hasUsage }: CatalogItemDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);

  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('');
  const [numericValue, setNumericValue] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open && item) {
      setCode(item.code);
      setLabel(item.label);
      setDescription(item.description || '');
      setColor(item.color || '');
      setNumericValue(item.numericValue || '');
      setErrors({});
    } else if (open) {
      setCode('');
      setLabel('');
      setDescription('');
      setColor('');
      setNumericValue('');
      setErrors({});
    }
  }, [open, item]);

  const validateInputs = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!code.trim()) {
      newErrors.code = 'Código é obrigatório.';
    } else if (!/^[A-Z0-9_]+$/.test(code)) {
      newErrors.code = 'Código deve conter apenas maiúsculas, números e underscores.';
    } else if (!item && document) {
      // Check for duplicates only when creating
      const isDuplicate = document.catalog.some(
        (c) => c.kind === kind && c.code === code
      );
      if (isDuplicate) {
        newErrors.code = `Já existe um item desse tipo com o código "${code}".`;
      }
    }

    if (!label.trim()) {
      newErrors.label = 'Rótulo é obrigatório.';
    }

    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      newErrors.color = 'Cor deve estar no formato #RRGGBB.';
    }

    if (kind === 'LIMIT') {
      if (!numericValue.trim()) {
        newErrors.numericValue = 'Limite exige um valor numérico.';
      } else {
        const num = parseFloat(numericValue);
        if (isNaN(num) || num <= 0) {
          newErrors.numericValue = 'Valor deve ser um número positivo.';
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateInputs()) return;

    setIsSubmitting(true);
    try {
      let result;

      if (item) {
        const updateInput: UpdateCatalogItemInput = {
          id: item.id,
          label: label !== item.label ? label : undefined,
          description: description !== (item.description || '') ? description || null : undefined,
          color: color !== (item.color || '') ? color || null : undefined,
          numericValue: numericValue !== (item.numericValue || '') ? numericValue || null : undefined,
        };
        // Only include fields that actually changed
        const cleanInput = Object.fromEntries(
          Object.entries(updateInput).filter(([, v]) => v !== undefined),
        );
        result = dispatch(
          updateCatalogItem({
            ...cleanInput,
            id: item.id,
          } as UpdateCatalogItemInput),
        );
      } else {
        const createInput: CreateCatalogItemInput = {
          kind,
          code,
          label,
        };
        if (description) createInput.description = description;
        if (color) createInput.color = color;
        if (numericValue) createInput.numericValue = numericValue;
        result = dispatch(createCatalogItem(createInput));
      }

      if (!result.ok) {
        setErrors({ submit: result.error.message });
      } else {
        onOpenChange(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {item ? `Editar ${KIND_LABELS[kind].toLowerCase()}` : `Novo ${KIND_LABELS[kind].toLowerCase()}`}
          </DialogTitle>
          <DialogDescription>
            {item
              ? 'Altere as propriedades do item.'
              : `Crie um novo ${KIND_LABELS[kind].toLowerCase()} para usar nas células.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {errors.submit && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{errors.submit}</AlertDescription>
            </Alert>
          )}

          {item && hasUsage && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Renomear altera a exibição em <strong>todas</strong> as versões, inclusive
                históricas. Se o significado mudou, crie um item novo.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="code">Código</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="CODIGO_ITEM"
              disabled={!!item}
              className={errors.code ? 'border-red-500' : ''}
            />
            {errors.code && <p className="text-xs text-red-500">{errors.code}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="label">Rótulo</Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Nome exibido"
              className={errors.label ? 'border-red-500' : ''}
            />
            {errors.label && <p className="text-xs text-red-500">{errors.label}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição (opcional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrição adicional…"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="color">Cor (opcional)</Label>
            <div className="flex gap-2">
              <Input
                id="color"
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#RRGGBB"
                className={`flex-1 font-mono text-sm ${errors.color ? 'border-red-500' : ''}`}
              />
              {color && /^#[0-9A-Fa-f]{6}$/.test(color) && (
                <div
                  className="h-9 w-9 rounded border border-neutral-200 dark:border-neutral-800"
                  style={{ backgroundColor: color }}
                />
              )}
            </div>
            {errors.color && <p className="text-xs text-red-500">{errors.color}</p>}
          </div>

          {kind === 'LIMIT' && (
            <div className="space-y-2">
              <Label htmlFor="numericValue">Valor em R$</Label>
              <Input
                id="numericValue"
                type="number"
                value={numericValue}
                onChange={(e) => setNumericValue(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0"
                className={errors.numericValue ? 'border-red-500' : ''}
              />
              {errors.numericValue && <p className="text-xs text-red-500">{errors.numericValue}</p>}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            <Check className="mr-1.5 h-4 w-4" />
            {item ? 'Salvar' : 'Criar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
