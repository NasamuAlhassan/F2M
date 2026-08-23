/**
 * The one-lot demo: drives the ENTIRE spine — now including the voice-call
 * accept and the middle-mile transport leg — through the real HTTP surfaces
 * (USSD webhook, IVR voice wire, REST API) via fastify.inject. Zero network.
 *
 *   npm run demo                  # offline: mock grading/payments/voice
 *   GRADING_PROVIDER=hf ...       # same script against real providers
 *
 * Exits 0 only if the contract reaches SETTLED **and** the delivery job
 * reaches PAID with balanced books and both escrows at zero.
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
  getDriverByPhone,
  getFarmerByPhone,
  getJob,
  getTrace,
  jobEscrowBalance,
  listContractsForFarmer,
  listLotsByFarmer,
  listNotificationsForPhone,
  listVoiceCallsForPhone,
  placePendingVoiceCalls,
  pollPaymentsOnce,
  runMigrations,
  schema,
  sendPendingNotifications,
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
  step('List — 10 bags of maize, sold in the unit she actually uses');
  const sell = ussdSession(phone);
  await sell();
  await sell('1'); // Sell produce
  await sell('1'); // Maize
  await sell('2'); // 50kg bag
  await sell('10'); // 10 bags = 500kg canonical
  await sell('2'); // Grade B self-assessment
  await sell('1'); // ready now
  const listed = await sell('1');
  if (!listed.startsWith('END Lot FTM-')) fail(`lot listing failed: ${listed}`);
  detail(listed.replace('END ', ''));

  // ---- 4. DEMAND + AUTO-MATCH (web API) ----
  step('Match — buyer posts demand; the autonomous engine matches and reserves the lot');
  const { token } = await apiJson<{ token: string }>('POST', '/api/auth/login', {
    email: 'buyer@demo.ftm',
    password: 'demo-buyer-2026',
  });
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
  const offered = listContractsForFarmer(farmer.id, ['OFFERED'])[0] ?? fail('matching produced no offer');

  // ---- 5. CONTRACT — ACCEPTED BY VOICE CALL ----
  step('Contract — her phone RINGS; she hears the terms and presses 1');
  await placePendingVoiceCalls();
  const call = listVoiceCallsForPhone(farmer.phone).find((c) => c.flow === 'offer' && c.status === 'placing');
  if (!call) fail('no voice call was placed for the offer');
  const callSession = `demo-call-${attempt}`;
  const prompt = await voiceLeg(call.id, farmer.phone, callSession);
  detail(`🔊 "${spoken(prompt)}"`);
  const acceptedXml = await voiceLeg(call.id, farmer.phone, callSession, '1');
  detail(`🔊 "${spoken(acceptedXml)}"`);
  const contract = listContractsForFarmer(farmer.id, ['ACCEPTED'])[0] ?? fail('voice accept did not land');

  // ---- 6. PAY: hold ----
  step('Pay (hold) — buyer funds held in escrow before pickup');
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
  step('Trace — one append-only record: produce, voice call, transport, money');
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
  detail(
    `journals balanced: ${balanced} · contract escrow: ${formatGhs(escrow)} · job escrow: ${formatGhs(jobEscrow)} · driver payable: ${formatGhs(driverPayable)}`,
  );
  if (!balanced || escrow !== 0 || jobEscrow !== 0 || driverPayable !== job.quoteAmount) {
    fail('ledger invariant violated');
  }

  console.log(
    `\n\x1b[1m\x1b[32m✔ SETTLED + DELIVERED\x1b[0m — ${final.quantityKg}kg maize graded ${final.finalGrade}: ` +
      `farmer paid ${formatGhs(final.finalAmount ?? 0)}, driver paid ${formatGhs(job.quoteAmount)}, ` +
      `buyer refunded ${formatGhs(final.holdAmount - (final.finalAmount ?? 0))} of the produce hold.`,
  );
  console.log('Register → match → contract (by VOICE) → transport → grade → pay → trace. One basic phone each.\n');
  await app.close();
  process.exit(0);
}
