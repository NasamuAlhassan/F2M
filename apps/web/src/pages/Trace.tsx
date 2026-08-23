import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, dateTime, type TraceEvent } from '../api';
import { Card } from '../components/ui';

const EVENT_STYLE: Record<string, { dot: string; label: string }> = {
  LOT_REGISTERED: { dot: 'bg-green-600', label: 'Lot registered' },
  MATCHED: { dot: 'bg-sky-500', label: 'Matched to demand' },
  CONTRACT_OFFERED: { dot: 'bg-amber-500', label: 'Contract offered' },
  CONTRACT_ACCEPTED: { dot: 'bg-green-600', label: 'Farmer accepted' },
  CONTRACT_DECLINED: { dot: 'bg-stone-400', label: 'Farmer declined' },
  OFFER_EXPIRED: { dot: 'bg-stone-400', label: 'Offer expired' },
  FUNDING_FAILED: { dot: 'bg-red-500', label: 'Funding failed' },
  FUNDS_HELD: { dot: 'bg-indigo-600', label: 'Buyer funds held in escrow' },
  PICKUP_CONFIRMED: { dot: 'bg-violet-600', label: 'Pickup confirmed' },
  PHOTO_ADDED: { dot: 'bg-stone-500', label: 'Pickup photo added' },
  GRADED: { dot: 'bg-teal-600', label: 'AI graded' },
  DISPUTE_OPENED: { dot: 'bg-orange-500', label: 'Farmer disputed the grade' },
  DISPUTE_RESOLVED: { dot: 'bg-teal-600', label: 'Dispute resolved' },
  PAYMENT_RELEASED: { dot: 'bg-green-600', label: 'Payment released' },
  REFUNDED: { dot: 'bg-red-500', label: 'Hold refunded to buyer' },
  CANCELLED: { dot: 'bg-red-500', label: 'Cancelled' },
  SETTLED: { dot: 'bg-green-700', label: 'Settled — farmer paid' },
};

export function TracePage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useQuery({
    queryKey: ['trace', id],
    queryFn: () => api<{ events: TraceEvent[] }>(`/api/lots/${id}/trace`),
    refetchInterval: 5000,
  });
  if (!data) return <p className="text-sm text-stone-500">Loading…</p>;

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Lot trace</h1>
      <p className="mb-4 text-sm text-stone-500">
        The append-only record this lot carries from farm to buyer. Nothing here can be edited or deleted.
      </p>
      <Card>
        <ol className="relative ml-3 border-l-2 border-stone-200">
          {data.events.map((e) => {
            const style = EVENT_STYLE[e.type] ?? { dot: 'bg-stone-400', label: e.type };
            return (
              <li key={e.id} className="mb-5 ml-5 last:mb-1">
                <span className={`absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full ${style.dot}`} />
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="font-semibold">{style.label}</p>
                  <span className="text-xs text-stone-400">
                    #{e.seq} · {e.actorType} · {dateTime(e.createdAt)}
                  </span>
                </div>
                {e.payload && (
                  <p className="mt-0.5 max-w-2xl text-xs text-stone-500">
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
