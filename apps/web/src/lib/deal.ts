/**
 * One sale, seen by everyone in it (buyer, farmer, driver): the shape the deal
 * page draws: GET /api/deals/:id (dealNextStep() and the timeline live in
 * packages/core/src/domain/deals.ts).
 * All money is in pesewas.
 */
export type DealRole = 'buyer' | 'farmer' | 'driver';
export type DealActor = DealRole | 'f2m' | 'system';
export type DealChannel = 'web' | 'ussd' | 'voice' | 'sms' | null;

export type DealEventKind =
  | 'offer_made'
  | 'countered'
  | 'offer_reject'
  | 'offer_withdraw'
  | 'offer_expire'
  | 'accepted'
  | 'funds_held'
  | 'funding_failed'
  | 'transport_suggested'
  | 'transport_requested'
  | 'driver_assigned'
  | 'transport_funded'
  | 'transport_cancelled'
  | 'at_pickup'
  | 'loaded'
  | 'collected'
  | 'photo_added'
  | 'graded'
  | 'grade_disputed'
  | 'regraded'
  | 'advance_paid'
  | 'departed'
  | 'arrived'
  | 'delivered'
  | 'received'
  | 'auto_received'
  | 'claim_opened'
  | 'claim_answered'
  | 'claim_resolved'
  | 'balance_paid'
  | 'driver_paid'
  | 'settled'
  | 'cancelled'
  | 'refunded'
  | 'notice_sent';

export interface DealEvent {
  id: string;
  at: number;
  kind: DealEventKind;
  actor: DealActor;
  channel: DealChannel;
  /** Money keys are stripped for the driver by the server. */
  data: {
    amount?: number;
    kg?: number;
    grade?: string;
    pricePerKg?: number;
    pricePerUnit?: number;
    units?: number;
    reason?: ClaimReason;
    note?: string;
    deduction?: number;
    finalDeduction?: number;
    answer?: 'accepted' | 'refused' | string;
    /** notice_sent: who was told, in which language, and how it went. */
    to?: DealRole;
    locale?: string;
    template?: string;
    status?: string;
  };
}

export type ClaimReason = 'short_weight' | 'quality' | 'damaged' | 'late' | 'not_delivered' | 'other';

export interface DealClaim {
  id: string;
  reason: ClaimReason;
  note: string | null;
  proposedDeduction: number;
  status: 'awaiting_farmer' | 'accepted' | 'awaiting_review' | 'resolved';
  farmerAnswer: 'accepted' | 'refused' | null;
  answerDueAt: number | null;
  finalDeduction: number | null;
  createdAt: number;
}

export type NextAction =
  | 'answer_offer'
  | 'secure_payment'
  | 'arrange_pickup'
  | 'finding_driver'
  | 'retry_transport'
  | 'securing_transport'
  | 'go_to_pickup'
  | 'grade'
  | 'regrade'
  | 'review_grade'
  | 'deliver'
  | 'confirm_receipt'
  | 'answer_claim'
  | 'review_claim'
  | 'paying_balance';

export interface DealView {
  viewer: DealRole;
  deal: {
    id: string;
    state: string;
    lotId: string;
    lotCode: string;
    crop: { code: string; name: string };
    quantityKg: number;
    unit: { code: string; name: string; qty: number } | null;
    /** Null for the driver. */
    pricePerKg: number | null;
    total: number | null;
    declaredGrade: string | null;
    finalGrade: string | null;
    createdAt: number;
  };
  people: {
    farmer: { name: string; district: string | null; region: string | null; locale?: string | null; phone?: string | null };
    buyer: { name: string; company: string | null; phone?: string | null };
    driver: { name: string; vehicle: string | null; phone?: string | null } | null;
  };
  /** Absent for the driver, who sees only their own fee. */
  money: {
    total: number;
    advance: number;
    paidToFarmer: number;
    onTheWay: number;
    stillHeld: number;
    deduction: number;
    receiptDueAt: number | null;
    deliveredAt: number | null;
    receivedAt: number | null;
  } | null;
  transport: { jobId: string; jobCode: string; state: string; fee?: number | null } | null;
  claims: DealClaim[];
  photos?: Array<{ id: string; url: string }>;
  next: { actor: DealActor; action: NextAction; dueAt: number | null; ref?: string } | null;
  timeline: DealEvent[];
}

/** The usual path of a sale, used to show the steps still ahead. */
export const DEAL_PATH: DealEventKind[] = [
  'accepted',
  'funds_held',
  'driver_assigned',
  'at_pickup',
  'graded',
  'advance_paid',
  'departed',
  'arrived',
  'received',
  'balance_paid',
];

/** The languages F2M speaks, by the locale codes the server sends. */
export const LANGUAGE_NAME: Record<string, string> = {
  en: 'English',
  tw: 'Twi',
  ee: 'Eʋegbe',
  dag: 'Dagbanli',
  ha: 'Hausa',
  kus: 'Kusaal',
};

/** "Ama Atinga" → "Ama"; a company stays whole. */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** A deadline as people say it: "tomorrow 15:00", with "in 18 hours" beside
 *  it, and whether it is close (under an hour) or gone. */
export function deadline(at: number, now = Date.now()): { when: string; left: string; soon: boolean; past: boolean } {
  const d = new Date(at);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const day = new Date(now);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const tomorrow = new Date(now + 86_400_000);
  const when = sameDay(d, day)
    ? `today ${time}`
    : sameDay(d, tomorrow)
      ? `tomorrow ${time}`
      : `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
  const ms = at - now;
  return { when, left: dueIn(at, now), soon: ms > 0 && ms < 3_600_000, past: ms <= 0 };
}

/** A short, human span until a deadline: "in 18 hours", "by Fri 10:00". */
export function dueIn(at: number, now = Date.now()): string {
  const ms = at - now;
  if (ms <= 0) return 'now';
  const h = Math.round(ms / 3_600_000);
  if (h < 1) return `in ${Math.max(1, Math.round(ms / 60_000))} minutes`;
  if (h < 24) return `in ${h} hour${h === 1 ? '' : 's'}`;
  return `by ${new Date(at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
}
