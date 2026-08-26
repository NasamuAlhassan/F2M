import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog behavior for modal surfaces (D-040 hardening): Escape closes, focus
 * moves into the panel and returns to the opener on close, Tab cycles inside,
 * and the page behind stops scrolling. One hook so the centered Modal and the
 * simulation drawer behave identically.
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
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

/** The centered certificate modal shell — overlay, ink veil, dialog semantics. */
export function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const { panelRef, trapTab } = useDialog(onClose);
  // Close only when the press STARTED on the backdrop. Selecting text inside a
  // field and releasing past the panel edge still dispatches click on this
  // container — which silently threw away a fully filled demand form.
  const pressedBackdrop = useRef(false);
  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto"
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedBackdrop.current) onClose();
        pressedBackdrop.current = false;
      }}
    >
      <div className="absolute inset-0 bg-[var(--ink)]/70" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="relative mx-auto my-8 w-full max-w-3xl px-4 outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        {children}
      </div>
    </div>
  );
}
