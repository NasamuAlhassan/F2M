/**
 * The one-lot demo: drives the ENTIRE transaction spine through the real HTTP
 * surfaces (USSD webhook + REST API via fastify.inject — zero network, no port
 * clash with a running dev server) and prints the trace + balanced ledger.
 *
 *   npm run demo                  # offline: mock grading + mock payments
 *   GRADING_PROVIDER=hf ...       # same script against real providers
 *
 * Exits 0 only if the lot reaches SETTLED with a balanced ledger.
 */
import crypto from 'node:crypto';
import { inArray, and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import {
  addPhoto,
  allJournalsBalanced,
  config,
  contractEscrowBalance,
  contractLedger,
  db,
  formatGhs,
  getCommodityByCode,
  getContract,
  getFarmerByPhone,
  getTrace,
  listContractsForFarmer,
  listLotsByFarmer,
  listNotificationsForPhone,
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

// ---- USSD driver: speaks the Africa's Talking wire format at POST /ussd ----
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

async function waitFor(label: string, predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await pollPaymentsOnce();
    if (predicate()) return;
    await sleep(400);
  }
  fail(`Timed out waiting for: ${label}`);
}

console.log('\x1b[1mFarm to Market — one lot, end to end\x1b[0m');
detail(`grading provider: ${config.GRADING_PROVIDER} · payment provider: ${config.PAYMENT_PROVIDER}`);

// Fresh farmer per run; avoid the mock provider's magic ...0000/...0001 endings.
let suffix = String(Math.floor(Math.random() * 900_000) + 100_000);
if (suffix.endsWith('0000') || suffix.endsWith('0001')) suffix = suffix.slice(0, -1) + '7';
const phone = `+23320${suffix}9`;

for (let attempt = 1; attempt <= MAX_GRADE_ATTEMPTS; attempt++) {
  // Janitor: lingering open maize demands (earlier runs, or a refunded attempt
  // reviving its demand) would grab the new lot at registration.
  const maize = getCommodityByCode('MAIZE');
  const stale = db
    .update(schema.demands)
    .set({ status: 'cancelled' })
    .where(and(eq(schema.demands.commodityId, maize.id), inArray(schema.demands.status, ['open', 'partially_matched'])))
    .run();
  // Also park leftover registered maize lots (a refunded attempt restores its
  // lot) — identical lots tie in scoring and the offer could land on the old one.
  const parked = db
    .update(schema.lots)
    .set({ status: 'withdrawn' })
    .where(and(eq(schema.lots.commodityId, maize.id), eq(schema.lots.status, 'registered')))
    .run();
  if (stale.changes + parked.changes > 0) {
    detail(`(cleaned up ${stale.changes} open maize demand(s), parked ${parked.changes} leftover lot(s))`);
  }

  // ---- 1. REGISTER (USSD) ----
  step(`Register — farmer dials in on a basic phone (${phone})`);
  if (!getFarmerByPhone(phone)) {
    const dial = ussdSession(phone);
    await dial();
    await dial('1'); // Register
    await dial('Adwoa Demo');
    await dial('2'); // ASHANTI (page 1, item 2)
    await dial('Ejura');
    const done = await dial('1'); // confirm
    if (!done.startsWith('END Welcome')) fail(`registration failed: ${done}`);
    detail(done.replace('END ', ''));
  } else {
    detail('already registered from a previous attempt — dialing straight in');
  }
  const farmer = getFarmerByPhone(phone)!;

  // ---- 2. LIST A LOT (USSD) ----
  step('List — 10 bags of maize, sold in the unit she actually uses');
  const sell = ussdSession(phone);
  await sell();
  await sell('1'); // Sell produce
  await sell('1'); // Maize
  await sell('2'); // 50kg bag (units listed alphabetically: BAG_100KG, BAG_50KG, OLONKA)
  await sell('10'); // 10 bags = 500kg canonical
  await sell('2'); // Grade B self-assessment
  await sell('1'); // ready now
  const listed = await sell('1'); // confirm
  if (!listed.startsWith('END Lot FTM-')) fail(`lot listing failed: ${listed}`);
  detail(listed.replace('END ', ''));

  // ---- 3. DEMAND + MATCH (web API) ----
  step('Match — buyer posts demand; matching runs the moment it lands');
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
      basePricePerKg: 400, // GHS 4.00/kg for band B → A 4.55, C 3.18
      windowStart: now,
      windowEnd: now + 5 * 24 * 60 * 60 * 1000,
      regionCode: 'GREATER_ACCRA',
    },
    token,
  );
  detail(`demand ${demand.id.slice(0, 8)} status=${demand.status} remaining=${demand.remainingKg}kg`);
  const offered = listContractsForFarmer(farmer.id, ['OFFERED']);
  if (offered.length === 0) fail('matching produced no offer for the demo farmer');

  // ---- 4. CONTRACT (USSD accept, price-per-grade on screen) ----
  step('Contract — the offer she accepts is a full price schedule, not one number');
  const offers = ussdSession(phone);
  await offers();
  await offers('2'); // My offers
  const detailScreen = await offers('1');
  for (const line of detailScreen.replace('CON ', '').split('\n').slice(0, 4)) detail(line);
  const accepted = await offers('1'); // Accept
  if (!accepted.startsWith('END Accepted')) fail(`accept failed: ${accepted}`);
  detail(accepted.replace('END ', ''));
  const contract = listContractsForFarmer(farmer.id, ['ACCEPTED'])[0] ?? fail('no accepted contract found');

  // ---- 5. PAY: hold ----
  step('Pay (hold) — buyer funds held in escrow before pickup');
  await waitFor('FUNDS_HELD', () => getContract(contract.id).state === 'FUNDS_HELD', 60_000);
  detail(`escrow balance: ${formatGhs(contractEscrowBalance(contract.id))} (hold ${formatGhs(contract.holdAmount)})`);

  // ---- 6. GRADE ----
  step(`Grade — photo at pickup, scored against the maize rubric (${config.GRADING_PROVIDER})`);
  await addPhoto({ contractId: contract.id, buffer: await pickupPhoto(), actor: { type: 'buyer', id: contract.buyerId } });
  const pickup = ussdSession(phone);
  await pickup();
  await pickup('3'); // My lots
  await pickup(lotKeypress(farmer.id, contract.lotId)); // the contracted lot
  const confirmed = await pickup('1'); // Confirm pickup done
  if (!confirmed.startsWith('END Thank you')) fail(`pickup confirm failed: ${confirmed}`);
  const graded = await apiJson<{ grading: { gradeBand: string; confidence: number }; contract: { state: string } }>(
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

  // ---- 7. PAY: release (farmer agrees on USSD instead of waiting out the window) ----
  step('Pay (release) — she sees the grade AND the reason, and agrees');
  const agree = ussdSession(phone);
  await agree();
  await agree('3');
  const gradeScreen = await agree(lotKeypress(farmer.id, contract.lotId));
  for (const line of gradeScreen.replace('CON ', '').split('\n').slice(1, 3)) detail(line);
  const agreed = await agree('1'); // Agree — get paid now
  if (!agreed.startsWith('END Thank you')) fail(`agree failed: ${agreed}`);
  await waitFor('SETTLED', () => getContract(contract.id).state === 'SETTLED', 60_000);

  // ---- 8. TRACE + LEDGER ----
  const final = getContract(contract.id);
  step('Trace — the record the lot carries from farm to buyer');
  for (const e of getTrace(final.lotId)) {
    console.log(`  #${String(e.seq).padStart(2)} ${e.type.padEnd(18)} ${e.actorType}`);
  }

  step('SMS — every step reached her phone');
  await sendPendingNotifications();
  for (const n of listNotificationsForPhone(phone, 6).reverse()) {
    console.log(`  [${n.status}] ${n.message}`);
  }

  step('Ledger — every journal sums to zero');
  for (const l of contractLedger(final.id)) {
    const side = l.debit ? `DR ${formatGhs(l.debit)}` : `CR ${formatGhs(l.credit)}`;
    console.log(`  ${l.account.padEnd(52)} ${side.padStart(15)}  ${l.memoKey ?? ''}`);
  }
  const balanced = allJournalsBalanced();
  const escrow = contractEscrowBalance(final.id);
  detail(`journals balanced: ${balanced} · escrow at terminal state: ${formatGhs(escrow)}`);
  if (!balanced || escrow !== 0) fail('ledger invariant violated');

  console.log(
    `\n\x1b[1m\x1b[32m✔ SETTLED\x1b[0m — ${final.quantityKg}kg maize, graded ${final.finalGrade}, ` +
      `farmer paid ${formatGhs(final.finalAmount ?? 0)}, buyer refunded ${formatGhs(final.holdAmount - (final.finalAmount ?? 0))} of the hold.`,
  );
  console.log('Register → match → contract → grade → pay → trace: all six steps, one basic phone, one browser.\n');
  await app.close();
  process.exit(0);
}
