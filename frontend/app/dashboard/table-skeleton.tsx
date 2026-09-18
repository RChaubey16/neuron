/**
 * Loading placeholder for a table: a header row of column labels followed by
 * `rows` rows of pulsing bars. `gridColsClassName`/`minWidthClassName` must
 * be literal Tailwind classes (e.g. "grid-cols-4", "min-w-[640px]") — not
 * built dynamically — so Tailwind's content scanner can find them.
 */
export function TableSkeleton({
  columns,
  gridColsClassName,
  minWidthClassName,
  rows = 4,
}: {
  columns: string[];
  gridColsClassName: string;
  minWidthClassName: string;
  rows?: number;
}) {
  const rowClassName = `grid ${minWidthClassName} ${gridColsClassName} gap-4`;

  return (
    <div className="divide-y divide-border overflow-x-auto">
      <div
        className={`${rowClassName} px-5 py-3 text-xs font-medium tracking-wide text-fg-3`}
      >
        {columns.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`${rowClassName} items-center px-5 py-4`}>
          {columns.map((_, j) => (
            <span
              key={j}
              className="h-3.5 w-3/4 animate-pulse rounded bg-surface-2"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
