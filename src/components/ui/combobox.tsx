import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Nome acessível do campo (ex.: "Oferta"). Necessário porque, desabilitado,
   * o botão não tem name computado a partir do conteúdo em todo leitor de
   * tela — sem isso o gatilho fica mudo quando a versão não é editável.
   */
  'aria-label'?: string;
}

/**
 * Combobox com busca, construído sobre Popover + Input (sem `cmdk`) —
 * "Combobox" não é um primitivo Radix; docs/02-arquitetura.md pede apenas
 * primitivos Radix, então a lista filtrada é escrita à mão.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Selecione…',
  searchPlaceholder = 'Buscar…',
  emptyText = 'Nenhum resultado.',
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.label.toLowerCase().includes(q));
  }, [options, query]);

  const selected = options.find((option) => option.value === value);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn('w-full justify-between font-normal', className)}
        >
          <span className={cn('truncate', !selected && 'text-neutral-400 dark:text-neutral-500')}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-2" align="start">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="mb-2"
        />
        <ul role="listbox" className="max-h-60 overflow-auto">
          {filtered.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-neutral-500 dark:text-neutral-400">{emptyText}</li>
          )}
          {filtered.map((option) => {
            const isSelected = option.value === value;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange?.(option.value);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                    'hover:bg-neutral-100 dark:hover:bg-neutral-800',
                  )}
                >
                  <Check className={cn('h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{option.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
