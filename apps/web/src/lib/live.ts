import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { accessToken } from './session';

/**
 * Live updates (D-054). The server's `/api/stream` says which topics changed;
 * here each topic refreshes the queries that show it. The stream carries no
 * data, so a missed or malformed message can only make a screen a few seconds
 * stale — the polling every page already does stays as the safety net.
 */
const REFRESH: Record<string, string[]> = {
  market: ['market-lots', 'farmer-dashboard', 'price-overview', 'engine-feed'],
  prices: ['price-overview', 'price-crop', 'price-check'],
  offers: ['farmer-dashboard', 'demands', 'demand', 'engine-feed', 'contracts', 'contract', 'notifications'],
  demands: ['demands', 'demand', 'farmer-dashboard', 'engine-feed', 'price-overview'],
  notifications: ['notifications', 'farmer-dashboard', 'contracts', 'contract', 'driver-jobs', 'engine-feed'],
  alerts: ['notifications', 'farmer-dashboard', 'price-overview'],
};

function refresh(queryClient: QueryClient, topics: string[]): void {
  const keys = new Set(topics.flatMap((t) => REFRESH[t] ?? []));
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: [key] });
}

/** Read one server-sent-events body, calling `onTopics` for each "live" message. Returns when the stream ends. */
async function readStream(body: ReadableStream<Uint8Array>, onTopics: (topics: string[]) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (!/^event: live$/m.test(block)) continue;
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (!data) continue;
      try {
        const parsed = JSON.parse(data) as { topics?: unknown };
        if (Array.isArray(parsed.topics)) onTopics(parsed.topics.filter((t): t is string => typeof t === 'string'));
      } catch {
        // a garbled message is ignored; the next one is fine
      }
    }
  }
}

/**
 * Keep one stream open while signed in, and reconnect (with a growing pause)
 * when it drops or the server ends it. Returns whether it is connected now,
 * for a "Live" indicator.
 */
export function useLiveUpdates(enabled: boolean): boolean {
  const queryClient = useQueryClient();
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let attempt = 0;

    async function run() {
      while (!controller.signal.aborted) {
        try {
          const token = await accessToken();
          if (!token) return;
          const res = await fetch('/api/stream', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
          if (!res.ok || !res.body) throw new Error(`stream refused (${res.status})`);
          attempt = 0;
          setLive(true);
          // On every (re)connect, catch up on whatever changed while we were away.
          refresh(queryClient, ['market', 'prices', 'offers', 'notifications', 'demands']);
          await readStream(res.body, (topics) => refresh(queryClient, topics));
        } catch {
          // dropped, refused or offline — fall through to the pause below
        }
        setLive(false);
        if (controller.signal.aborted) return;
        attempt += 1;
        await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))));
      }
    }
    void run();
    return () => controller.abort();
  }, [enabled, queryClient]);

  return live;
}
