import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, dateTime, type TraceEvent } from '../api';
import { POLL } from '../poll';
import { RouteSpine } from '../components/engrave';
import { Card, LoadGate } from '../components/ui';

// Tones: ink = money/completion truth, gold = movement and matches,
// red = refusals and failures, faded = the quiet clerical entries.
const EVENT_STYLE: Record<string, { tone: 'ink' | 'gold' | 'red' | 'faded'; label: string }> = {
  LOT_REGISTERED: { tone: 'ink', label: 'Lot registered' },
  MATCHED: { tone: 'gold', label: 'Matched to demand' },
  CONTRACT_OFFERED: { tone: 'gold', label: 'Contract offered' },
  CONTRACT_ACCEPTED: { tone: 'ink', label: 'Farmer accepted' },
  CONTRACT_DECLINED: { tone: 'faded', label: 'Farmer declined' },
  OFFER_EXPIRED: { tone: 'faded', label: 'Offer expired' },
  FUNDING_FAILED: { tone: 'red', label: 'Funding failed' },
  FUNDS_HELD: { tone: 'ink', label: 'Buyer funds held in escrow' },
  PICKUP_CONFIRMED: { tone: 'gold', label: 'Pickup confirmed' },
  PHOTO_ADDED: { tone: 'faded', label: 'Photo added' },
  GRADED: { tone: 'ink', label: 'AI graded' },
  DISPUTE_OPENED: { tone: 'red', label: 'Farmer disputed the grade' },
  DISPUTE_RESOLVED: { tone: 'ink', label: 'Dispute resolved' },
  PAYMENT_RELEASED: { tone: 'ink', label: 'Payment released' },
  REFUNDED: { tone: 'red', label: 'Hold refunded to buyer' },
  CANCELLED: { tone: 'red', label: 'Cancelled' },
  SETTLED: { tone: 'ink', label: 'Settled — farmer paid' },
  TRANSPORT_SUGGESTED: { tone: 'gold', label: 'Farmer requested a driver' },
  TRANSPORT_REQUESTED: { tone: 'gold', label: 'Transport requested' },
  DRIVER_ASSIGNED: { tone: 'gold', label: 'Driver assigned' },
  TRANSPORT_FUNDED: { tone: 'ink', label: 'Transport fee held in escrow' },
  IN_TRANSIT: { tone: 'gold', label: 'In transit — driver picked up' },
  TRANSPORT_DELIVERED: { tone: 'ink', label: 'Delivered — buyer confirmed receipt' },
  DRIVER_PAID: { tone: 'ink', label: 'Driver paid' },
  TRANSPORT_CANCELLED: { tone: 'red', label: 'Transport cancelled' },
  VOICE_CALL: { tone: 'faded', label: 'Voice call' },
};

const TONE_DOT: Record<'ink' | 'gold' | 'red' | 'faded', string> = {
  ink: 'bg-[var(--ink)]',
  gold: 'bg-[var(--gold)]',
  red: 'bg-[var(--stamp)]',
  faded: 'bg-[var(--ink-3)]',
};

/** The six-station engraved route — shared by the portal and public trace pages. */
export function SpineStepper({ events }: { events: TraceEvent[] }) {
  return <RouteSpine eventTypes={events.map((e) => e.type)} />;
}

/** The append-only entry ledger — shared by the portal and public trace pages. */
export function TraceEventLog({ events }: { events: TraceEvent[] }) {
  return (
    <ol className="relative ml-1.5 border-l border-[var(--ink-2)]">
      {events.map((e) => {
        const style = EVENT_STYLE[e.type] ?? { tone: 'faded' as const, label: e.type };
        return (
          <li key={e.id} className="mb-4 ml-5 last:mb-1">
            <span className={`absolute -left-[5px] mt-1.5 h-[9px] w-[9px] rounded-full border-2 border-[var(--paper-lift)] ${TONE_DOT[style.tone]}`} />
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-sm font-bold text-[var(--ink)]">{style.label}</p>
              <span className="serial text-[11px] text-[var(--ink-6)]">
                №{e.seq} · {e.actorType} · {dateTime(e.createdAt)}
              </span>
            </div>
            {e.payload && (
              <p className="serial mt-0.5 max-w-2xl text-[11px] text-[var(--ink-6)]">
                {Object.entries(e.payload)
                  .filter(([k, v]) => v !== null && typeof v !== 'object' && k !== 'contractId')
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .join(' · ')}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function TracePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isError, refetch } = useQuery({
    queryKey: ['trace', id],
    queryFn: () => api<{ events: TraceEvent[] }>(`/api/lots/${id}/trace`),
    refetchInterval: POLL.active,
  });
  if (!data) return <LoadGate isError={isError} onRetry={() => void refetch()} label="the trace" />;

  return (
    <div>
      <h1 className="display text-xl font-semibold tracking-[0.05em] text-[var(--ink)]">Lot Trace</h1>
      <p className="mb-4 mt-1 text-sm text-[var(--ink-6)]">
        The append-only record this lot carries from farm to buyer. Nothing here can be edited or deleted.
      </p>

      <Card title="Transaction Spine">
        <SpineStepper events={data.events} />
      </Card>

      <Card title={`Entry Ledger (${data.events.length})`}>
        <TraceEventLog events={data.events} />
      </Card>
    </div>
  );
}
