/**
 * The one knob for every polling cadence. React Query already stops these when
 * the window loses focus; before a data-billed pilot, this file is where the
 * whole app's refresh appetite gets tuned in one place.
 */
export const POLL = {
  /** Money in motion — payments and grading during a live contract. */
  live: 4000,
  /** Working surfaces — offers, jobs, dashboards the user is acting on. */
  active: 5000,
  /** Ambient lists — market lots, notices, contract ledgers. */
  ambient: 8000,
  /** Slow-moving context — the masthead lot count, price matrices. */
  slow: 15000,
} as const;
