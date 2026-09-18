import type { ReactNode } from 'react';
import { RefreshCw, type LucideIcon } from 'lucide-react';

/**
 * Shared shell for a query's error/empty state: an icon, a title, a
 * description, and optionally a retry action and/or extra content (e.g. a
 * form embedded in an empty state).
 */
export function QueryStateCard({
  icon: Icon,
  iconClassName = 'bg-accent-soft text-accent',
  title,
  description,
  onRetry,
  bordered = true,
  children,
}: {
  icon?: LucideIcon;
  iconClassName?: string;
  title: string;
  description: string;
  onRetry?: () => void;
  /** Set false when already nested inside a bordered container. */
  bordered?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-3 px-6 py-16 text-center ${bordered ? 'rounded-xl border border-border bg-surface' : ''}`}
    >
      {Icon && (
        <span
          className={`flex h-11 w-11 items-center justify-center rounded-lg ${iconClassName}`}
        >
          <Icon className="h-5 w-5" />
        </span>
      )}
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      <p className="max-w-sm text-sm text-fg-2">{description}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
      )}
      {children}
    </div>
  );
}
