type Metric =
  | { available: true; value: number; unit: string; syncedAt: string | null; limit?: number | null }
  | { available: false; reason: string; limit?: number | null };

const LABELS: Record<string, string> = {
  websites: 'Websites',
  domains: 'Domains',
  storage: 'Storage',
  databases: 'Databases',
  mailboxes: 'Mailboxes',
};

/**
 * Renders a metric, or says plainly that it is unavailable.
 *
 * An unavailable metric never falls back to zero or a dash: a confident "0 GB
 * used" is worse than "Not available", because the customer believes it.
 */
export function UsageMeter({ name, metric }: { name: string; metric: Metric }) {
  const label = LABELS[name] ?? name;

  if (!metric.available) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm">{label}</span>
          <span className="text-sm text-ink-subtle">Not available</span>
        </div>
        <p className="mt-0.5 text-xs text-ink-subtle">{metric.reason}</p>
      </div>
    );
  }

  const limit = metric.limit ?? null;
  const percent = limit && limit > 0 ? Math.min(100, Math.round((metric.value / limit) * 100)) : null;
  const tone =
    percent === null
      ? 'bg-primary'
      : percent >= 95
        ? 'bg-state-danger'
        : percent >= 80
          ? 'bg-state-warning'
          : 'bg-primary';

  const display = metric.unit === 'count' ? `${metric.value}` : `${metric.value} ${metric.unit}`;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm">{label}</span>
        <span className="text-sm tabular-nums text-ink-muted">
          {display}
          {limit !== null ? ` of ${limit}${metric.unit === 'count' ? '' : ` ${metric.unit}`}` : ''}
        </span>
      </div>
      {percent !== null ? (
        <div
          className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-canvas"
          role="progressbar"
          aria-label={`${label} usage`}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </div>
  );
}
