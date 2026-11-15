/**
 * A small physical answer to the moments that matter (money confirmed, a job
 * step done). Only Android browsers vibrate; everywhere else this does
 * nothing. Never on scroll, typing or errors.
 */
export function haptic(kind: 'tap' | 'success'): void {
  try {
    if (typeof navigator.vibrate !== 'function' || document.visibilityState !== 'visible') return;
    navigator.vibrate(kind === 'tap' ? 10 : [12, 60, 24]);
  } catch {
    // Some browsers throw without a recent tap; a missing buzz is fine.
  }
}
