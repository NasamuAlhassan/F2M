import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, dateTime, type TraceEvent } from '../api';
import { Card, numCls } from '../components/ui';

const EVENT_LABEL: Record<string, string> = {
  LOT_REGISTERED: 'Lot registered',
  MATCHED: 'Matched to demand',
  CONTRACT_OFFERED: 'Contract offered',
  CONTRACT_ACCEPTED: 'Farmer accepted',
  CONTRACT_DECLINED: 'Farmer declined',
  OFFER_EXPIRED: 'Offer expired',
  FUNDING_FAILED: 'Funding failed',
  FUNDS_HELD: 'Buyer funds held in escrow',
  PICKUP_CONFIRMED: 'Pickup confirmed',
  PHOTO_ADDED: 'Pickup photo added',
  GRADED: 'AI graded',
  DISPUTE_OPENED: 'Farmer disputed the grade',
  DISPUTE_RESOLVED: 'Dispute resolved',
  PAYMENT_RELEASED: 'Payment released',
  REFUNDED: 'Hold refunded to buyer',
  CANCELLED: 'Cancelled',
  SETTLED: 'Settled — farmer paid',
  TRANSPORT_REQUESTED: 'Transport requested',
  DRIVER_ASSIGNED: 'Driver assigned',
  TRANSPORT_FUNDED: 'Transport fee held in escrow',
  IN_TRANSIT: 'In transit — driver picked up',
  TRANSPORT_DELIVERED: 'Delivered — buyer confirmed receipt',
  DRIVER_PAID: 'Driver paid',
  TRANSPORT_CANCELLED: 'Transport cancelled',
  VOICE_CALL: 'Voice call',
};

const BAD = new Set(['FUNDING_FAILED', 'REFUNDED', 'CANCELLED', 'TRANSPORT_CANCELLED']);
const GOOD = new Set(['SETTLED', 'DRIVER_PAID', 'CONTRACT_ACCEPTED', 'FUNDS_HELD', 'TRANSPORT_FUNDED']);

export function TracePage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useQuery({
    queryKey: ['trace', id],
    queryFn: () => api<{ events: TraceEvent[] }>(`/api/lots/${id}/trace`),
    refetchInterval: 5000,
  });
  if (!data) return <p className="text-sm text-ink-soft">Loading…</p>;

  return (
    <div>
      <h1 className="mb-1 text-lg font-bold uppercase tracking-widest">Lot trace</h1>
      <p className="mb-4 text-sm text-ink-soft">
        The append-only record this lot carries from farm to buyer. Nothing here can be edited or deleted.
      </p>
      <Card>
        <ol className="ml-2 border-l-2 border-ink">
          {data.events.map((e) => {
            const marker = BAD.has(e.type) ? 'bg-err' : GOOD.has(e.type) ? 'bg-ink' : 'border-2 border-ink bg-paper';
            return (
              <li key={e.id} className="relative mb-4 ml-5 last:mb-0">
                <span className={`absolute -left-[27px] top-1 h-3 w-3 ${marker}`} />
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="font-bold">{EVENT_LABEL[e.type] ?? e.type}</p>
                  <span className={`text-xs text-ink-soft ${numCls}`}>
                    #{e.seq} · {e.actorType} · {dateTime(e.createdAt)}
                  </span>
                </div>
                {e.payload && (
                  <p className={`mt-0.5 max-w-2xl text-xs text-ink-soft ${numCls}`}>
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
      </Card>
    </div>
  );
}
