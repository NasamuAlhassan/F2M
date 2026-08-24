import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, dateTime, type TraceEvent } from '../api';
import { Card } from '../components/ui';

const EVENT_STYLE: Record<string, { dot: string; label: string; icon?: string }> = {
  LOT_REGISTERED: { dot: 'bg-green-600', label: 'Lot registered', icon: '🌱' },
  MATCHED: { dot: 'bg-sky-500', label: 'Matched to demand', icon: '🤝' },
  CONTRACT_OFFERED: { dot: 'bg-amber-500', label: 'Contract offered', icon: '📄' },
  CONTRACT_ACCEPTED: { dot: 'bg-green-600', label: 'Farmer accepted', icon: '✅' },
  CONTRACT_DECLINED: { dot: 'bg-gray-400', label: 'Farmer declined' },
  OFFER_EXPIRED: { dot: 'bg-gray-400', label: 'Offer expired' },
  FUNDING_FAILED: { dot: 'bg-red-500', label: 'Funding failed' },
  FUNDS_HELD: { dot: 'bg-indigo-600', label: 'Buyer funds held in escrow', icon: '🔒' },
  PICKUP_CONFIRMED: { dot: 'bg-violet-600', label: 'Pickup confirmed', icon: '📦' },
  PHOTO_ADDED: { dot: 'bg-gray-500', label: 'Pickup photo added', icon: '📷' },
  GRADED: { dot: 'bg-teal-600', label: 'AI graded', icon: '🔬' },
  DISPUTE_OPENED: { dot: 'bg-orange-500', label: 'Farmer disputed the grade', icon: '⚠️' },
  DISPUTE_RESOLVED: { dot: 'bg-teal-600', label: 'Dispute resolved' },
  PAYMENT_RELEASED: { dot: 'bg-green-600', label: 'Payment released', icon: '💸' },
  REFUNDED: { dot: 'bg-red-500', label: 'Hold refunded to buyer' },
  CANCELLED: { dot: 'bg-red-500', label: 'Cancelled' },
  SETTLED: { dot: 'bg-green-700', label: 'Settled — farmer paid', icon: '🏁' },
  TRANSPORT_REQUESTED: { dot: 'bg-sky-500', label: 'Transport requested', icon: '🚚' },
  DRIVER_ASSIGNED: { dot: 'bg-sky-600', label: 'Driver assigned', icon: '🧑🏾‍✈️' },
  TRANSPORT_FUNDED: { dot: 'bg-indigo-600', label: 'Transport fee held in escrow', icon: '🔒' },
  IN_TRANSIT: { dot: 'bg-violet-600', label: 'In transit — driver picked up', icon: '🛣️' },
  TRANSPORT_DELIVERED: { dot: 'bg-teal-600', label: 'Delivered — buyer confirmed receipt', icon: '📍' },
  DRIVER_PAID: { dot: 'bg-green-600', label: 'Driver paid', icon: '💸' },
  TRANSPORT_CANCELLED: { dot: 'bg-red-500', label: 'Transport cancelled' },
  VOICE_CALL: { dot: 'bg-gray-500', label: 'Voice call', icon: '📞' },
};

// The six-step spine, each step lit by the trace events that prove it happened.
const SPINE: { label: string; icon: string; doneWhen: string[] }[] = [
  { label: 'Register', icon: '🌱', doneWhen: ['LOT_REGISTERED'] },
  { label: 'Match', icon: '🤝', doneWhen: ['MATCHED'] },
  { label: 'Contract', icon: '📄', doneWhen: ['CONTRACT_ACCEPTED', 'FUNDS_HELD'] },
  { label: 'Grade', icon: '🔬', doneWhen: ['GRADED'] },
  { label: 'Pay', icon: '💸', doneWhen: ['PAYMENT_RELEASED', 'SETTLED'] },
  { label: 'Trace', icon: '🔗', doneWhen: ['SETTLED'] },
];

export function TracePage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useQuery({
    queryKey: ['trace', id],
    queryFn: () => api<{ events: TraceEvent[] }>(`/api/lots/${id}/trace`),
    refetchInterval: 5000,
  });
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  const seen = new Set(data.events.map((e) => e.type));
  const doneFlags = SPINE.map((s) => s.doneWhen.some((t) => seen.has(t)));
  const activeIdx = doneFlags.findIndex((d) => !d);

  return (
    <div>
      <h1 className="text-xl font-extrabold text-gray-900">Lot Trace</h1>
      <p className="mb-5 mt-0.5 text-sm text-gray-500">
        The append-only record this lot carries from farm to buyer. Nothing here can be edited or deleted.
      </p>

      <Card title="Transaction Spine">
        <div className="flex items-center overflow-x-auto pb-1">
          {SPINE.map((step, i) => {
            const done = doneFlags[i];
            const active = i === activeIdx;
            return (
              <div key={step.label} className="flex flex-1 items-center" style={{ minWidth: 90 }}>
                <div className="flex flex-1 flex-col items-center gap-1.5">
                  <div
                    className={`flex h-11 w-11 items-center justify-center rounded-full border-2 text-lg transition-colors ${
                      done
                        ? 'border-[#1B4332] bg-[#1B4332]'
                        : active
                          ? 'step-active border-[#D97706] bg-amber-50'
                          : 'border-gray-200 bg-white grayscale'
                    }`}
                  >
                    {done ? <span className="text-sm font-extrabold text-white">✓</span> : step.icon}
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wide ${
                      done ? 'text-[#1B4332]' : active ? 'text-[#D97706]' : 'text-gray-300'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                {i < SPINE.length - 1 && (
                  <div className={`h-0.5 flex-1 -translate-y-2.5 ${done ? 'bg-[#1B4332]' : 'bg-gray-200'}`} />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title={`Event Log (${data.events.length})`}>
        <ol className="relative ml-3 border-l-2 border-gray-100">
          {data.events.map((e) => {
            const style = EVENT_STYLE[e.type] ?? { dot: 'bg-gray-400', label: e.type };
            return (
              <li key={e.id} className="mb-5 ml-5 last:mb-1">
                <span className={`absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full ${style.dot}`} />
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="text-sm font-bold text-gray-900">
                    {style.icon && <span className="mr-1">{style.icon}</span>}
                    {style.label}
                  </p>
                  <span className="mono text-[10px] text-gray-400">
                    #{e.seq} · {e.actorType} · {dateTime(e.createdAt)}
                  </span>
                </div>
                {e.payload && (
                  <p className="mono mt-0.5 max-w-2xl text-[11px] text-gray-500">
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
