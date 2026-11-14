import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** How many dialogs are open, so a nested one closing does not wake the page. */
let openDialogs = 0;

/**
 * Dialog behavior for modal surfaces (D-040 hardening): Escape closes, focus
 * moves into the panel and returns to the opener on close, Tab cycles inside,
 * and the page behind stops scrolling. While open, the app root is `inert`, so
 * a screen reader cannot wander behind the dialog (aria-modal alone does not
 * stop it). That is why both surfaces render through a portal into
 * document.body: a dialog inside #root would go inert with the page. One hook
 * so the centered Modal and the simulation drawer behave identically.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
): {
  panelRef: RefObject<T | null>;
  trapTab: (e: ReactKeyboardEvent) => void;
} {
  const panelRef = useRef<T | null>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const root = document.getElementById('root');
    openDialogs += 1;
    if (root) root.inert = true;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      openDialogs = Math.max(0, openDialogs - 1);
      // Wake the page before refocusing: an inert opener cannot take focus.
      if (root && openDialogs === 0) root.inert = false;
      opener?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null,
    );
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return { panelRef, trapTab };
}

/** The centered certificate modal shell — overlay, ink veil, dialog semantics.
 *  Pass `labelledBy` (the id of a visible title inside `children`) to name the
 *  dialog by that title; `label` is the fallback name. */
export function Modal({
  label,
  labelledBy,
  onClose,
  children,
}: {
  label: string;
  labelledBy?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { panelRef, trapTab } = useDialog(onClose);
  // Close only when the press STARTED on the backdrop. Selecting text inside a
  // field and releasing past the panel edge still dispatches click on this
  // container — which silently threw away a fully filled demand form.
  const pressedBackdrop = useRef(false);
  return createPortal(
    <div
      // overscroll-contain: scrolling a long dialog never scrolls the page behind.
      className="fixed inset-0 z-40 flex flex-col overflow-y-auto overscroll-contain sm:block"
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedBackdrop.current) onClose();
        pressedBackdrop.current = false;
      }}
    >
      {/* The veil is fixed (it stays put while a tall dialog scrolls) and lets
          clicks fall through to the container, so a click outside the panel
          really closes it — it used to land on the veil and do nothing. */}
      <div aria-hidden className="scrim-in pointer-events-none fixed inset-0 bg-[var(--forest-night)]/60 backdrop-blur-[2px]" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        tabIndex={-1}
        // Phones: a sheet at the bottom, where the thumb is; a tall one scrolls.
        className="dialog-in relative mx-auto mt-auto w-full max-w-3xl px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-16 outline-none sm:my-8 sm:px-4 sm:pb-0 sm:pt-0"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
