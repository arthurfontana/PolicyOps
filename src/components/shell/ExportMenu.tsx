import { Download } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Menu "Exportar" unificado — docs/07-ux-e-editor.md §12, docs/prompts/S17
 * Parte C: mesmo componente no editor, na comparação e na tela de vigência.
 */
export type ExportMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
};

export function ExportMenu({
  items,
  label = 'Exportar',
  size = 'sm',
  variant = 'outline',
}: {
  items: ExportMenuItem[];
  label?: string;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant={variant} size={size}>
          <Download className="mr-1.5 h-3.5 w-3.5" /> {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.key}
            disabled={item.disabled}
            onSelect={(event) => {
              event.preventDefault();
              item.onSelect();
            }}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
