import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Glyph } from './engrave';

// The market redesign — photo-led, warm, not paper. Component APIs stay
// frozen through the change (same discipline as D-028→D-030→D-039): this
// file is the skin, pages are the layout, and most of it below needed no
// edits at all — the token rename in index.css did the reskin for free.

/**
 * A raised warm-white card. The title is a serif headline; anything after an
 * em dash ("Dispatch Queue — open requests on your routes") becomes the small
 * line under it, so existing titles read as title + subtitle with no call-site edits.
 */
export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  const [head, sub] = title ? title.split(/\s+—\s+/, 2) : [];
  return (
    <section className="certificate mb-5 bg-[var(--paper-lift)] p-5">
      {(title || actions) && (
        <div className="rule-double relative mb-4 flex flex-wrap items-end justify-between gap-2 pb-3">
          {title && (
            <div>
              <h2 className="headline text-xl text-[var(--ink)] sm:text-2xl">{head}</h2>
              {sub && <p className="mt-1 text-xs text-[var(--ink-6)]">{sub.charAt(0).toUpperCase() + sub.slice(1)}</p>}
            </div>
          )}
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
  FUNDS_HELD: { tone: 'gold', label: 'Money held' },
  PICKUP_CONFIRMED: { tone: 'transit', label: 'Collected' },
  GRADED: { tone: 'transit', label: 'On the road' },
  CLAIMED: { tone: 'alert', label: 'Problem reported' },
  RECEIVED: { tone: 'success', label: 'Received' },
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
  PICKED_UP: { tone: 'transit', label: 'On the road' },
  ARRIVED: { tone: 'transit', label: 'Arrived' },
  DELIVERED: { tone: 'success' },
  PAID: { tone: 'success' },
  // demands / matches / payments / gradings / notifications
  open: { tone: 'gold', live: true },
  partially_matched: { tone: 'info', label: 'Partly matched' },
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

/** One case for every chip: "Settled", "Fulfilled", never SETTLED beside fulfilled. */
const sentenceCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function StateBadge({ state }: { state: string }) {
  const style = STATE_STYLE[state] ?? { tone: 'faded' as const };
  return (
    <span
      className={`stamp inline-flex items-center gap-1.5 px-1.5 py-0.5 text-[11px] leading-4 ${TONE_CLS[style.tone]}`}
    >
      {style.live && <span className="ember inline-block h-1.5 w-1.5 rounded-full bg-current" />}
      {sentenceCase(style.label ?? state.replaceAll('_', ' '))}
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
  // The border holds 3:1 against the page (WCAG 1.4.11) and the global
  // focus ring stays on: a field must always show where the typing goes.
  'min-h-11 w-full rounded-xl border border-[var(--field-border)] bg-[var(--paper-lift)] px-3 py-2 text-base text-[var(--ink)] transition-[border-color,box-shadow] hover:border-[var(--ink-7)] focus:border-[var(--forest-night)] aria-[invalid=true]:border-[var(--stamp)] sm:min-h-10 sm:text-sm';

/* ── Pressables ──────────────────────────────────────────────────
   One grammar for everything you can press, so the whole app answers a tap
   the same way:
   - hover (mouse only; Tailwind v4 scopes hover: to hover-capable devices)
     shifts the colour; press sinks pills to 97% and darkens rows;
   - transitions name their properties and run on the "fast" step of the
     motion scale in index.css (the bare transition-* default);
   - `scale` is listed, not `transform`: Tailwind v4's scale-* utilities set
     the `scale` property, so a `transform` transition never eased the sink;
   - disabled fades to 40%, but a button that is waiting on the network sets
     aria-busy and keeps its label at full strength (with a Spinner, see
     BusyLabel). index.css gives it the wait cursor. */
export const btnCls =
  'min-h-11 rounded-full bg-[var(--forest)] px-4 py-2 text-sm font-semibold tracking-[0.01em] text-[var(--paper-lift)] shadow-sm transition-[background-color,scale] not-disabled:hover:bg-[var(--forest-deep)] not-disabled:active:scale-[0.97] not-disabled:active:bg-[var(--forest-deep)] disabled:not-aria-busy:opacity-40 lg:min-h-0';
export const btnGhostCls =
  'min-h-11 rounded-full border border-[var(--ink-4)] bg-[var(--paper-lift)]/40 px-4 py-2 text-sm font-semibold text-[var(--ink)] transition-[background-color,border-color,scale] not-disabled:hover:border-[var(--ink-6)] not-disabled:hover:bg-[var(--paper-deep)] not-disabled:active:scale-[0.97] not-disabled:active:bg-[var(--paper-deep)] disabled:not-aria-busy:opacity-40 lg:min-h-0';
/** Small outlined pill (Open, Matches, Copy link, Call). 44px on phones, 32px on a desk. */
export const pillCls =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-[var(--ink-4)] px-3 text-xs font-semibold text-[var(--ink)] transition-[background-color,border-color,scale] not-disabled:hover:border-[var(--ink-6)] not-disabled:hover:bg-[var(--paper-deep)] not-disabled:active:scale-[0.97] not-disabled:active:bg-[var(--paper-deep)] disabled:not-aria-busy:opacity-40 lg:min-h-8';
/** The filled twin of pillCls, for the one forward action in a row. */
export const pillSolidCls =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-transparent bg-[var(--forest)] px-3 text-xs font-semibold text-[var(--paper-lift)] transition-[background-color,scale] not-disabled:hover:bg-[var(--forest-deep)] not-disabled:active:scale-[0.97] not-disabled:active:bg-[var(--forest-deep)] disabled:not-aria-busy:opacity-40 lg:min-h-8';
/** "Close" on a dark plate header (dialogs, the alert tray, the drawer). */
export const plateBtnCls =
  'stamp inline-flex min-h-11 shrink-0 items-center justify-center px-4 text-[11px] text-[var(--paper-lift)] ring-1 ring-[var(--paper-lift)]/30 transition-[background-color,scale] hover:bg-[var(--forest-deep)] active:scale-[0.97] active:bg-[var(--forest)] lg:min-h-8 lg:px-3';
/** A quiet text button in a bar (Log out, Sign in, Home). */
export const quietBtnCls =
  'inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-medium text-[var(--ink-7)] transition-[background-color,color,scale] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] active:scale-[0.97] active:bg-[var(--paper-deep)] lg:min-h-10';
/** "← Contracts" above a detail page: small capitals, a pill wash on hover and press. */
export const backLinkCls =
  'smallcaps -ml-3 mb-2 inline-flex min-h-11 items-center rounded-full px-3 text-[var(--ink-6)] transition-[background-color,color,scale] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] active:scale-[0.97] active:bg-[var(--paper-deep)] lg:min-h-9';
/** An icon-only round button: the icon can be small, the target never is. Give it an aria-label. */
export const iconBtnCls =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-[background-color,color,scale] hover:bg-[var(--paper-deep)] active:scale-[0.97] active:bg-[var(--paper-deep)]';
/**
 * A text link: always underlined (so it never relies on colour), the line
 * firms up on hover and the text dims a touch on press. No weight or size
 * change, so nothing beside it moves. Set the colour at the call site; add
 * `inline-flex min-h-11 items-center` when it stands on its own line.
 */
export const textLinkCls =
  'underline decoration-current/35 decoration-1 underline-offset-[0.2em] transition-[color,text-decoration-color,opacity] hover:decoration-current active:opacity-70';
/**
 * A bigger invisible target for a small inline control (a link in a dense
 * row) without changing the layout: a pseudo-element 14px above and below,
 * 8px to the sides, so a 16px line becomes a 44px target.
 */
export const hitAreaCls = 'relative before:absolute before:-inset-x-2 before:-inset-y-3.5';
/** A whole row or card that is one link: a soft wash on hover, a deeper one on press. */
export const rowLinkCls = 'transition-colors hover:bg-[var(--paper)] active:bg-[var(--paper-deep)]';
/** One choice in a stacked list (vehicle, language): a rounded row with a gold wash when chosen. */
export function choiceCls(on: boolean): string {
  return `flex min-h-11 w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-[background-color,border-color] ${
    on
      ? 'border-[var(--ink)] bg-[var(--gold-wash)]'
      : 'border-[var(--ink-2)] not-disabled:hover:border-[var(--ink-5)] not-disabled:hover:bg-[var(--paper)] not-disabled:active:bg-[var(--paper-deep)]'
  }`;
}

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
      className={`flex items-center justify-between gap-3 rounded-2xl bg-[var(--stamp-wash)] px-4 py-3 text-sm text-[var(--stamp-deep)] ${className}`}
    >
      <span>{message}</span>
      {/* 44px target; the negative margin keeps the notice as slim as before. */}
      <button
        type="button"
        aria-label="Dismiss error"
        className="-my-3 -mr-3 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full transition-[background-color,scale] hover:bg-[var(--stamp)]/10 active:scale-[0.97] active:bg-[var(--stamp)]/20"
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
  retrying = false,
}: {
  isError: boolean;
  onRetry: () => void;
  label?: string;
  /** The retry is in flight (the query's isFetching): the button says so. */
  retrying?: boolean;
}) {
  if (!isError) return <Skeleton lines={4} label={`Loading ${label}`} />;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-[var(--ink-6)]">Could not load {label}.</p>
      <button type="button" className={btnGhostCls} onClick={onRetry} disabled={retrying} aria-busy={retrying || undefined}>
        <BusyLabel busy={retrying} label="Retry" busyLabel="Retrying…" />
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

// Selectable ledger rows (filters, route lists). No weight change when a row
// is picked: bold text is wider and nudged the row's other content sideways.
export const rowOnCls = 'bg-[var(--gold-wash)] text-[var(--ink)]';
export const rowOffCls = 'text-[var(--ink-6)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] active:bg-[var(--ink-2)]/60';

/** Placeholder bars in the shape of content, shimmering while it loads. */
export function Skeleton({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="skeleton h-4 rounded-full"
          style={{ width: `${[92, 76, 84, 60, 70][i % 5]}%` }}
        />
      ))}
    </div>
  );
}

/**
 * The empty screen as a welcome, not a dead end (D-048): a picture of where
 * you are, one plain sentence, and at most one thing to do next.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center rounded-[20px] border border-dashed border-[var(--ink-2)] bg-[var(--paper-lift)]/60 text-center ${
        compact ? 'gap-2 px-5 py-6' : 'gap-3 px-6 py-10'
      }`}
    >
      {icon && (
        <span
          className={`flex items-center justify-center rounded-full bg-[var(--forest-wash)] text-[var(--forest-deep)] ${
            compact ? 'h-11 w-11' : 'h-14 w-14'
          }`}
        >
          {icon}
        </span>
      )}
      <p className={`headline text-[var(--ink)] ${compact ? 'text-lg' : 'text-xl'}`}>{title}</p>
      {body && <p className="max-w-sm text-sm leading-relaxed text-[var(--ink-6)]">{body}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Good morning / afternoon / evening, by the person's own clock. */
export function partOfDay(d = new Date()): 'morning' | 'afternoon' | 'evening' {
  const h = d.getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

/** The greeting in the person's language. Static keys, so i18n:extract finds all three. */
export function greetingFor(t: (key: string, english: string) => string, d = new Date()): string {
  const p = partOfDay(d);
  if (p === 'morning') return t('web.greeting.morning', 'Good morning');
  if (p === 'afternoon') return t('web.greeting.afternoon', 'Good afternoon');
  return t('web.greeting.evening', 'Good evening');
}

/**
 * The top of every home screen: who you are, what is waiting for you, and the
 * one thing you probably came to do. A returning person should see the
 * unfinished thing first (an offer to answer, a load to pick up).
 */
export function Greeting({
  greeting,
  name,
  summary,
  action,
}: {
  greeting: string;
  name: string;
  summary: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="headline text-4xl text-[var(--ink)] sm:text-5xl">
          {name ? `${greeting}, ${name.split(/\s+/)[0]}` : greeting}
        </h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-[var(--ink-7)]">{summary}</p>
      </div>
      {action}
    </div>
  );
}

/* ── Toasts: the "it worked" moment ─────────────────────────────
   A tiny module-level queue so any mutation can say what just happened
   (`toast('Your maize is on the market')`) without threading context. */
type ToastItem = { id: number; message: string; tone: 'success' | 'info' };
let toastSeq = 0;
const toastListeners = new Set<(t: ToastItem) => void>();
export function toast(message: string, tone: ToastItem['tone'] = 'success'): void {
  const item = { id: ++toastSeq, message, tone };
  toastListeners.forEach((fn) => fn(item));
}

/**
 * Renders into document.body, outside #root, so a toast is still announced
 * while a dialog has made the page inert. A toast stays longer the more it
 * says (4s plus about 1s per 20 characters), waits while the pointer or
 * keyboard focus is on it (WCAG 2.2.1), and fades out instead of vanishing.
 */
export function Toaster() {
  const [items, setItems] = useState<Array<ToastItem & { leaving?: boolean }>>([]);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(new Map<number, number>());

  useEffect(() => {
    const onToast = (t: ToastItem) => {
      remaining.current.set(t.id, 4000 + Math.ceil(t.message.length / 20) * 1000);
      setItems((cur) => [...cur.slice(-2), t]);
    };
    toastListeners.add(onToast);
    return () => {
      toastListeners.delete(onToast);
    };
  }, []);

  // One clock for all toasts; it simply does not tick while paused.
  useEffect(() => {
    if (paused || items.length === 0) return;
    const step = 250;
    const id = window.setInterval(() => {
      const done: number[] = [];
      remaining.current.forEach((ms, key) => {
        const next = ms - step;
        if (next <= 0) done.push(key);
        remaining.current.set(key, next);
      });
      if (done.length === 0) return;
      done.forEach((key) => remaining.current.delete(key));
      setItems((cur) => cur.map((x) => (done.includes(x.id) ? { ...x, leaving: true } : x)));
      window.setTimeout(() => setItems((cur) => cur.filter((x) => !done.includes(x.id))), 220);
    }, step);
    return () => window.clearInterval(id);
  }, [paused, items.length]);

  return createPortal(
    <div
      // One live region, announced politely; children are plain divs so a
      // screen reader says each message once, not twice.
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h,0px)+max(1rem,env(safe-area-inset-bottom)))] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`${t.leaving ? 'toast-out' : 'toast-in'} pointer-events-auto flex max-w-md items-center gap-3 rounded-full bg-[var(--forest-night)] py-2.5 pl-2.5 pr-5 text-sm font-medium text-[var(--paper-lift)] shadow-[0_18px_40px_-16px_rgba(12,61,36,0.6)]`}
        >
          <span
            aria-hidden
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--gold-bright)] text-[var(--forest-night)]"
          >
            <Glyph name={t.tone === 'success' ? 'check' : 'bell'} className="h-4 w-4" />
          </span>
          {t.message}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Typed figure with a tracked caption — the instrument's stat idiom. */
export function Stat({ value, caption, accent }: { value: ReactNode; caption: string; accent?: boolean }) {
  return (
    <div className="text-center">
      <div className={`serial text-lg font-bold ${accent ? 'text-[var(--gold-deep)]' : 'text-[var(--ink)]'}`}>{value}</div>
      <div className="smallcaps text-[var(--ink-6)]">{caption}</div>
    </div>
  );
}

/* ── Form helpers ────────────────────────────────────────────────
   One way to build a form: a visible label tied to its control, a hint
   under it, and an error right under the control it belongs to. Errors are
   shown on blur and on submit, never while someone is still typing. */

/**
 * The control skin for form fields: inputCls plus a red edge when the field
 * is aria-invalid, a soft gold glow on focus, and a 44px height on phones.
 */
export const fieldCls = `${inputCls} min-h-11 focus:ring-2 focus:ring-[var(--gold)]/35 aria-[invalid=true]:border-[var(--stamp)] aria-[invalid=true]:focus:border-[var(--stamp-deep)] lg:min-h-0`;

/** A field with text before or after the value ("GHS [ 250 ] per 50kg bag"): put affixInputCls on the input inside. */
export const affixWrapCls =
  'flex min-h-11 w-full items-center rounded-xl border border-[var(--field-border)] bg-[var(--paper-lift)] text-[var(--ink)] transition-[border-color,box-shadow] hover:border-[var(--ink-7)] focus-within:border-[var(--forest-night)] focus-within:ring-2 focus-within:ring-[var(--gold)]/35 has-[[aria-invalid=true]]:border-[var(--stamp)] lg:min-h-0';
export const affixInputCls =
  'serial w-full min-w-0 flex-1 self-stretch bg-transparent px-3 py-2 text-base text-[var(--ink)] focus:outline-none sm:text-sm';
export const affixTextCls = 'shrink-0 whitespace-nowrap text-sm text-[var(--ink-6)]';

/**
 * id, aria-invalid and aria-describedby for a control. Pass the ids of any
 * hint lines; the error line (`${id}-error`, rendered by FormField/FieldError)
 * is added only while there is an error.
 */
export function fieldAria(
  id: string,
  error?: string | null,
  ...describedBy: Array<string | false | null | undefined>
): { id: string; 'aria-invalid': true | undefined; 'aria-describedby': string | undefined } {
  const ids = [error ? `${id}-error` : null, ...describedBy].filter(Boolean).join(' ');
  return { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': ids || undefined };
}

/** A small spinner beside a button's label while a request is in flight. Static when motion is reduced. */
export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`shrink-0 motion-safe:animate-spin ${className}`}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A button label that keeps its words while busy ("Signing in…") with a
 * spinner beside them. Leave out busyLabel to keep the same words. Pair it
 * with aria-busy on the button, which keeps the button at full strength
 * (btnCls only fades a disabled button that is not busy).
 */
export function BusyLabel({ busy, label, busyLabel }: { busy: boolean; label: ReactNode; busyLabel?: ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center gap-2">
      {busy && <Spinner />}
      {busy ? (busyLabel ?? label) : label}
    </span>
  );
}

/** The "!" in a circle that leads every error line. */
export function AlertMark({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <circle cx="12" cy="16.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

/**
 * The error line under one field. Always in the DOM (empty and hidden when
 * there is no error) so the polite live region announces a message the
 * moment it appears on blur.
 */
export function FieldError({ id, message }: { id: string; message?: string | null }) {
  return (
    <p
      id={id}
      aria-live="polite"
      className={
        message
          ? 'mt-1.5 flex items-start gap-1.5 text-[13px] font-medium leading-snug text-[var(--stamp-deep)]'
          : 'sr-only'
      }
    >
      {message && (
        <>
          <AlertMark className="mt-px h-4 w-4" />
          <span>{message}</span>
        </>
      )}
    </p>
  );
}

/**
 * A labelled field with an explicit for/id link, so the hint and the error
 * stay outside the label (and out of the control's name). Give the control
 * `{...fieldAria(id, error, hint && `${id}-hint`)}`.
 */
export function FormField({
  id,
  label,
  hint,
  error,
  optional,
  children,
  className = '',
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  /** Shown at the right of the label, e.g. "Optional". */
  optional?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`text-sm ${className}`}>
      <label htmlFor={id} className="smallcaps mb-1.5 flex items-baseline justify-between gap-2 text-[var(--ink-6)]">
        <span>{label}</span>
        {optional && <span className="text-[11px] font-medium normal-case tracking-normal">{optional}</span>}
      </label>
      {children}
      <FieldError id={`${id}-error`} message={error} />
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-snug text-[var(--ink-6)]">
          {hint}
        </p>
      )}
    </div>
  );
}

/** A group of controls under one visible name (radios, a number with its unit). */
export function FieldSet({
  id,
  legend,
  hint,
  error,
  children,
  className = '',
}: {
  id: string;
  legend: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ');
  return (
    <fieldset id={id} aria-describedby={describedBy || undefined} className={`m-0 min-w-0 border-0 p-0 text-sm ${className}`}>
      <legend className="smallcaps mb-1.5 p-0 text-[var(--ink-6)]">{legend}</legend>
      {children}
      <FieldError id={`${id}-error`} message={error} />
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-snug text-[var(--ink-6)]">
          {hint}
        </p>
      )}
    </fieldset>
  );
}

/**
 * One choice in a radio group, as a full-width card: the whole card is the tap
 * target, the native radio stays in the tab order (arrow keys move between
 * choices), and the chosen card shows a tick as well as a green edge, so the
 * choice never rests on colour alone.
 */
export function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  detail,
  icon,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <label
      // The chosen card thickens its edge with a ring (box-shadow), not a
      // wider border, so the card never grows by a pixel when picked.
      className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border bg-[var(--paper-lift)] px-4 py-2.5 transition-[border-color,box-shadow,background-color] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--forest-night)] ${
        checked
          ? 'border-[var(--forest)] ring-1 ring-[var(--forest)]'
          : 'border-[var(--ink-3)] hover:border-[var(--ink-5)] hover:bg-[var(--paper)] active:bg-[var(--paper-deep)]'
      }`}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-[var(--ink)]">{title}</span>
        {detail && <span className="block text-xs leading-snug text-[var(--ink-6)]">{detail}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
          checked ? 'border-[var(--forest)] bg-[var(--forest)] text-[var(--paper-lift)]' : 'border-[var(--ink-5)]'
        }`}
      >
        {checked && <Glyph name="check" className="h-4 w-4" />}
      </span>
    </label>
  );
}

function EyeMark({ crossed }: { crossed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-5 w-5">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M4 4l16 16" />}
    </svg>
  );
}

/**
 * A password box with a show/hide toggle. The toggle is a pressed/unpressed
 * button with one fixed name ("Show password"), the pattern screen readers
 * announce cleanly ("Show password, toggle button, pressed"). The type flips
 * between password and text, so autocomplete (current-password /
 * new-password) and password managers keep working; Edge's own reveal eye is
 * hidden so there are never two.
 */
export function PasswordInput({
  showLabel,
  className = '',
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { id: string; showLabel: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        type={shown ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={`${fieldCls} pr-12 [&::-ms-reveal]:hidden ${className}`}
      />
      <button
        type="button"
        aria-label={showLabel}
        aria-pressed={shown}
        aria-controls={props.id}
        onClick={() => setShown((s) => !s)}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-[var(--ink-6)] transition-colors hover:text-[var(--ink)] active:bg-[var(--paper-deep)]"
      >
        <EyeMark crossed={shown} />
      </button>
    </div>
  );
}
