// Thin fetch client. All calls ride the Vite proxy to the Fastify API.

export interface PriceTerms {
  A: number;
  B: number;
  C: number;
  REJECT: number;
}

export interface Registries {
  commodities: Array<{
    id: string;
    code: string;
    name: string;
    category: string;
    clockType: 'storable' | 'perishable';
    clock: { offerTtlMinutes: number; maxWindowDays: number; allowsForward: boolean };
    units: Array<{ id: string; code: string; name: string; kgPerUnit: number; isInformal: boolean }>;
  }>;
  regions: Array<{ code: string; name: string }>;
  vehicleClasses: Array<{ code: string; name: string; capacityKg: number; baseFee: number; perKmRate: number }>;
}

export interface Demand {
  id: string;
  commodityId: string;
  quantityKg: number;
  remainingKg: number;
  minBand: string;
  priceTerms: PriceTerms;
  windowStart: number;
  windowEnd: number;
  regionCode: string;
  status: string;
  createdAt: number;
}

export interface MatchRow {
  id: string;
  lotId: string;
  lotCode: string;
  farmerName: string | null;
  farmerRegion: string | null;
  allocatedKg: number;
  score: number;
  breakdown: {
    quantityFit: number;
    distance: number;
    qualityBand: number;
    windowFit: number;
    farmerHistory: number;
    distanceKm: number;
  };
  status: string;
  expiresAt: number | null;
  contractId: string | null;
  contractState: string | null;
}

export interface ContractDetail {
  contract: {
    id: string;
    state: string;
    quantityKg: number;
    priceTerms: PriceTerms;
    holdAmount: number;
    finalGrade: string | null;
    finalAmount: number | null;
    disputeNote: string | null;
    createdAt: number;
    acceptedAt: number | null;
    fundedAt: number | null;
    pickupConfirmedAt: number | null;
    gradedAt: number | null;
    settledAt: number | null;
    lotId: string;
  };
  match: { score: number; expiresAt: number | null; breakdown: MatchRow['breakdown'] };
  lot: { id: string; lotCode: string; quantityKg: number; declaredBand: string; status: string };
  farmer: { id: string; name: string; phone: string; regionCode: string; district: string | null } | null;
  commodity: { code: string; name: string };
  payments: Array<{
    id: string;
    direction: string;
    provider: string;
    amount: number;
    currency: string;
    status: string;
    counterpartyMsisdn: string;
    createdAt: number;
  }>;
  ledger: Array<{ id: string; journalId: string; account: string; debit: number; credit: number; memoKey: string | null }>;
  photos: Array<{ id: string; url: string; createdAt: number }>;
  gradings: Array<{
    id: string;
    attempt: number;
    provider: string;
    model: string | null;
    gradeBand: string | null;
    confidence: number | null;
    status: string;
    reasons: Array<{ criterion: string; observation: string; bandForCriterion: string }>;
    createdAt: number;
  }>;
  trace: TraceEvent[];
}

export interface TraceEvent {
  id: string;
  seq: number;
  type: string;
  actorType: string;
  createdAt: number;
  payload: Record<string, unknown> | null;
}

export type Role = 'buyer' | 'driver';

export function getToken(): string | null {
  return localStorage.getItem('ftm_token');
}
export function getRole(): Role | null {
  return (localStorage.getItem('ftm_role') as Role | null) ?? null;
}
export function setToken(token: string | null, role: Role = 'buyer'): void {
  if (token) {
    localStorage.setItem('ftm_token', token);
    localStorage.setItem('ftm_role', role);
  } else {
    localStorage.removeItem('ftm_token');
    localStorage.removeItem('ftm_role');
  }
}

export interface JobView {
  id: string;
  jobCode: string;
  contractId: string;
  lotId: string;
  state: string;
  vehicleClassCode: string;
  vehicleClassName: string;
  distanceKm: number;
  quoteAmount: number;
  commodityCode: string;
  quantityKg: number;
  driver: { name: string; phone: string } | null;
  assignedAt: number | null;
  pickedUpAt: number | null;
  deliveredAt: number | null;
  paidAt: number | null;
  createdAt: number;
}

export interface TransportQuoteView {
  vehicleClassCode: string;
  vehicleClassName: string;
  capacityKg: number;
  baseFee: number;
  perKmRate: number;
  distanceKm: number;
  quoteAmount: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    const role = getRole();
    setToken(null);
    window.location.href = role === 'driver' ? '/driver/login' : '/login';
    throw new ApiError('Login required', 401);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: string } })?.error;
    throw new ApiError(err?.message ?? `Request failed (${res.status})`, res.status, err?.code);
  }
  return body as T;
}

export const ghs = (pesewas: number): string =>
  `GHS ${(pesewas / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const shortDate = (ms: number | null): string =>
  ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';

export const dateTime = (ms: number | null): string =>
  ms
    ? new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';
