import type { ApiKey, UsageSummary } from './api';

export type RangeDays = 7 | 30 | 90;

/**
 * Keeps only rows within the last `days` (inclusive of today), based on each
 * row's own `date` string — usage endpoint returns full history with no
 * server-side range filter, so the range tabs filter client-side.
 */
export function filterByRange(
  rows: UsageSummary[],
  days: RangeDays,
  today: Date = new Date(),
): UsageSummary[] {
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  return rows.filter((row) => row.date >= cutoffDate);
}

export function totalCalls(rows: UsageSummary[]): number {
  return rows.reduce((sum, row) => sum + row.count, 0);
}

export function callsOnDate(rows: UsageSummary[], date: string): number {
  return rows
    .filter((row) => row.date === date)
    .reduce((sum, row) => sum + row.count, 0);
}

export function mostUsedService(
  rows: UsageSummary[],
): { service: string; share: number } | null {
  if (rows.length === 0) return null;

  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.service, (totals.get(row.service) ?? 0) + row.count);
  }

  const total = totalCalls(rows);
  const [service, count] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  return { service, share: total === 0 ? 0 : count / total };
}

export function activeKeyCounts(keys: ApiKey[]): {
  active: number;
  revoked: number;
} {
  const revoked = keys.filter((key) => key.revokedAt).length;
  return { active: keys.length - revoked, revoked };
}

export interface DailyServiceTotals {
  date: string;
  totals: Record<string, number>;
}

/** Groups rows by day, summing counts per service across all keys. */
export function dailyTotalsByService(rows: UsageSummary[]): DailyServiceTotals[] {
  const byDate = new Map<string, Record<string, number>>();

  for (const row of rows) {
    const bucket = byDate.get(row.date) ?? {};
    bucket[row.service] = (bucket[row.service] ?? 0) + row.count;
    byDate.set(row.date, bucket);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, totals]) => ({ date, totals }));
}
