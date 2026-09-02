import { serviceLabel } from '@/lib/service-labels';
import type { DailyServiceTotals } from '@/lib/usage-stats';

const CHART_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
];
const WIDTH = 720;
const HEIGHT = 220;
const PADDING = { top: 10, right: 10, bottom: 24, left: 10 };
const MAX_TICKS = 5;

function pickTickIndexes(length: number): number[] {
  if (length <= 1) return [0];
  const count = Math.min(MAX_TICKS, length);
  const step = (length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(i * step));
}

function formatTickLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  });
}

export function CallsChart({
  data,
  services,
}: {
  data: DailyServiceTotals[];
  services: string[];
}) {
  if (data.length === 0 || services.length === 0) return null;

  const max = Math.max(1, ...data.flatMap((d) => services.map((s) => d.totals[s] ?? 0)));
  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const xForIndex = (i: number) =>
    PADDING.left +
    (data.length === 1 ? innerWidth / 2 : (i / (data.length - 1)) * innerWidth);
  const yForValue = (value: number) =>
    PADDING.top + innerHeight - (value / max) * innerHeight;

  const tickIndexes = pickTickIndexes(data.length);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        {services.map((service, i) => (
          <span
            key={service}
            className="flex items-center gap-1.5 text-xs text-fg-2"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
            />
            {serviceLabel(service)}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label="Calls over time, by service"
      >
        <line
          x1={PADDING.left}
          y1={yForValue(0)}
          x2={WIDTH - PADDING.right}
          y2={yForValue(0)}
          className="stroke-border"
          strokeWidth={1}
        />

        {services.map((service, i) => {
          const color = CHART_COLORS[i % CHART_COLORS.length];
          const points = data
            .map((d, idx) => `${xForIndex(idx)},${yForValue(d.totals[service] ?? 0)}`)
            .join(' ');
          return (
            <g key={service}>
              <polyline
                points={points}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {data.map((d, idx) => (
                <circle
                  key={idx}
                  cx={xForIndex(idx)}
                  cy={yForValue(d.totals[service] ?? 0)}
                  r={data.length === 1 ? 4 : 2.5}
                  fill={color}
                />
              ))}
            </g>
          );
        })}

        {tickIndexes.map((idx) => (
          <text
            key={idx}
            x={xForIndex(idx)}
            y={HEIGHT - 6}
            textAnchor="middle"
            fontSize={10}
            className="fill-fg-3"
          >
            {formatTickLabel(data[idx].date)}
          </text>
        ))}
      </svg>
    </div>
  );
}
