'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { serviceLabel } from '@/lib/service-labels';
import {
  activeKeyCounts,
  callsOnDate,
  dailyTotalsByService,
  filterByRange,
  mostUsedService,
  totalCalls,
  type RangeDays,
} from '@/lib/usage-stats';
import {
  Activity,
  Filter,
  Gauge,
  KeyRound,
  LineChart,
  RefreshCw,
  TrendingUp,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { CallsChart } from './calls-chart';

const RANGES: RangeDays[] = [7, 30, 90];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
      <span className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-fg-3">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="font-display text-2xl font-semibold text-fg">
        {value}
      </span>
      {hint && <span className="text-xs text-fg-3">{hint}</span>}
    </div>
  );
}

function RangeTabs({
  range,
  onChange,
}: {
  range: RangeDays;
  onChange: (range: RangeDays) => void;
}) {
  return (
    <div className="flex shrink-0 gap-1 rounded-lg border border-border bg-surface p-1">
      {RANGES.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`rounded-md px-3 py-1 text-xs font-medium ${
            range === r ? 'bg-accent-soft text-accent' : 'text-fg-2 hover:text-fg'
          }`}
        >
          {r}d
        </button>
      ))}
    </div>
  );
}

function UsageLoadingState() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5"
          >
            <span className="h-3 w-20 animate-pulse rounded bg-surface-2" />
            <span className="h-7 w-16 animate-pulse rounded bg-surface-2" />
          </div>
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl border border-border bg-surface" />
    </div>
  );
}

function UsageErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-danger-soft text-danger">
        <TriangleAlert className="h-5 w-5" />
      </span>
      <h2 className="text-base font-semibold text-fg">
        Couldn&apos;t load usage
      </h2>
      <p className="max-w-sm text-sm text-fg-2">
        The usage service didn&apos;t respond. Try again in a moment.
      </p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}

function UsageEmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface px-6 py-16 text-center">
      <h2 className="text-base font-semibold text-fg">
        No usage recorded yet
      </h2>
      <p className="max-w-sm text-sm text-fg-2">
        Once a key is used to call a Neuron service, calls will show up here.
      </p>
    </div>
  );
}

export default function UsagePage() {
  const [range, setRange] = useState<RangeDays>(30);
  const [serviceFilter, setServiceFilter] = useState<string | null>(null);

  const usageQuery = useQuery({ queryKey: ['usage'], queryFn: api.getUsage });
  const keysQuery = useQuery({ queryKey: ['api-keys'], queryFn: api.listApiKeys });

  const rows = useMemo(
    () => (usageQuery.data ? filterByRange(usageQuery.data, range) : []),
    [usageQuery.data, range],
  );

  const dailyTotals = useMemo(() => dailyTotalsByService(rows), [rows]);
  const services = useMemo(
    () => [...new Set(rows.map((row) => row.service))].sort(),
    [rows],
  );
  const topService = useMemo(() => mostUsedService(rows), [rows]);
  const { active, revoked } = activeKeyCounts(keysQuery.data ?? []);

  const breakdownRows = useMemo(
    () =>
      rows
        .filter((row) => !serviceFilter || row.service === serviceFilter)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [rows, serviceFilter],
  );

  const isLoading = usageQuery.status === 'pending';
  const isError = usageQuery.status === 'error';
  const isEmpty = usageQuery.status === 'success' && rows.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[22px] font-semibold tracking-tight text-fg">
            Usage
          </h1>
          <p className="mt-1 text-sm text-fg-2">
            Calls counted at the edge, aggregated hourly. UTC.
          </p>
        </div>
        <RangeTabs range={range} onChange={setRange} />
      </div>

      {isLoading && <UsageLoadingState />}
      {isError && <UsageErrorState onRetry={() => void usageQuery.refetch()} />}

      {!isLoading &&
        !isError &&
        (isEmpty ? (
          <UsageEmptyState />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard
                icon={Activity}
                label="TOTAL CALLS"
                value={totalCalls(rows).toLocaleString()}
                hint={`Last ${range} days`}
              />
              <StatCard
                icon={Zap}
                label="CALLS TODAY"
                value={callsOnDate(rows, todayIso()).toLocaleString()}
                hint="So far, UTC"
              />
              <StatCard
                icon={KeyRound}
                label="ACTIVE KEYS"
                value={String(active)}
                hint={`${revoked} revoked`}
              />
              <StatCard
                icon={TrendingUp}
                label="MOST-USED SERVICE"
                value={topService ? serviceLabel(topService.service) : '—'}
                hint={
                  topService
                    ? `${Math.round(topService.share * 100)}% of all calls`
                    : undefined
                }
              />
            </div>

            <div className="rounded-xl border border-border bg-surface p-5">
              <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-fg">
                <LineChart className="h-4 w-4 text-fg-3" />
                Calls over time
              </h2>
              <p className="mb-4 text-xs text-fg-3">
                Daily totals per service · last {range} days
              </p>
              <CallsChart data={dailyTotals} services={services} />
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                    <Gauge className="h-4 w-4 text-fg-3" />
                    Breakdown
                  </h2>
                  <p className="text-xs text-fg-3">
                    Daily counts per service and key.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border p-1">
                  <Filter className="ml-1.5 h-3.5 w-3.5 text-fg-3" />
                  <button
                    onClick={() => setServiceFilter(null)}
                    className={`rounded-md px-3 py-1 text-xs font-medium ${
                      !serviceFilter
                        ? 'bg-accent-soft text-accent'
                        : 'text-fg-2 hover:text-fg'
                    }`}
                  >
                    All services
                  </button>
                  {services.map((service) => (
                    <button
                      key={service}
                      onClick={() => setServiceFilter(service)}
                      className={`rounded-md px-3 py-1 text-xs font-medium ${
                        serviceFilter === service
                          ? 'bg-accent-soft text-accent'
                          : 'text-fg-2 hover:text-fg'
                      }`}
                    >
                      {serviceLabel(service)}
                    </button>
                  ))}
                </div>
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs font-medium tracking-wide text-fg-3">
                    <th className="px-5 py-3 font-medium">SERVICE</th>
                    <th className="px-5 py-3 font-medium">KEY</th>
                    <th className="px-5 py-3 font-medium">DATE</th>
                    <th className="px-5 py-3 text-right font-medium">CALLS</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdownRows.map((row) => (
                    <tr
                      key={`${row.date}-${row.service}-${row.apiKeyId}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-5 py-3 text-fg">
                        {serviceLabel(row.service)}
                      </td>
                      <td className="px-5 py-3 font-mono text-fg-3">
                        {row.apiKeyId.slice(0, 8)}…
                      </td>
                      <td className="px-5 py-3 text-fg-2">{row.date}</td>
                      <td className="px-5 py-3 text-right text-fg">
                        {row.count.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ))}
    </div>
  );
}
