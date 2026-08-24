import type { ReactNode } from 'react';

// The Trade Instrument design system (D-039, seed 222cf785). Component APIs
// frozen through the redesign — this file is the skin, pages are the layout.

/** A framed certificate panel with a ledger-rule title. */
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

// Every state is a stamped ticket. Families share an ink: settled money is
// intaglio green, live states burn gold, refusals and disputes are oxide red,
// dormant states fade into the ramp.
const STATE_STYLE: Record<string, { tone: 'ink' | 'gold' | 'red' | 'faded'; label?: string; live?: boolean }> = {
  // contracts
  OFFERED: { tone: 'gold', live: true },
  ACCEPTED: { tone: 'gold' },
  FUNDS_HELD: { tone: 'gold', label: 'Escrow Held' },
  PICKUP_CONFIRMED: { tone: 'gold', label: 'Picked Up' },
  GRADED: { tone: 'ink' },
  DISPUTED: { tone: 'red' },
  SETTLED: { tone: 'ink' },
  DECLINED: { tone: 'faded' },
  EXPIRED: { tone: 'faded' },
  CANCELLED: { tone: 'red' },
  CANCELLED_REFUNDED: { tone: 'red', label: 'Refunded' },
  FUNDING_FAILED: { tone: 'red' },
  // delivery jobs
  REQUESTED: { tone: 'gold', live: true },
  NO_DRIVER: { tone: 'red' },
  ASSIGNED: { tone: 'gold' },
  PICKED_UP: { tone: 'gold', label: 'En Route' },
  DELIVERED: { tone: 'ink' },
  PAID: { tone: 'ink' },
  // demands / matches / payments / gradings / notifications
  open: { tone: 'gold', live: true },
  partially_matched: { tone: 'gold', label: 'Partly Matched' },
  fulfilled: { tone: 'ink' },
  offered: { tone: 'gold' },
  accepted: { tone: 'ink' },
  declined: { tone: 'faded' },
  expired: { tone: 'faded' },
  superseded: { tone: 'faded' },
  withdrawn: { tone: 'faded' },
  pending: { tone: 'gold', live: true },
  successful: { tone: 'ink' },
  failed: { tone: 'red' },
  completed: { tone: 'ink' },
  resolved: { tone: 'ink' },
  disputed: { tone: 'red' },
  sent: { tone: 'ink' },
  delivered: { tone: 'ink' },
  placing: { tone: 'gold', live: true },
  in_progress: { tone: 'gold' },
  no_answer: { tone: 'faded' },
  cancelled: { tone: 'red' },
  registered: { tone: 'gold', label: 'Listed', live: true },
  matched: { tone: 'gold' },
};

const TONE_CLS: Record<'ink' | 'gold' | 'red' | 'faded', string> = {
  ink: 'text-[var(--ink)] bg-[var(--paper)]',
  gold: 'text-[var(--gold-ink)] bg-[var(--gold-wash)]',
  red: 'text-[var(--stamp-deep)] bg-[var(--stamp-wash)]',
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

/** A/B/C/REJECT as an engraved grade seal — double ring, engraved letter. */
export function GradeBadge({ grade }: { grade: string }) {
  const tone =
    grade === 'A'
      ? 'text-[var(--ink)]'
      : grade === 'B'
        ? 'text-[var(--gold-deep)]'
        : grade === 'C'
          ? 'text-[var(--stamp)]'
          : 'text-[var(--paper)]';
  const fill = grade === 'REJECT' ? 'bg-[var(--ink)]' : 'bg-[var(--paper)]';
  const ring =
    grade === 'REJECT'
      ? 'shadow-[inset_0_0_0_2px_var(--ink),inset_0_0_0_3px_var(--paper)]'
      : 'shadow-[inset_0_0_0_2px_var(--paper),inset_0_0_0_3px_currentColor]';
  return (
    <span
      className={`display inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-[1.5px] border-current text-[11px] font-bold ${tone} ${fill} ${ring}`}
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

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="smallcaps mb-1.5 block text-[var(--ink-6)]">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'w-full rounded-[2px] border border-[var(--ink-3)] bg-[var(--paper-lift)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--ink-6)] focus:outline-none';
export const btnCls =
  'rounded-[2px] bg-[var(--ink)] px-4 py-2 text-sm font-semibold tracking-[0.02em] text-[var(--paper)] transition-colors hover:bg-[var(--ink-8)] disabled:cursor-not-allowed disabled:opacity-40';
export const btnGhostCls =
  'rounded-[2px] border border-[var(--ink-5)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--paper-deep)] disabled:opacity-40';

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
