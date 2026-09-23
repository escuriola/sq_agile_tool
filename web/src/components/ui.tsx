import { useEffect, type ReactNode } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        'rounded-xl border border-[var(--color-ink-800)] bg-[var(--color-ink-900)]/70 backdrop-blur',
        className
      )}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-ink-800)] px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-300">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}) {
  const variants = {
    default:
      'bg-[var(--color-ink-800)] hover:bg-[var(--color-ink-700)] text-slate-200 border border-[var(--color-ink-700)]',
    primary: 'bg-sky-600 hover:bg-sky-500 text-white border border-sky-500',
    ghost: 'hover:bg-[var(--color-ink-800)] text-slate-400 hover:text-slate-200 border border-transparent',
    danger:
      'bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 border border-rose-900/70',
  };
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        variants[variant],
        className
      )}
    />
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-600">{hint}</span>}
    </label>
  );
}

export function Badge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color, backgroundColor: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}33` }}
    >
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8">
      <div
        className={cx(
          'w-full rounded-xl border border-[var(--color-ink-700)] bg-[var(--color-ink-850)] shadow-2xl',
          wide ? 'max-w-3xl' : 'max-w-lg'
        )}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-ink-800)] px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  const tones = {
    default: 'text-slate-100',
    good: 'text-emerald-400',
    warn: 'text-amber-400',
    bad: 'text-rose-400',
  };
  return (
    <div className="rounded-xl border border-[var(--color-ink-800)] bg-[var(--color-ink-900)]/70 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold', tones[tone])}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-ink-700)] px-4 py-8 text-center text-sm text-slate-600">
      {children}
    </div>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="rounded-md border border-rose-900/70 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}
