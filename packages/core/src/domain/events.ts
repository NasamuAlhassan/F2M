/**
 * Live updates (D-054): a tiny in-process bus that says "something changed" so
 * open screens can refresh the moment it does, instead of waiting for a poll.
 *
 * Events carry only a topic and ids — never a name, phone number, price or
 * message. A client that hears one asks the ordinary, authenticated API for the
 * data, so the stream itself cannot leak anything.
 *
 * In-process on purpose: F2M runs as one server on one SQLite file. A second
 * server would need this swapped for a shared bus (Redis, Postgres NOTIFY);
 * the publish/subscribe surface below is all that would change.
 */

export type LiveTopic = 'market' | 'prices' | 'offers' | 'notifications' | 'demands' | 'alerts';

export interface LiveEvent {
  topic: LiveTopic;
  /**
   * Who may hear it. `'all'` is every signed-in person; otherwise keys such as
   * `buyer:<id>`, `farmer:<id>`, `phone:+233…`, `role:farmer`.
   */
  audience: string[];
  ref?: Record<string, string>;
}

type Listener = (event: LiveEvent) => void;
const listeners = new Map<Listener, Set<string>>();

/** Tell everyone it concerns. Never throws: a broken listener must not break a trade. */
export function publishLive(event: LiveEvent): void {
  for (const [listener, keys] of listeners) {
    if (!event.audience.some((a) => a === 'all' || keys.has(a))) continue;
    try {
      listener(event);
    } catch {
      // one bad connection must not stop the others, or the write that caused the event
    }
  }
}

/** Listen as someone holding these keys. Returns the way to stop. */
export function subscribeLive(keys: string[], listener: Listener): () => void {
  listeners.set(listener, new Set(keys));
  return () => void listeners.delete(listener);
}

export function liveListenerCount(): number {
  return listeners.size;
}

/** The audience keys a signed-in person answers to. */
export function audienceKeys(who: { role: 'farmer' | 'buyer' | 'driver'; id: string; phone?: string | null }): string[] {
  return [`role:${who.role}`, `${who.role}:${who.id}`, ...(who.phone ? [`phone:${who.phone}`] : [])];
}
