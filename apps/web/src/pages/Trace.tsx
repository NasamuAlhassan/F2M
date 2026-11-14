import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, dateTime, ghs, type TraceEvent } from '../api';
import { POLL } from '../poll';
import { Glyph, RouteSpine } from '../components/engrave';
import { Card, EmptyState, LoadGate } from '../components/ui';
import { useT, type UiLanguage } from '../lib/i18n';

type T = UiLanguage['t'];

// Tones: ink = money/completion truth, gold = movement and matches,
// red = refusals and failures, faded = the quiet clerical entries.
// The dot is decoration only: the words beside it always say what happened.
const EVENT_TONE: Record<string, 'ink' | 'gold' | 'red' | 'faded'> = {
  LOT_REGISTERED: 'ink',
  LOT_UPDATED: 'faded',
  LOT_WITHDRAWN: 'faded',
  LOT_SOLD: 'faded',
  LOT_EXPIRED: 'faded',
  MATCHED: 'gold',
  CONTRACT_OFFERED: 'gold',
  CONTRACT_ACCEPTED: 'ink',
  CONTRACT_DECLINED: 'faded',
  OFFER_EXPIRED: 'faded',
  FUNDING_FAILED: 'red',
  FUNDS_HELD: 'ink',
  PICKUP_CONFIRMED: 'gold',
  PHOTO_ADDED: 'faded',
  GRADED: 'ink',
  DISPUTE_OPENED: 'red',
  DISPUTE_RESOLVED: 'ink',
  PAYMENT_RELEASED: 'ink',
  REFUNDED: 'red',
  CANCELLED: 'red',
  SETTLED: 'ink',
  TRANSPORT_SUGGESTED: 'gold',
  TRANSPORT_REQUESTED: 'gold',
  DRIVER_ASSIGNED: 'gold',
  TRANSPORT_FUNDED: 'ink',
  IN_TRANSIT: 'gold',
  TRANSPORT_DELIVERED: 'ink',
  DRIVER_PAID: 'ink',
  TRANSPORT_CANCELLED: 'red',
  VOICE_CALL: 'faded',
};

const TONE_DOT: Record<'ink' | 'gold' | 'red' | 'faded', string> = {
  ink: 'bg-[var(--ink)]',
  gold: 'bg-[var(--gold)]',
  red: 'bg-[var(--stamp)]',
  faded: 'bg-[var(--ink-3)]',
};

/** "no_available_driver" / "vehicleClassCode" → "no available driver" / "vehicle class code". */
const words = (raw: string): string =>
  raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase()
    .trim();
const sentence = (raw: string): string => {
  const w = words(raw);
  return w ? w[0]!.toUpperCase() + w.slice(1) : w;
};

/** What happened, in plain words. A switch so every key stays a static string for i18n:extract. */
function eventLabel(type: string, t: T): string {
  switch (type) {
    case 'LOT_REGISTERED': return t('web.trace.ev.listed', 'Listed for sale');
    case 'LOT_UPDATED': return t('web.trace.ev.updated', 'Listing changed');
    case 'LOT_WITHDRAWN': return t('web.trace.ev.withdrawn', 'Farmer took the listing down');
    case 'LOT_SOLD': return t('web.trace.ev.soldElsewhere', 'Farmer sold it elsewhere');
    case 'LOT_EXPIRED': return t('web.trace.ev.listingExpired', 'Listing ran out of time');
    case 'MATCHED': return t('web.trace.ev.matched', 'Matched to a buyer’s order');
    case 'CONTRACT_OFFERED': return t('web.trace.ev.offered', 'Offer sent to the farmer');
    case 'CONTRACT_ACCEPTED': return t('web.trace.ev.accepted', 'Farmer accepted the offer');
    case 'CONTRACT_DECLINED': return t('web.trace.ev.declined', 'Farmer said no to the offer');
    case 'OFFER_EXPIRED': return t('web.trace.ev.offerExpired', 'Offer ran out of time');
    case 'FUNDING_FAILED': return t('web.trace.ev.fundingFailed', 'Buyer’s payment did not go through');
    case 'FUNDS_HELD': return t('web.trace.ev.fundsHeld', 'Buyer’s payment held for the farmer');
    case 'PICKUP_CONFIRMED': return t('web.trace.ev.collected', 'Pickup confirmed');
    case 'PHOTO_ADDED': return t('web.trace.ev.photo', 'Photo added');
    case 'GRADED': return t('web.trace.ev.graded', 'Quality checked by AI');
    case 'DISPUTE_OPENED': return t('web.trace.ev.disputed', 'Farmer questioned the grade');
    case 'DISPUTE_RESOLVED': return t('web.trace.ev.disputeResolved', 'Grade checked again');
    case 'PAYMENT_RELEASED': return t('web.trace.ev.paid', 'Payment sent to the farmer');
    case 'REFUNDED': return t('web.trace.ev.refunded', 'Money returned to the buyer');
    case 'CANCELLED': return t('web.trace.ev.cancelled', 'Cancelled');
    case 'SETTLED': return t('web.trace.ev.settled', 'Complete: farmer paid');
    case 'TRANSPORT_SUGGESTED': return t('web.trace.ev.driverAsked', 'Farmer asked for a driver');
    case 'TRANSPORT_REQUESTED': return t('web.trace.ev.driverRequested', 'Driver requested');
    case 'DRIVER_ASSIGNED': return t('web.trace.ev.driverAssigned', 'Driver assigned');
    case 'TRANSPORT_FUNDED': return t('web.trace.ev.feeHeld', 'Driver’s fee held until delivery');
    case 'IN_TRANSIT': return t('web.trace.ev.onTheWay', 'Driver collected the goods');
    case 'TRANSPORT_DELIVERED': return t('web.trace.ev.delivered', 'Delivered: buyer confirmed');
    case 'DRIVER_PAID': return t('web.trace.ev.driverPaid', 'Driver paid');
    case 'TRANSPORT_CANCELLED': return t('web.trace.ev.transportCancelled', 'Transport cancelled');
    case 'VOICE_CALL': return t('web.trace.ev.call', 'Phone call');
    default: return sentence(type);
  }
}

function actorLabel(actor: string, t: T): string {
  if (actor === 'farmer') return t('web.trace.actor.farmer', 'Farmer');
  if (actor === 'buyer') return t('web.trace.actor.buyer', 'Buyer');
  if (actor === 'system') return t('web.trace.actor.system', 'F2M');
  return sentence(actor);
}

const gradeWord = (g: string, t: T): string =>
  g === 'REJECT' ? t('web.trace.p.rejected', 'rejected') : t('web.trace.p.grade', 'grade {g}', { g });

/**
 * The event's details in plain words. Ids, file sizes and internal codes stay
 * off the screen; anything not listed here reads as "name: value" in words.
 */
function detailParts(payload: Record<string, unknown>, t: T): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (v === null || v === undefined || typeof v === 'object') continue;
    if (/Id$/.test(k) || ['bytes', 'provider', 'stage', 'commodity', 'unit', 'unitQty', 'units', 'lotCode'].includes(k)) continue;
    const n = typeof v === 'number' ? v : Number(v);
    const s = String(v);
    switch (k) {
      case 'quantityKg': out.push(t('web.trace.p.kg', '{kg} kg', { kg: n })); break;
      case 'allocatedKg': out.push(t('web.trace.p.allocated', '{kg} kg for this order', { kg: n })); break;
      case 'remainingKg': out.push(t('web.trace.p.remaining', '{kg} kg left', { kg: n })); break;
      case 'withdrawnKg': out.push(t('web.trace.p.withdrawn', '{kg} kg taken off the market', { kg: n })); break;
      case 'soldElsewhereKg': out.push(t('web.trace.p.soldElsewhere', '{kg} kg sold elsewhere', { kg: n })); break;
      case 'declaredBand': out.push(t('web.trace.p.declared', 'farmer said grade {g}', { g: s })); break;
      case 'gradeBand':
      case 'finalGrade': out.push(gradeWord(s, t)); break;
      case 'confidence':
        if (Number.isFinite(n)) out.push(t('web.trace.p.confidence', '{pct}% sure', { pct: Math.round(n * 100) }));
        break;
      case 'attempt': out.push(t('web.trace.p.attempt', 'check {n}', { n: s })); break;
      case 'topReason': out.push(s); break;
      case 'distanceKm': out.push(t('web.trace.p.km', '{km} km', { km: n })); break;
      case 'vehicleClassCode': out.push(words(s)); break;
      case 'amount':
      case 'finalAmount': if (Number.isFinite(n)) out.push(ghs(n)); break;
      case 'refunded': if (Number.isFinite(n)) out.push(t('web.trace.p.refunded', '{amount} returned to the buyer', { amount: ghs(n) })); break;
      default: out.push(`${words(k)}: ${words(s)}`);
    }
  }
  return out;
}

/** The six-station engraved route — shared by the portal and public trace pages. */
export function SpineStepper({ events }: { events: TraceEvent[] }) {
  return <RouteSpine eventTypes={events.map((e) => e.type)} />;
}

/** The append-only entry list — shared by the portal and public trace pages. */
export function TraceEventLog({ events }: { events: TraceEvent[] }) {
  const { t } = useT();
  if (events.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Glyph name="route" className="h-5 w-5" />}
        title={t('web.trace.emptyTitle', 'Nothing written down yet')}
        body={t('web.trace.emptyBody', 'Each step is added here the moment it happens.')}
      />
    );
  }
  return (
    <ol className="relative ml-1.5 border-l border-[var(--ink-2)]">
      {events.map((e) => {
        const tone = EVENT_TONE[e.type] ?? 'faded';
        const details = e.payload ? detailParts(e.payload, t) : [];
        return (
          <li key={e.id} className="mb-4 ml-5 last:mb-1">
            <span
              aria-hidden="true"
              className={`absolute -left-[5px] mt-1.5 h-[9px] w-[9px] rounded-full border-2 border-[var(--paper-lift)] ${TONE_DOT[tone]}`}
            />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="text-sm font-bold text-[var(--ink)]">{eventLabel(e.type, t)}</p>
              <span className="serial text-[11px] text-[var(--ink-6)]">
                {t('web.trace.entryNo', 'Entry {n}', { n: e.seq })} · {actorLabel(e.actorType, t)} · {dateTime(e.createdAt)}
              </span>
            </div>
            {details.length > 0 && (
              <p className="mt-0.5 max-w-2xl text-[11px] text-[var(--ink-6)]">{details.join(' · ')}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function TracePage() {
  const { t } = useT();
  const { id } = useParams<{ id: string }>();
  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ['trace', id],
    queryFn: () => api<{ events: TraceEvent[] }>(`/api/lots/${id}/trace`),
    refetchInterval: POLL.active,
  });
  if (!data) return <LoadGate isError={isError} retrying={isFetching} onRetry={() => void refetch()} label={t('web.trace.loadLabel', 'this lot’s history')} />;
  const n = data.events.length;

  return (
    <div>
      <h1 className="headline text-3xl text-[var(--ink)] sm:text-4xl">
        {t('web.trace.title', 'History of this lot')}
      </h1>
      <p className="mb-4 mt-1 max-w-2xl text-sm text-[var(--ink-6)]">
        {t(
          'web.trace.subtitle',
          'Every step from farm to buyer, written down as it happened. No one can change or delete an entry.',
        )}
      </p>

      <Card title={`${t('web.trace.progressTitle', 'Progress')} — ${t('web.trace.progressSub', 'from listing to payment')}`}>
        <SpineStepper events={data.events} />
      </Card>

      <Card
        title={`${t('web.trace.stepsTitle', 'Every step')} — ${
          n === 1 ? t('web.trace.entryOne', '1 entry') : t('web.trace.entryMany', '{n} entries', { n })
        }`}
      >
        <TraceEventLog events={data.events} />
      </Card>
    </div>
  );
}
