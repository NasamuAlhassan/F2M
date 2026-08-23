import type { ReactNode } from 'react';

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mb-5 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const STATE_COLORS: Record<string, string> = {
  OFFERED: 'bg-amber-100 text-amber-900',
  ACCEPTED: 'bg-sky-100 text-sky-900',
  FUNDS_HELD: 'bg-indigo-100 text-indigo-900',
  PICKUP_CONFIRMED: 'bg-violet-100 text-violet-900',
  GRADED: 'bg-teal-100 text-teal-900',
  DISPUTED: 'bg-orange-100 text-orange-900',
  SETTLED: 'bg-green-100 text-green-900',
  DECLINED: 'bg-stone-200 text-stone-700',
  EXPIRED: 'bg-stone-200 text-stone-700',
  CANCELLED: 'bg-red-100 text-red-900',
  CANCELLED_REFUNDED: 'bg-red-100 text-red-900',
  FUNDING_FAILED: 'bg-red-100 text-red-900',
  open: 'bg-amber-100 text-amber-900',
  partially_matched: 'bg-sky-100 text-sky-900',
  fulfilled: 'bg-green-100 text-green-900',
  offered: 'bg-amber-100 text-amber-900',
  accepted: 'bg-green-100 text-green-900',
  declined: 'bg-stone-200 text-stone-700',
  expired: 'bg-stone-200 text-stone-700',
};

export function StateBadge({ state }: { state: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE_COLORS[state] ?? 'bg-stone-200'}`}>
      {state.replaceAll('_', ' ')}
    </span>
  );
}

export function Bar({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-stone-500">{label}</span>
      <div className="h-1.5 w-24 overflow-hidden rounded bg-stone-200">
        <div className="h-full rounded bg-green-600" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="tabular-nums text-stone-600">{value.toFixed(2)}</span>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-stone-600">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'w-full rounded border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-green-600 focus:outline-none';
export const btnCls = 'rounded bg-green-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50';
export const btnGhostCls = 'rounded border border-stone-300 px-3 py-1.5 text-sm font-medium hover:bg-stone-100';
