type Props = {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  action?: { label: string; href: string };
};

// Severity is carried by an icon and wording as well as colour, so it survives
// for anyone who cannot distinguish the hues.
const TONE = {
  critical: { border: 'border-state-danger/30', bg: 'bg-state-danger/5', text: 'text-state-danger', glyph: '!' },
  warning: { border: 'border-state-warning/30', bg: 'bg-state-warning/5', text: 'text-state-warning', glyph: '!' },
  info: { border: 'border-state-info/30', bg: 'bg-state-info/5', text: 'text-state-info', glyph: 'i' },
} as const;

export function AlertCard({ severity, title, description, action }: Props) {
  const tone = TONE[severity];

  return (
    <div className={`flex flex-wrap items-start gap-3 rounded-xl border ${tone.border} ${tone.bg} p-4`}>
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${tone.border} text-xs font-semibold ${tone.text}`}
      >
        {tone.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
      </div>
      {action ? (
        <a
          href={action.href}
          className={`shrink-0 rounded-lg border ${tone.border} px-3 py-1.5 text-sm font-medium ${tone.text}`}
        >
          {action.label}
        </a>
      ) : null}
    </div>
  );
}
