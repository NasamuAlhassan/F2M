import type { ReactNode } from 'react';
import { Glyph } from './engrave';

// The market redesign — photo-led, warm, not paper. Component APIs stay
// frozen through the change (same discipline as D-028→D-030→D-039): this
// file is the skin, pages are the layout, and most of it below needed no
// edits at all — the token rename in index.css did the reskin for free.

/** A raised white card with a soft shadow. */
export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="certificate mb-4 bg-[var(--paper-lift)] p-4">
      {(title || actions) && (
        <div className="rule-double relative mb-3 flex flex-wrap items-center justify-between gap-2 pb-2">
          {title && <h2 className="smallcaps text-[var(--ink-6)]">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

// Six tones instead of the paper world's four: "ink" used to double as
// every positive/final state because ink WAS the brand green — now that
// --ink is a neutral charcoal ramp (not the brand color), positive states
// need their own real green, and the richer state vocabulary (assigned vs.
// en route vs. escrow-held vs. settled) is worth telling apart at a glance.
const STATE_STYLE: Record<
  string,
  { tone: 'gold' | 'info' | 'transit' | 'success' | 'alert' | 'faded'; label?: string; live?: boolean }
> = {
  // contracts
  OFFERED: { tone: 'gold', live: true },
  ACCEPTED: { tone: 'info' },
  FUNDS_HELD: { tone: 'gold', label: 'Escrow Held' },
  PICKUP_CONFIRMED: { tone: 'transit', label: 'Picked Up' },
  GRADED: { tone: 'info' },
  DISPUTED: { tone: 'alert' },
  SETTLED: { tone: 'success' },
  DECLINED: { tone: 'faded' },
  EXPIRED: { tone: 'faded' },
  CANCELLED: { tone: 'alert' },
  CANCELLED_REFUNDED: { tone: 'alert', label: 'Refunded' },
  FUNDING_FAILED: { tone: 'alert' },
  // delivery jobs
  REQUESTED: { tone: 'gold', live: true },
  NO_DRIVER: { tone: 'alert' },
  ASSIGNED: { tone: 'info' },
  PICKED_UP: { tone: 'transit', label: 'En Route' },
  DELIVERED: { tone: 'success' },
  PAID: { tone: 'success' },
  // demands / matches / payments / gradings / notifications
  open: { tone: 'gold', live: true },
  partially_matched: { tone: 'info', label: 'Partly Matched' },
  fulfilled: { tone: 'success' },
  offered: { tone: 'gold' },
  accepted: { tone: 'success' },
  declined: { tone: 'faded' },
  expired: { tone: 'faded' },
  superseded: { tone: 'faded' },
  withdrawn: { tone: 'faded' },
  pending: { tone: 'gold', live: true },
  successful: { tone: 'success' },
  failed: { tone: 'alert' },
  completed: { tone: 'success' },
  resolved: { tone: 'success' },
  disputed: { tone: 'alert' },
  sent: { tone: 'success' },
  delivered: { tone: 'success' },
  placing: { tone: 'gold', live: true },
  in_progress: { tone: 'info' },
  no_answer: { tone: 'faded' },
  cancelled: { tone: 'alert' },
  registered: { tone: 'gold', label: 'Listed', live: true },
  matched: { tone: 'gold' },
};

const TONE_CLS: Record<'gold' | 'info' | 'transit' | 'success' | 'alert' | 'faded', string> = {
  gold: 'text-[var(--gold-ink)] bg-[var(--gold-wash)]',
  info: 'text-[var(--info)] bg-[var(--info-wash)]',
  transit: 'text-[var(--transit)] bg-[var(--transit-wash)]',
  success: 'text-[var(--success)] bg-[var(--success-wash)]',
  alert: 'text-[var(--stamp-deep)] bg-[var(--stamp-wash)]',
  faded: 'text-[var(--ink-6)] bg-[var(--paper)]',
};

export function StateBadge({ state }: { state: string }) {
  const style = STATE_STYLE[state] ?? { tone: 'faded' as const };
  return (
    <span
      className={`stamp inline-flex items-center gap-1.5 px-1.5 py-0.5 text-[11px] leading-4 ${TONE_CLS[style.tone]}`}
    >
      {style.live && <span className="ember inline-block h-1.5 w-1.5 rounded-full bg-current" />}
      {style.label ?? state.replaceAll('_', ' ')}
    </span>
  );
}

/** A/B/C/REJECT as a solid-filled grade seal — a small stamp of color, not an outline. */
export function GradeBadge({ grade }: { grade: string }) {
  const fill =
    grade === 'A'
      ? 'bg-[var(--forest)]'
      : grade === 'B'
        ? 'bg-[var(--gold-deep)]'
        : grade === 'C'
          ? 'bg-[var(--stamp)]'
          : 'bg-[var(--ink)]';
  return (
    <span
      className={`display inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-[var(--paper)] shadow-sm ${fill}`}
      aria-label={`Grade ${grade}`}
    >
      {grade === 'REJECT' ? 'R' : grade}
    </span>
  );
}

/** Engraved meter: hairline track, solid ink fill, typed value. */
export function Bar({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="smallcaps w-24 shrink-0 text-[var(--ink-6)]">{label}</span>
      <div className="h-[7px] w-24 border border-[var(--ink-3)] bg-[var(--paper)] p-[1.5px]">
        <div className="h-full bg-[var(--ink)]" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="serial text-[var(--ink-7)]">{value.toFixed(2)}</span>
    </div>
  );
}

/**
 * A labelled control. Pass `group` when the label covers more than one control
 * — an implicit <label> only ever binds its FIRST labelable descendant, so a
 * quantity input beside its unit select left the select anonymous, and a label
 * wrapping only <button>s (not labelable at all) named nothing whatsoever.
 */
export function Field({ label, children, group = false }: { label: string; children: ReactNode; group?: boolean }) {
  const inner = (
    <>
      <span className="smallcaps mb-1.5 block text-[var(--ink-6)]">{label}</span>
      {children}
    </>
  );
  if (group) {
    return (
      <div role="group" aria-label={label} className="block text-sm">
        {inner}
      </div>
    );
  }
  return <label className="block text-sm">{inner}</label>;
}

// text-base below sm: a 16px input is the line iOS Safari respects — smaller
// zooms the whole page on focus. Rounded-xl/full instead of the paper
// world's 2px-max square corners — the other clearest "not paper" signal
// alongside the card shadow.
export const inputCls =
  'w-full rounded-xl border border-[var(--ink-3)] bg-[var(--paper-lift)] px-3 py-2 text-base text-[var(--ink)] focus:border-[var(--ink-6)] focus:outline-none sm:text-sm';
export const btnCls =
  'min-h-11 rounded-full bg-[var(--forest)] px-4 py-2 text-sm font-semibold tracking-[0.02em] text-[var(--paper)] shadow-sm transition-colors hover:bg-[var(--forest-deep)] disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-0';
export const btnGhostCls =
  'min-h-11 rounded-full border border-[var(--ink-5)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--paper-deep)] disabled:opacity-40 lg:min-h-0';

/**
 * A dismissible error, stamped in oxide. role="alert" announces it to screen
 * readers the moment it appears; the cross is the dismiss control, so the
 * message itself stays selectable and copyable.
 */
export function ErrorStamp({ message, onDismiss, className = '' }: { message: string; onDismiss: () => void; className?: string }) {
  return (
    // Dismissal lives on the cross alone. Click-anywhere-to-dismiss meant that
    // selecting the error text to copy it made the message vanish mid-drag —
    // exactly when someone is trying to report what went wrong.
    <div
      role="alert"
      className={`stamp flex items-center justify-between gap-3 px-3 py-2 text-[11px] text-[var(--stamp)] ${className}`}
    >
      <span>{message}</span>
      <button
        type="button"
        aria-label="Dismiss error"
        className="-m-2 flex-shrink-0 cursor-pointer p-2 transition-colors hover:text-[var(--stamp-deep)]"
        onClick={onDismiss}
      >
        <Glyph name="cross" className="h-3 w-3" />
      </button>
    </div>
  );
}

/**
 * The gap between "still loading" and "gave up". `if (!data) return 'Loading…'`
 * cannot tell them apart, so a 404 from a stale link — or any exhausted retry —
 * used to spin forever with no way back. Pages hand this their query's flags and
 * get an honest dead end with a retry instead.
 */
export function LoadGate({
  isError,
  onRetry,
  label = 'this page',
}: {
  isError: boolean;
  onRetry: () => void;
  label?: string;
}) {
  if (!isError) return <p className="text-sm text-[var(--ink-6)]">Loading…</p>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-[var(--ink-6)]">Could not load {label}.</p>
      <button type="button" className={btnGhostCls} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

/**
 * Wide ledgers scroll inside their own frame on narrow paper — the page canvas
 * never scrolls sideways. minWidth keeps the columns breathing room instead of
 * letting w-full crush them into the viewport.
 */
export function TableScroll({ children, minWidth }: { children: ReactNode; minWidth: number }) {
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }}>{children}</div>
    </div>
  );
}

// Ledger tables: tracked capital column heads over a double rule, hairline rows.
export const tableCls = 'w-full text-left text-sm text-[var(--ink)]';
export const thCls = 'rule-double smallcaps px-3 py-2.5 text-left text-[var(--ink-6)]';
export const tdCls = 'px-3 py-2.5 align-middle border-b border-[var(--ink-2)]';
export const numCls = 'serial';

// Selectable ledger rows (filters, route lists).
export const rowOnCls = 'bg-[var(--gold-wash)] font-semibold text-[var(--ink)]';
export const rowOffCls = 'text-[var(--ink-6)] hover:bg-[var(--paper-deep)]';

/** Typed figure with a tracked caption — the instrument's stat idiom. */
export function Stat({ value, caption, accent }: { value: ReactNode; caption: string; accent?: boolean }) {
  return (
    <div className="text-center">
      <div className={`serial text-lg font-bold ${accent ? 'text-[var(--gold-deep)]' : 'text-[var(--ink)]'}`}>{value}</div>
      <div className="smallcaps text-[var(--ink-6)]">{caption}</div>
    </div>
  );
}
