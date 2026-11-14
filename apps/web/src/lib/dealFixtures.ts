/**
 * Sample deals for designing the deal page before GET /api/deals/:id exists.
 * Loaded only in development, and only from /deals/:id?sample=<name>; never
 * part of a production build's initial code.
 */
import type { DealEvent, DealView } from './deal';

const H = 3_600_000;
const now = Date.now();
const at = (hoursAgo: number) => now - hoursAgo * H;

const people: DealView['people'] = {
  farmer: { name: 'Ama Atinga', district: 'Garu', region: 'Upper East', phone: '+233208643699', locale: 'kus' },
  buyer: { name: 'Kofi Mensah', company: 'Accra Fresh Markets', phone: '+233555000123' },
  driver: { name: 'Kwame Asare', vehicle: '1.5T truck', phone: '+233548643699' },
};

const deal: DealView['deal'] = {
  id: 'sample-deal',
  state: 'FUNDS_HELD',
  lotId: 'sample-lot',
  lotCode: 'FTM-96WC',
  crop: { code: 'MAIZE', name: 'Maize' },
  quantityKg: 500,
  unit: { code: 'BAG_50KG', name: '50kg bag', qty: 10 },
  pricePerKg: 400,
  total: 200_000,
  declaredGrade: 'B',
  finalGrade: null,
  createdAt: at(52),
};

const ev = (id: string, hoursAgo: number, kind: DealEvent['kind'], actor: DealEvent['actor'], channel: DealEvent['channel'], data: DealEvent['data'] = {}): DealEvent => ({
  id,
  at: at(hoursAgo),
  kind,
  actor,
  channel,
  data,
});

const path: DealEvent[] = [
  ev('e1', 52, 'offer_made', 'buyer', 'web', { pricePerKg: 380, kg: 500 }),
  ev('e2', 51.9, 'notice_sent', 'system', 'voice', { to: 'farmer', locale: 'kus', status: 'sent' }),
  ev('e3', 50, 'countered', 'farmer', 'voice', { pricePerKg: 420 }),
  ev('e4', 49, 'offer_made', 'buyer', 'web', { pricePerKg: 400, kg: 500 }),
  ev('e5', 47, 'accepted', 'farmer', 'ussd'),
  ev('e6', 47, 'funds_held', 'system', null, { amount: 200_000 }),
  ev('e7', 46, 'driver_assigned', 'driver', 'web'),
  ev('e8', 30, 'at_pickup', 'driver', 'web'),
  ev('e9', 29.5, 'graded', 'system', null, { grade: 'B' }),
  ev('e10', 29.4, 'advance_paid', 'system', null, { amount: 60_000 }),
  ev('e11', 29.4, 'notice_sent', 'system', 'sms', { to: 'farmer', locale: 'kus', status: 'sent' }),
  ev('e12', 28, 'departed', 'driver', 'web'),
  ev('e13', 6, 'arrived', 'driver', 'web'),
  ev('e14', 6, 'notice_sent', 'system', 'sms', { to: 'buyer', status: 'sent' }),
];
const upTo = (id: string) => path.slice(0, path.findIndex((e) => e.id === id) + 1);

const money = (over: Partial<NonNullable<DealView['money']>>): NonNullable<DealView['money']> => ({
  total: 200_000,
  advance: 60_000,
  paidToFarmer: 0,
  onTheWay: 0,
  stillHeld: 200_000,
  deduction: 0,
  receiptDueAt: null,
  deliveredAt: null,
  receivedAt: null,
  ...over,
});

export const DEAL_SAMPLES: Record<string, DealView> = {
  // The buyer, the produce at their door: confirm, or report a problem.
  arrived: {
    viewer: 'buyer',
    deal: { ...deal, state: 'DELIVERED', finalGrade: 'B' },
    people,
    transport: null,
    money: money({ paidToFarmer: 60_000, stillHeld: 140_000, deliveredAt: at(6), receiptDueAt: now + 18 * H }),
    claims: [],
    next: { actor: 'buyer', action: 'confirm_receipt', dueAt: now + 18 * H },
    timeline: upTo('e14'),
  },
  // The farmer, a claim to answer.
  claim: {
    viewer: 'farmer',
    deal: { ...deal, state: 'CLAIMED', finalGrade: 'B' },
    people,
    transport: null,
    money: money({ paidToFarmer: 60_000, stillHeld: 140_000, deliveredAt: at(6), receiptDueAt: now + 18 * H }),
    claims: [
      {
        id: 'c1',
        reason: 'short_weight',
        note: 'Two bags were light. We weighed 460 kg.',
        proposedDeduction: 16_000,
        status: 'awaiting_farmer',
        farmerAnswer: null,
        answerDueAt: now + 20 * H,
        finalDeduction: null,
        createdAt: at(2),
      },
    ],
    next: { actor: 'farmer', action: 'answer_claim', dueAt: now + 20 * H, ref: 'c1' },
    timeline: [
      ...upTo('e14'),
      ev('e15', 2, 'claim_opened', 'buyer', 'web', { reason: 'short_weight', deduction: 16_000, note: 'Two bags were light. We weighed 460 kg.' }),
      ev('e16', 1.9, 'notice_sent', 'system', 'voice', { to: 'farmer', locale: 'kus', status: 'sent' }),
    ],
  },
  // The driver, money held, on the way to the farm.
  pickup: {
    viewer: 'driver',
    people,
    deal: { ...deal, state: 'FUNDS_HELD', pricePerKg: null, total: null },
    money: null,
    transport: { jobId: 'sample-job', jobCode: 'DLV-NXCT', state: 'FUNDS_HELD', fee: 80_480 },
    claims: [],
    next: { actor: 'driver', action: 'go_to_pickup', dueAt: null, ref: 'sample-job' },
    timeline: upTo('e7'),
  },
  // The buyer, waiting while the truck is on the road.
  road: {
    viewer: 'buyer',
    deal: { ...deal, state: 'GRADED', finalGrade: 'B' },
    people,
    transport: null,
    money: money({ paidToFarmer: 60_000, stillHeld: 140_000 }),
    claims: [],
    next: { actor: 'driver', action: 'deliver', dueAt: null, ref: 'sample-job' },
    timeline: upTo('e12'),
  },
  // The farmer, everything paid.
  settled: {
    viewer: 'farmer',
    deal: { ...deal, state: 'SETTLED', finalGrade: 'B' },
    people,
    transport: null,
    money: money({ paidToFarmer: 184_000, deduction: 16_000, stillHeld: 0, deliveredAt: at(30), receivedAt: at(20) }),
    claims: [
      {
        id: 'c1',
        reason: 'short_weight',
        note: 'Two bags were light. We weighed 460 kg.',
        proposedDeduction: 16_000,
        status: 'accepted',
        farmerAnswer: 'accepted',
        answerDueAt: null,
        finalDeduction: 16_000,
        createdAt: at(26),
      },
    ],
    next: null,
    timeline: [
      ...upTo('e14').map((e) => ({ ...e, at: e.at - 24 * H })),
      ev('e15', 26, 'claim_opened', 'buyer', 'web', { reason: 'short_weight', deduction: 16_000 }),
      ev('e16', 22, 'claim_answered', 'farmer', 'voice', { answer: 'accepted' }),
      ev('e17', 22, 'received', 'buyer', 'web'),
      ev('e18', 21.9, 'balance_paid', 'system', null, { amount: 124_000 }),
      ev('e19', 21.9, 'driver_paid', 'system', null, { amount: 80_480 }),
      ev('e20', 21.9, 'settled', 'system', null),
    ],
  },
};
