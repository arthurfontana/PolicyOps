/** Skeleton de carregamento para listas (variáveis, compatibilidade, matrizes…) — docs/07 §12. */
export function ListSkeleton({ rows = 5, label = 'Carregando lista' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-2 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-12 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-900"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}
