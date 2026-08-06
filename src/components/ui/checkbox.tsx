import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'h-4 w-4 shrink-0 rounded-sm border border-neutral-400 shadow-sm',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-neutral-900 data-[state=checked]:text-neutral-50 data-[state=checked]:border-neutral-900',
      'dark:border-neutral-600 dark:data-[state=checked]:bg-neutral-100 dark:data-[state=checked]:text-neutral-900 dark:data-[state=checked]:border-neutral-100',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Check className="h-3 w-3" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
