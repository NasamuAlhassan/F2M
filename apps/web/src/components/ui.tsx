import type { ReactNode } from 'react';

// Design system per the user's Figma prototype (D-030). Component APIs frozen.

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mb-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-400">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

// Pill badges in the prototype's palette: bordered soft-tint pills, tiny bold uppercase.
const STATE_STYLE: Record<string, { cls: string; label?: string; pulse?: boolean }> = {
  // contracts
  OFFERED: { cls: 'bg-amber-50 text-amber-800 border-amber-300', pulse: true },
  ACCEPTED: { cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  FUNDS_HELD: { cls: 'bg-yellow-50 text-yellow-800 border-yellow-300', label: 'Escrow Held' },
  PICKUP_CONFIRMED: { cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  GRADED: { cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  DISPUTED: { cls: 'bg-orange-50 text-orange-700 border-orange-300' },
  SETTLED: { cls: 'bg-green-50 text-green-700 border-green-300' },
  DECLINED: { cls: 'bg-gray-100 text-gray-600 border-gray-300' },
  EXPIRED: { cls: 'bg-gray-100 text-gray-600 border-gray-300' },
  CANCELLED: { cls: 'bg-red-50 text-red-700 border-red-300' },
  CANCELLED_REFUNDED: { cls: 'bg-red-50 text-red-700 border-red-300', label: 'Refunded' },
  FUNDING_FAILED: { cls: 'bg-red-50 text-red-700 border-red-300' },
  // delivery jobs
  REQUESTED: { cls: 'bg-amber-50 text-amber-800 border-amber-300', pulse: true },
  NO_DRIVER: { cls: 'bg-red-50 text-red-700 border-red-300' },
  ASSIGNED: { cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  PICKED_UP: { cls: 'bg-violet-50 text-violet-700 border-violet-200', label: 'En Route' },
  DELIVERED: { cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  PAID: { cls: 'bg-green-50 text-green-700 border-green-300' },
  // demands / matches / payments / gradings / notifications
  open: { cls: 'bg-amber-50 text-amber-800 border-amber-300', pulse: true },
  partially_matched: { cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  fulfilled: { cls: 'bg-green-50 text-green-700 border-green-300' },
  offered: { cls: 'bg-amber-50 text-amber-800 border-amber-300' },
  accepted: { cls: 'bg-green-50 text-green-700 border-green-300' },
  declined: { cls: 'bg-gray-100 text-gray-600 border-gray-300' },
  expired: { cls: 'bg-gray-100 text-gray-600 border-gray-300' },
  superseded: { cls: 'bg-gray-100 text-gray-600 border-gray-300' },
  withdrawn: { cls: 'bg-gray-100 text-gray-600 border-gray-300' },
  pending: { cls: 'bg-amber-50 text-amber-800 border-amber-300', pulse: true },
  successful: { cls: 'bg-green-50 text-green-700 border-green-300' },
  failed: { cls: 'bg-red-50 text-red-700 border-red-300' },
  completed: { cls: 'bg-green-50 text-green-700 border-green-300' },
  resolved: { cls: 'bg-green-50 text-green-700 border-green-300' },
  disputed: { cls: 'bg-orange-50 text-orange-700 border-orange-300' },
  sent: { cls: 'bg-green-50 text-green-700 border-green-300' },
  delivered: { cls: 'bg-green-50 text-green-700 border-green-300' },
  placing: { cls: 'bg-amber-50 text-amber-800 border-amber-300', pulse: true },
  in_progress: { cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  no_answer: { cls: 'bg-gray-100 text-gray-600 border-gray-300' },
  cancelled: { cls: 'bg-red-50 text-red-700 border-red-300' },
};

export function StateBadge({ state }: { state: string }) {
  const style = STATE_STYLE[state] ?? { cls: 'bg-gray-100 text-gray-600 border-gray-300' };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style.cls}`}
    >
      {style.pulse && <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-current" />}
      {style.label ?? state.replaceAll('_', ' ')}
    </span>
  );
}

/** A/B/C/REJECT grade tile — the prototype's solid colored square. */
export function GradeBadge({ grade }: { grade: string }) {
  const map: Record<string, string> = {
    A: 'bg-green-700 text-white',
    B: 'bg-amber-600 text-white',
    C: 'bg-red-600 text-white',
    REJECT: 'bg-gray-800 text-white',
  };
  return (
    <span
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-[11px] font-extrabold ${map[grade] ?? 'bg-gray-400 text-white'}`}
    >
      {grade === 'REJECT' ? 'R' : grade}
    </span>
  );
}

export function Bar({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-gray-400">{label}</span>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-[#1B4332]" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="mono text-gray-600">{value.toFixed(2)}</span>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-gray-400">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4332]';
export const btnCls =
  'rounded-xl bg-[#1B4332] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-green-900 disabled:cursor-not-allowed disabled:opacity-40';
export const btnGhostCls =
  'rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40';

// Selectable list rows (filter checkboxes, route lists): the active state is a
// green tint with brand-green text; the idle state is quiet gray on white.
export const rowOnCls = 'bg-green-50 font-semibold text-[#1B4332]';
export const rowOffCls = 'text-gray-600 hover:bg-gray-100';

// Table helpers — the prototype's gray-50 header band style.
export const tableCls = 'w-full text-left text-sm';
export const thCls = 'bg-gray-50 px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500';
export const tdCls = 'px-4 py-3 align-middle';
export const numCls = 'mono';

// Crop + vehicle iconography from the prototype.
export const CROP_EMOJI: Record<string, string> = {
  MAIZE: '🌽',
  TOMATO: '🍅',
  YAM: '🍠',
  RICE: '🌾',
  GROUNDNUT: '🥜',
  PEPPER: '🌶️',
  ONION: '🧅',
  PLANTAIN: '🍌',
};
export const VEHICLE_EMOJI: Record<string, string> = {
  tricycle: '🛺',
  van: '🚛',
  light_truck: '🚚',
};

/** Big number + tiny caption stat, the prototype's dispatch-board idiom. */
export function Stat({ value, caption, accent }: { value: ReactNode; caption: string; accent?: boolean }) {
  return (
    <div className="text-center">
      <div className={`text-lg font-extrabold ${accent ? 'mono text-[#D97706]' : 'text-gray-800'}`}>{value}</div>
      <div className="text-[10px] text-gray-400">{caption}</div>
    </div>
  );
}
