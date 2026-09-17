/**
 * Status as a word plus a colour, never a colour alone — a red dot means nothing
 * to anyone reading this without colour vision, and "SUSPENDED" is the part that
 * matters anyway.
 */
const TONE: Record<string, string> = {
  ACTIVE: 'border-state-success/30 bg-state-success/5 text-state-success',
  PAID: 'border-state-success/30 bg-state-success/5 text-state-success',
  ISSUED: 'border-state-info/30 bg-state-info/5 text-state-info',
  PENDING_VERIFICATION: 'border-state-warning/30 bg-state-warning/5 text-state-warning',
  DRAFT: 'border-line-strong bg-canvas text-ink-muted',
  WITHDRAWN: 'border-line-strong bg-canvas text-ink-muted',
  CANCELLED: 'border-line-strong bg-canvas text-ink-muted',
  PAST_DUE: 'border-state-warning/30 bg-state-warning/5 text-state-warning',
  EXPIRED: 'border-state-danger/30 bg-state-danger/5 text-state-danger',
  SUSPENDED: 'border-state-warning/30 bg-state-warning/5 text-state-warning',
  TERMINATED: 'border-state-danger/30 bg-state-danger/5 text-state-danger',
  VOID: 'border-state-danger/30 bg-state-danger/5 text-state-danger',
  DISABLED: 'border-state-danger/30 bg-state-danger/5 text-state-danger',
  ERROR: 'border-state-danger/30 bg-state-danger/5 text-state-danger',
};

export function StatusBadge({ status }: { status: string }) {
  const tone = TONE[status] ?? 'border-line-strong bg-canvas text-ink-muted';

  return (
    <span className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}
