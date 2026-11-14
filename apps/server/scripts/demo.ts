/**
 * The one-lot demo: drives the ENTIRE spine — the listing with her own price,
 * the engine's bid, the voice-call accept that makes the deal (Phase 1), and
 * the middle-mile transport leg — through the real HTTP surfaces (USSD
 * webhook, IVR voice wire, REST API) via fastify.inject. Zero network.
 *
 *   npm run demo                  # offline: mock grading/payments/voice
 *   GRADING_PROVIDER=hf ...       # same script against real providers
 *
 * Exits 0 only if the contract reaches SETTLED **and** the delivery job
 * reaches PAID with balanced books, both escrows at zero, and the farmer paid
 * exactly the agreed total.
 */
import crypto from 'node:crypto';
import { inArray, and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import {
  accountBalance,
  ACCOUNTS,
  addPhoto,
  allJournalsBalanced,
  config,
  contractEscrowBalance,
  contractLedger,
  db,
  formatGhs,
  getCommodityByCode,
  getContract,
  getAccountByAuthUser,
  getDriverByPhone,
  getFarmerByPhone,
  getJob,
  getLotByCode,
  getTrace,
  jobEscrowBalance,
  listContractsForFarmer,
  listLotsByFarmer,
  listNotificationsForPhone,
  listVoiceCallsForPhone,
  placePendingVoiceCalls,
  pollPaymentsOnce,
  registerAccount,
  runMigrations,
  schema,
  sendPendingNotifications,
  setTokenVerifier,
} from '@ftm/core';
import { buildServer } from '../src/app';

const MAX_GRADE_ATTEMPTS = 3; // a REJECT verdict retries with a fresh lot — honestly reported

function step(title: string): void {
  console.log(`\n\x1b[1m\x1b[32m▶ ${title}\x1b[0m`);
}
function detail(text: string): void {
  console.log(`  ${text}`);
}
function fail(message: string): never {
  console.error(`\n\x1b[31m✖ ${message}\x1b[0m`);
  process.exit(1);
}
async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

runMigrations();
const app = await buildServer({ logger: false });

// The demo buyer signs in the way every web user does (D-047) — a Supabase
// login linked to a buyer profile — except the login is local and demo-only:
// this offline script cannot reach Supabase, so it trusts exactly one token of
// its own. It never runs inside the server process.
const DEMO_BUYER_PHONE = '+233555000123';
const DEMO_LOGIN = { authUserId: 'demo-script-buyer', phone: DEMO_BUYER_PHONE.slice(1) };
const DEMO_TOKEN = 'demo-script-token';
setTokenVerifier(async (t) => {
  if (t !== DEMO_TOKEN) throw new Error('not the demo token');
  return DEMO_LOGIN;
});
if (!getAccountByAuthUser(DEMO_LOGIN.authUserId)) {
  registerAccount({
    ...DEMO_LOGIN,
    role: 'buyer',
    name: 'Adjoa Mensah',
    company: 'Accra Fresh Markets Ltd',
    regionCode: 'GREATER_ACCRA',
  });
}

// ---- USSD wire: the Africa's Talking webhook format at POST /ussd ----
function ussdSession(phone: string) {
  const sessionId = `demo-${crypto.randomUUID().slice(0, 8)}`;
  const history: string[] = [];
  return async (input?: string): Promise<string> => {
    if (input !== undefined) history.push(input);
    const res = await app.inject({
      method: 'POST',
      url: '/ussd',
      payload: new URLSearchParams({ sessionId, phoneNumber: phone, text: history.join('*') }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    // Once a catalog is reviewed (D-040), new callers pick a language first —
    // the demo answers "1. English" so its scripted digits keep working.
    if (input === undefined && res.body.startsWith('CON Choose your language')) {
      history.push('1');
      const after = await app.inject({
        method: 'POST',
        url: '/ussd',
        payload: new URLSearchParams({ sessionId, phoneNumber: phone, text: history.join('*') }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      return after.body;
    }
    return res.body;
  };
}

// ---- Voice wire: the AT Voice callback format at POST /voice/answer ----
async function voiceLeg(callId: string, phone: string, sessionId: string, dtmfDigits?: string): Promise<string> {
  const body = new URLSearchParams({ sessionId, isActive: '1', callerNumber: phone });
  if (dtmfDigits !== undefined) body.set('dtmfDigits', dtmfDigits);
  const res = await app.inject({
    method: 'POST',
    url: `/voice/answer?callId=${callId}`,
    payload: body.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  return res.body;
}
function spoken(xml: string): string {
  return /<Say[^>]*>([\s\S]*?)<\/Say>/.exec(xml)?.[1] ?? xml;
}

async function apiJson<T>(method: 'GET' | 'POST', url: string, body?: unknown, token?: string): Promise<T> {
  const res = await app.inject({
    method,
    url,
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.statusCode >= 400) fail(`${method} ${url} → ${res.statusCode}: ${res.body}`);
  return res.json() as T;
}

/** Golden-noise JPEG — a fresh random texture per call so retries re-roll the mock grader. */
async function pickupPhoto(): Promise<Buffer> {
  const w = 1200;
  const h = 900;
  const noise = crypto.randomBytes(w * h * 3);
  for (let i = 0; i < noise.length; i += 3) {
    const v = 150 + (noise[i]! % 90);
    noise[i] = Math.min(255, v + 40);
    noise[i + 1] = v;
    noise[i + 2] = 40 + (noise[i + 2]! % 40);
  }
  return sharp(noise, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 88 }).toBuffer();
}

/** The keypress that selects this lot on the USSD "My lots" screen (same query, same order). */
function lotKeypress(farmerId: string, lotId: string): string {
  const idx = listLotsByFarmer(farmerId)
    .slice(0, 5)
    .findIndex((l) => l.id === lotId);
  if (idx === -1) fail('contract lot not visible on the USSD lots screen');
  return String(idx + 1);
}

async function waitFor(label: string, predicate: () => boolean, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await pollPaymentsOnce();
    if (predicate()) return;
    await sleep(400);
  }
  fail(`Timed out waiting for: ${label}`);
}

console.log('\x1b[1mFarm to Market — one lot, end to end (voice + transport edition)\x1b[0m');
detail(
  `grading: ${config.GRADING_PROVIDER} · payments: ${config.PAYMENT_PROVIDER} · voice: ${config.VOICE_PROVIDER} · sms: ${config.NOTIFY_PROVIDER}`,
);

// Fresh actors per run; avoid the mock provider's magic ...0000/...0001 endings.
let suffix = String(Math.floor(Math.random() * 900_000) + 100_000);
if (suffix.endsWith('0000') || suffix.endsWith('0001')) suffix = suffix.slice(0, -1) + '7';
const phone = `+23320${suffix}9`;
const driverPhone = `+23354${suffix}9`;

for (let attempt = 1; attempt <= MAX_GRADE_ATTEMPTS; attempt++) {
  // Dev-DB janitor: lingering open maize demands / restored lots / busy drivers
  // from earlier runs (or a REJECT retry) would divert matching and dispatch.
  const maize = getCommodityByCode('MAIZE');
  db.update(schema.demands)
    .set({ status: 'cancelled' })
    .where(and(eq(schema.demands.commodityId, maize.id), inArray(schema.demands.status, ['open', 'partially_matched'])))
    .run();
  db.update(schema.lots)
    .set({ status: 'withdrawn' })
    .where(and(eq(schema.lots.commodityId, maize.id), eq(schema.lots.status, 'registered')))
    .run();
  db.update(schema.drivers).set({ active: false }).where(eq(schema.drivers.active, true)).run();
  // Orphaned jobs from a REJECT retry (goods rejected mid-flow) — parked crudely; dev DB only.
  db.update(schema.deliveryJobs)
    .set({ state: 'CANCELLED' })
    .where(inArray(schema.deliveryJobs.state, ['REQUESTED', 'NO_DRIVER', 'ASSIGNED', 'FUNDS_HELD', 'PICKED_UP', 'DELIVERED']))
    .run();

  // ---- 1. REGISTER FARMER (USSD) ----
  step(`Register — farmer dials in on a basic phone (${phone})`);
  if (!getFarmerByPhone(phone)) {
    const dial = ussdSession(phone);
    await dial();
    await dial('1'); // Register as a farmer
    await dial('Adwoa Demo');
    await dial('2'); // ASHANTI (page 1, item 2)
    await dial('Ejura');
    const done = await dial('1');
    if (!done.startsWith('END Welcome')) fail(`registration failed: ${done}`);
    detail(done.replace('END ', ''));
  } else {
    detail('already registered from a previous attempt — dialing straight in');
  }
  const farmer = getFarmerByPhone(phone)!;

  // ---- 2. REGISTER DRIVER (USSD) ----
  step(`Register — a tricycle-to-truck driver dials the same code (${driverPhone})`);
  if (!getDriverByPhone(driverPhone)) {
    const dial = ussdSession(driverPhone);
    await dial();
    await dial('2'); // Register as a driver
    await dial('Kwame Wheels');
    await dial('2'); // ASHANTI — near the pickup
    await dial('2'); // Van (1500kg — carries the 500kg lot)
    await dial('4321'); // PIN for jobs + web login
    const done = await dial('1');
    if (!done.startsWith('END Welcome')) fail(`driver registration failed: ${done}`);
    detail(done.replace('END ', ''));
  } else {
    detail('driver already registered from a previous attempt');
  }
  const driver = getDriverByPhone(driverPhone)!;
  db.update(schema.drivers).set({ active: true }).where(eq(schema.drivers.id, driver.id)).run();

  // ---- 3. LIST A LOT (USSD) ----
  step('List — 10 bags of maize, in the unit she actually uses, at her own price');
  const sell = ussdSession(phone);
  await sell();
  await sell('1'); // Sell produce
  await sell('1'); // Maize
  await sell('2'); // 50kg bag
  await sell('10'); // 10 bags = 500kg canonical
  await sell('2'); // Grade B self-assessment
  await sell('1'); // ready now
  const confirm = await sell('210'); // her asking price: GHS 210 a bag (Phase 1 price step)
  detail(confirm.replace('CON ', '').split('\n')[0]!);
  const listed = await sell('1');
  if (!listed.startsWith('END Lot FTM-')) fail(`lot listing failed: ${listed}`);
  detail(listed.replace('END ', ''));
  const lotCode = /Lot (FTM-\S+) listed/.exec(listed)?.[1] ?? fail('no lot code in the listing receipt');

  // ---- 4. DEMAND + AUTO-MATCH (web API) ----
  step('Match — buyer posts a request; the engine turns it into a bid on her listing');
  const token = DEMO_TOKEN;
  const now = Date.now();
  const { demand } = await apiJson<{ demand: { id: string; status: string; remainingKg: number } }>(
    'POST',
    '/api/demands',
    {
      commodityCode: 'MAIZE',
      quantityKg: 500,
      minBand: 'B',
      basePricePerKg: 400,
      windowStart: now,
      windowEnd: now + 5 * 24 * 60 * 60 * 1000,
      regionCode: 'GREATER_ACCRA',
    },
    token,
  );
  detail(`demand ${demand.id.slice(0, 8)} status=${demand.status} remaining=${demand.remainingKg}kg`);
  // Phase 1: a match is an offer thread waiting on the farmer — no contract until she accepts.
  interface OfferView {
    id: string;
    turn: string | null;
    lot: { lotCode: string };
    current: { units: number; pricePerUnit: number; total: number };
    contractId: string | null;
  }
  const { offers } = await apiJson<{ offers: OfferView[] }>('GET', '/api/offers?status=open', undefined, token);
  const bid = offers.find((o) => o.lot.lotCode === lotCode && o.turn === 'farmer') ?? fail('matching produced no bid on her listing');
  const lotId = getLotByCode(lotCode)?.id ?? fail(`lot ${lotCode} not found`);
  if (listContractsForFarmer(farmer.id).some((c) => c.lotId === lotId)) fail('a contract exists before the farmer accepted');
  detail(
    `bid: ${bid.current.units} bags at ${formatGhs(bid.current.pricePerUnit)} each (${formatGhs(bid.current.total)}) — ` +
      `the request's grade-B price, under her GHS 210.00 ask; she can accept, counter or reject`,
  );

  // ---- 5. DEAL — ACCEPTED BY VOICE CALL ----
  step('Deal — her phone RINGS; she hears the bid and presses 1');
  await placePendingVoiceCalls();
  const call = listVoiceCallsForPhone(farmer.phone).find((c) => c.flow === 'bid' && c.offerId === bid.id && c.status === 'placing');
  if (!call) fail('no voice call was placed for the bid');
  const callSession = `demo-call-${attempt}`;
  const prompt = await voiceLeg(call.id, farmer.phone, callSession);
  detail(`🔊 "${spoken(prompt)}"`);
  const acceptedXml = await voiceLeg(call.id, farmer.phone, callSession, '1');
  detail(`🔊 "${spoken(acceptedXml)}"`);
  const { offer: agreedOffer } = await apiJson<{ offer: OfferView }>('GET', `/api/offers/${bid.id}`, undefined, token);
  if (!agreedOffer.contractId) fail('voice accept did not land');
  const contract = getContract(agreedOffer.contractId);
  if (contract.state !== 'ACCEPTED' || contract.agreedTotal !== bid.current.total || contract.holdAmount !== bid.current.total) {
    fail(`the order does not carry the agreed total: ${contract.state} hold=${contract.holdAmount} agreed=${contract.agreedTotal}`);
  }
  detail(`contract ${contract.id.slice(0, 8)} ACCEPTED — agreed total ${formatGhs(contract.agreedTotal!)}`);

  // ---- 6. PAY: hold ----
  step('Pay (hold) — the agreed total is held in escrow before pickup');
  await waitFor('FUNDS_HELD', () => getContract(contract.id).state === 'FUNDS_HELD');
  detail(`escrow: ${formatGhs(contractEscrowBalance(contract.id))} (hold ${formatGhs(contract.holdAmount)})`);

  // ---- 7. TRANSPORT — the middle-mile bridge ----
  step('Transport — buyer requests a verified pickup; the nearest van driver gets the job');
  const { job } = await apiJson<{ job: { id: string; jobCode: string; quoteAmount: number; distanceKm: number } }>(
    'POST',
    `/api/contracts/${contract.id}/transport`,
    {},
    token,
  );
  detail(`job ${job.jobCode}: ${job.distanceKm}km, fee ${formatGhs(job.quoteAmount)} (rate card, frozen upfront)`);

  const drive = ussdSession(driverPhone);
  await drive();
  await drive('1'); // Job offers
  await drive('1'); // this job
  const jobAccepted = await drive('1'); // Accept
  if (!jobAccepted.startsWith('END Job DLV-')) fail(`driver accept failed: ${jobAccepted}`);
  detail(jobAccepted.replace('END ', ''));
  await waitFor('job fee escrowed', () => getJob(job.id).state === 'FUNDS_HELD');
  detail(`transport escrow: ${formatGhs(jobEscrowBalance(job.id))}`);

  const loaded = ussdSession(driverPhone);
  await loaded();
  await loaded('2'); // My job
  const pickupDone = await loaded('1'); // Confirm goods loaded
  if (!pickupDone.startsWith('END Job DLV-')) fail(`driver pickup failed: ${pickupDone}`);
  detail(`${pickupDone.replace('END ', '')} (produce contract pickup auto-confirmed)`);
  if (getContract(contract.id).state !== 'PICKUP_CONFIRMED') fail('driver pickup did not confirm the contract');

  // ---- 8. GRADE ----
  step(`Grade — photo at pickup, scored against the maize rubric (${config.GRADING_PROVIDER})`);
  await addPhoto({ contractId: contract.id, buffer: await pickupPhoto(), actor: { type: 'buyer', id: contract.buyerId } });
  const graded = await apiJson<{ grading: { gradeBand: string; confidence: number } }>(
    'POST',
    `/api/contracts/${contract.id}/grade`,
    {},
    token,
  );
  detail(`grade: ${graded.grading.gradeBand} (confidence ${(graded.grading.confidence * 100).toFixed(0)}%)`);

  if (graded.grading.gradeBand === 'REJECT') {
    detail(`REJECT → hold refunded in full, lot back on the market (state ${getContract(contract.id).state}).`);
    if (attempt === MAX_GRADE_ATTEMPTS) fail('grader returned REJECT on every attempt');
    detail(`retrying the happy path with a fresh photo (attempt ${attempt + 1}/${MAX_GRADE_ATTEMPTS})…`);
    continue;
  }

  // ---- 9. RELEASE — farmer agrees on USSD; buyer confirms delivery ----
  step('Pay (release) — she sees the grade AND the reason, and agrees; buyer confirms delivery');
  const agree = ussdSession(phone);
  await agree();
  await agree('3');
  const gradeScreen = await agree(lotKeypress(farmer.id, contract.lotId));
  for (const line of gradeScreen.replace('CON ', '').split('\n').slice(1, 3)) detail(line);
  const agreed = await agree('1');
  if (!agreed.startsWith('END Thank you')) fail(`agree failed: ${agreed}`);

  await apiJson('POST', `/api/jobs/${job.id}/deliver`, {}, token);
  await waitFor('contract SETTLED', () => getContract(contract.id).state === 'SETTLED');
  await waitFor('driver PAID', () => getJob(job.id).state === 'PAID');

  // ---- 10. TRACE + SMS + LEDGER ----
  const final = getContract(contract.id);
  // No "voice call" here: finishVoiceCall only traces calls tied to a contract,
  // and a Phase 1 bid call is tied to the offer thread — so it is not on the trace (yet).
  step('Trace — one append-only record: produce, deal, transport, money');
  for (const e of getTrace(final.lotId)) {
    console.log(`  #${String(e.seq).padStart(2)} ${e.type.padEnd(20)} ${e.actorType}`);
  }

  step('SMS — farmer and driver each got the whole story');
  await sendPendingNotifications();
  for (const n of listNotificationsForPhone(farmer.phone, 6).reverse()) console.log(`  [farmer] ${n.message}`);
  for (const n of listNotificationsForPhone(driverPhone, 4).reverse()) console.log(`  [driver] ${n.message}`);

  step('Ledger — produce and transport money in one book, every journal zero-sum');
  for (const l of contractLedger(final.id)) {
    const side = l.debit ? `DR ${formatGhs(l.debit)}` : `CR ${formatGhs(l.credit)}`;
    console.log(`  ${l.account.padEnd(52)} ${side.padStart(15)}  ${l.memoKey ?? ''}`);
  }
  const balanced = allJournalsBalanced();
  const escrow = contractEscrowBalance(final.id);
  const jobEscrow = jobEscrowBalance(job.id);
  const driverPayable = accountBalance(ACCOUNTS.driverPayable(driver.id));
  // Phase 1: an agreed deal pays its agreed total whatever the grade, so the whole
  // hold goes to the farmer and no grade-difference refund line is posted.
  const remainderRefunded = contractLedger(final.id).some((l) => l.memoKey === 'ledger.refundRemainder');
  detail(
    `journals balanced: ${balanced} · contract escrow: ${formatGhs(escrow)} · job escrow: ${formatGhs(jobEscrow)} · ` +
      `driver payable: ${formatGhs(driverPayable)} · grade-difference refund: ${remainderRefunded ? 'yes' : 'none'}`,
  );
  if (!balanced || escrow !== 0 || jobEscrow !== 0 || driverPayable !== job.quoteAmount) {
    fail('ledger invariant violated');
  }
  if (final.finalAmount !== final.agreedTotal || final.finalAmount !== final.holdAmount || remainderRefunded) {
    fail(`the farmer was not paid the agreed total: paid ${final.finalAmount}, agreed ${final.agreedTotal}, held ${final.holdAmount}`);
  }

  console.log(
    `\n\x1b[1m\x1b[32m✔ SETTLED + DELIVERED\x1b[0m — ${final.quantityKg}kg maize graded ${final.finalGrade}: ` +
      `farmer paid the agreed ${formatGhs(final.finalAmount ?? 0)}, driver paid ${formatGhs(job.quoteAmount)}, ` +
      `both escrows empty.`,
  );
  console.log('Register → list at her price → bid → deal (by VOICE) → transport → grade → pay → trace. One basic phone each.\n');
  await app.close();
  process.exit(0);
}
