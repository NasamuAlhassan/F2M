import type { ReactNode } from 'react';

// Paper-terminal design system (D-020). Component APIs are frozen — pages and
// future surfaces (driver portal, notifications, IVR tester) share this pass.

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mb-4 border-2 border-ink bg-paper">
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-ink px-3 py-2">
          {title && <h2 className="text-[11px] font-bold uppercase tracking-widest">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

// Flat square chips. Four variants that survive full sunlight:
// done-good = inverse ink, live = bordered ink, attention = bordered warn,
// failed = bordered err, dead = bordered gray.
const DONE = new Set(['SETTLED', 'PAID', 'DELIVERED', 'fulfilled', 'accepted', 'settled', 'sent', 'completed']);
const FAILED = new Set(['FUNDING_FAILED', 'CANCELLED', 'CANCELLED_REFUNDED', 'failed', 'cancelled', 'NO_DRIVER']);
const DEAD = new Set(['DECLINED', 'EXPIRED', 'declined', 'expired', 'withdrawn', 'superseded']);
const ATTENTION = new Set(['OFFERED', 'DISPUTED', 'REQUESTED', 'open', 'offered', 'pending', 'partially_matched', 'disputed']);

export function StateBadge({ state }: { state: string }) {
  const cls = DONE.has(state)
    ? 'bg-ink text-paper border-ink'
    : FAILED.has(state)
      ? 'border-err text-err'
      : DEAD.has(state)
        ? 'border-ink-soft text-ink-soft'
        : ATTENTION.has(state)
          ? 'border-warn text-warn'
          : 'border-ink text-ink';
  return (
    <span className={`inline-block border px-2 py-0.5 font-mono text-[11px] font-bold uppercase ${cls}`}>
      {state.replaceAll('_', ' ')}
    </span>
  );
}

export function Bar({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 uppercase tracking-wide text-[10px] text-ink-soft">{label}</span>
      <div className="h-3 w-24 border border-ink bg-paper">
        <div className="h-full bg-ink" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="font-mono tabular-nums">{value.toFixed(2)}</span>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'w-full border border-ink bg-paper px-3 py-2.5 text-sm focus:outline-2 focus:outline-accent min-h-11';
export const btnCls =
  'min-h-11 border-2 border-accent bg-accent px-4 py-2 text-sm font-bold uppercase tracking-wide text-white hover:bg-paper hover:text-accent disabled:pointer-events-none disabled:opacity-40';
export const btnGhostCls =
  'min-h-11 border-2 border-ink bg-paper px-4 py-2 text-sm font-bold uppercase tracking-wide hover:bg-ink hover:text-paper disabled:pointer-events-none disabled:opacity-40';

// Dense bordered tables — the ledger look.
export const tableCls = 'w-full border-collapse border-2 border-ink text-sm';
export const thCls =
  'border border-ink bg-ink px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-paper';
export const tdCls = 'border border-ink px-2 py-1.5 align-top';
export const numCls = 'font-mono tabular-nums';
