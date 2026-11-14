import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A pill group whose highlight slides from the old choice to the new one,
 * the way a segmented control does on iOS. The content beside it swaps
 * instantly; only the indicator moves, so switching feels quick but you can
 * still see where you went.
 *
 * The active child is found by aria-current="page" (NavLink sets it),
 * aria-pressed="true" (toggle buttons) or aria-selected="true" (tabs), so
 * callers keep their own markup. Give children pillItemCls(active): it puts
 * them above the indicator and keeps every segmented control alike.
 */
export function pillItemCls(active: boolean): string {
  // Text colour follows the pill at the "base" step so it lands with it; the
  // press sink is the "fast" step. The active item has no hover wash, which
  // would otherwise paint over the indicator sliding in under it.
  return `relative z-10 inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium transition-[color,background-color,scale] duration-[var(--dur-base)] active:scale-[0.97] lg:min-h-10 ${
    active ? 'text-[var(--paper-lift)]' : 'text-[var(--ink-7)] hover:bg-[var(--paper-deep)]/70 hover:text-[var(--ink)]'
  }`;
}

export function SlidingPillGroup({
  as: Tag = 'div',
  className = '',
  indicatorClassName = 'bg-[var(--forest-night)]',
  watch,
  children,
  ...rest
}: {
  as?: 'div' | 'nav';
  className?: string;
  indicatorClassName?: string;
  /** Anything that changes when the active item changes (pathname, mode). */
  watch: unknown;
  children: ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement | null>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // No slide on the very first paint: the pill appears where it belongs.
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const active = el.querySelector<HTMLElement>('[aria-current="page"], [aria-pressed="true"], [aria-selected="true"]');
      if (!active) {
        setBox(null);
        return;
      }
      setBox({ x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Fonts arriving late change label widths.
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [watch]);

  useLayoutEffect(() => {
    if (box && !animate) {
      const id = requestAnimationFrame(() => setAnimate(true));
      return () => cancelAnimationFrame(id);
    }
  }, [box, animate]);

  return (
    <Tag ref={ref as never} className={`relative ${className}`} {...rest}>
      {box && (
        <span
          aria-hidden
          className={`pill-indicator pointer-events-none absolute left-0 top-0 rounded-full shadow-sm ${indicatorClassName} ${
            animate ? 'is-animated' : ''
          }`}
          style={{ width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)` }}
        />
      )}
      {children}
    </Tag>
  );
}
