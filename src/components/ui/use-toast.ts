import { create } from 'zustand';
import type { ToastVariant } from './toast';

export interface ToastItem {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastState {
  toasts: ToastItem[];
  toast: (item: Omit<ToastItem, 'id'>) => string;
  dismiss: (id: string) => void;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `toast-${counter}`;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  toast: (item) => {
    const id = nextId();
    set((s) => ({ toasts: [...s.toasts, { ...item, id }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function useToast() {
  const toasts = useToastStore((s) => s.toasts);
  const toast = useToastStore((s) => s.toast);
  const dismiss = useToastStore((s) => s.dismiss);
  return { toasts, toast, dismiss };
}
