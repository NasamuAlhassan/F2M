import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api, dateTime, ghs } from '../api';
import { Glyph } from './engrave';
import { useDialog } from './Modal';
import { btnCls, btnGhostCls, BusyLabel, hitAreaCls, plateBtnCls, Stat, StateBadge, textLinkCls } from './ui';

// The AI Intent & Auto-Matching Engine's shared pieces, in the Trade
// Instrument world: a match arrives as an advice note under a gold plate.

export interface FeedLot {
  lotCode: string;
  commodityName: string;
  remainingKg: number;
  declaredBand: string;
  regionCode: string;
  readyDate: number;
  farmerName: string | null;
  createdAt: number;
}
export interface FeedDemand {
  commodityName: string;
  remainingKg: number;
  minBand: string;
  minPricePerKg: number;
  windowStart: number;
  windowEnd: number;
  regionCode: string;
  mine: boolean;
  createdAt: number;
}
export interface FeedMatch {
  contractId: string;
  state: string;
  scorePct: number | null;
  commodityName: string;
  quantityKg: number;
  bestPricePerKg: number;
  holdAmount: number;
  farmerName: string | null;
  lotCode: string | null;
  distanceKm: number | null;
  logisticsEstimate: number | null;
  createdAt: number;
}
export interface Feed {
  lots: FeedLot[];
  demands: FeedDemand[];
  matches: FeedMatch[];
  simulateEnabled: boolean;
}
export interface AlertPreview {
  locales: Array<{ code: string; label: string }>;
  locale: string;
  reviewNote: boolean;
  farmerName: string | null;
  farmerPhone: string | null;
  sms: string;
  voice: string[];
  smsStatus: string | null;
  callStatus: string | null;
}

/** Engraved score gauge — ink track, gold arc, engraved figure. */
export function ScoreRing({ pct }: { pct: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-20 w-20 flex-shrink-0">
      <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--ink-2)" strokeWidth="2" />
        <circle cx="36" cy="36" r={r - 4.5} fill="none" stroke="var(--ink-2)" strokeWidth="0.75" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke="var(--gold-deep)"
          strokeWidth="3.5"
          strokeLinecap="butt"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className="transition-[stroke-dashoffset] duration-[var(--dur-slow)] motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="display text-lg font-semibold leading-none text-[var(--ink)]">{pct}%</span>
        <span className="smallcaps text-[11px] text-[var(--ink-6)]">match</span>
      </div>
    </div>
  );
}

/** The advice of match — the engine's find, presented as a sealed notice. */
export function MatchBanner({
  match,
  simulateEnabled,
  onPreview,
  onSimulate,
  simulating,
}: {
  match: FeedMatch;
  simulateEnabled: boolean;
  onPreview: () => void;
  onSimulate: () => void;
  simulating: boolean;
}) {
  return (
    <div className="certificate seal-land mb-4 overflow-hidden bg-[var(--gold-wash)]">
      <div className="flex items-center gap-2 bg-[var(--gold)] px-5 py-2 text-[var(--ink)]">
        <span className="ember inline-block h-2 w-2 rounded-full bg-[var(--ink)]" />
        <span className="display text-xs font-semibold tracking-[0.18em]">ADVICE OF MATCH</span>
        <span className="serial ml-auto text-[11px]">{dateTime(match.createdAt)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-5 px-5 py-4">
        {match.scorePct !== null && <ScoreRing pct={match.scorePct} />}
        <div className="min-w-52 flex-1">
          <p className="text-lg font-bold leading-tight text-[var(--ink)]">
            {match.quantityKg}kg {match.commodityName}
          </p>
          <p className="text-sm text-[var(--ink-6)]">
            from {match.farmerName ?? 'farmer'} <span className="serial text-xs">({match.lotCode})</span>
          </p>
          <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1.5">
            <TermLine label="up to" value={`${ghs(match.bestPricePerKg)}/kg`} />
            <TermLine label="escrow hold" value={ghs(match.holdAmount)} />
            {match.distanceKm !== null && <TermLine label="route" value={`≈ ${match.distanceKm} km`} />}
            {match.logisticsEstimate !== null && <TermLine label="logistics est." value={ghs(match.logisticsEstimate)} />}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StateBadge state={match.state} />
          <div className="flex flex-wrap justify-end gap-2">
            {match.state === 'OFFERED' && simulateEnabled && (
              <button type="button" className={btnCls} onClick={onSimulate} disabled={simulating} aria-busy={simulating || undefined}>
                <BusyLabel busy={simulating} label="Accept Contract" busyLabel="Accepting…" />
              </button>
            )}
            <button type="button" className={btnGhostCls} onClick={onPreview}>
              Voice & SMS
            </button>
          </div>
          {match.state === 'OFFERED' && (
            <p className="text-right text-[11px] text-[var(--ink-6)]">
              {simulateEnabled ? 'demo: plays the farmer pressing 1 on the IVR call' : 'awaiting farmer acceptance (SMS + voice sent)'}
            </p>
          )}
          <Link
            viewTransition to={`/deals/${match.contractId}`}
            className={`${textLinkCls} ${hitAreaCls} text-xs font-semibold text-[var(--ink)] hover:text-[var(--gold-deep)]`}
          >
            View Contract
          </Link>
        </div>
      </div>
    </div>
  );
}

function TermLine({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-sm">
      <span className="smallcaps mr-1.5 text-[var(--ink-6)]">{label}</span>
      <span className="serial font-bold text-[var(--ink)]">{value}</span>
    </span>
  );
}

/** Quieter ledger row for earlier matches below the notice. */
export function MatchRow({
  match,
  simulateEnabled,
  onPreview,
  onSimulate,
  simulating,
}: {
  match: FeedMatch;
  simulateEnabled: boolean;
  onPreview: () => void;
  onSimulate: () => void;
  simulating: boolean;
}) {
  return (
    <div className="mb-0 flex flex-wrap items-center gap-4 border-b border-[var(--ink-2)] py-3 last:border-b-0">
      {match.scorePct !== null && <Stat value={`${match.scorePct}%`} caption="match" accent />}
      <div className="min-w-48 flex-1">
        <p className="text-sm font-bold text-[var(--ink)]">
          {match.quantityKg}kg {match.commodityName}
          <span className="serial ml-2 text-[11px] font-normal text-[var(--ink-6)]">{match.lotCode}</span>
        </p>
        <p className="text-xs text-[var(--ink-6)]">
          {match.farmerName ?? 'farmer'} · up to <span className="serial font-bold">{ghs(match.bestPricePerKg)}/kg</span> ·
          hold <span className="serial font-bold">{ghs(match.holdAmount)}</span>
          {match.distanceKm !== null && <> · ≈ {match.distanceKm} km</>}
          {match.logisticsEstimate !== null && <> · logistics {ghs(match.logisticsEstimate)}</>}
        </p>
      </div>
      <StateBadge state={match.state} />
      {match.state === 'OFFERED' && simulateEnabled && (
        <button type="button" className={btnCls} onClick={onSimulate} disabled={simulating} aria-busy={simulating || undefined}>
          <BusyLabel busy={simulating} label="Accept Contract" busyLabel="Accepting…" />
        </button>
      )}
      <button type="button" className={btnGhostCls} onClick={onPreview}>
        Voice & SMS
      </button>
      <Link viewTransition to={`/deals/${match.contractId}`} className={`${textLinkCls} ${hitAreaCls} text-sm font-semibold text-[var(--gold-deep)]`}>
        Contract
      </Link>
    </div>
  );
}

export function SimulationDrawer({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const [locale, setLocale] = useState('tw');
  const { panelRef, trapTab } = useDialog<HTMLElement>(onClose);
  const titleId = useId();
  const { data } = useQuery({
    queryKey: ['alert-preview', contractId, locale],
    queryFn: () => api<AlertPreview>(`/api/engine/alert-preview?contractId=${contractId}&locale=${locale}`),
  });

  // Portalled to document.body: useDialog makes #root inert while open.
  return createPortal(
    <div className="fixed inset-0 z-30" onClick={onClose}>
      <div className="scrim-in absolute inset-0 bg-[var(--ink)]/70" />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="drawer-in absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto overscroll-contain border-l border-[var(--ink-7)] bg-[var(--paper)] outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <div className="plate on-dark flex items-center justify-between gap-4 px-5 py-5">
          <div>
            <h2 id={titleId} className="headline text-2xl">
              What the farmer's phone receives
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-2)]">Calls and text messages, simulated</p>
          </div>
          <button type="button" className={plateBtnCls} onClick={onClose}>
            Close
          </button>
        </div>

        <div className="p-5">
          <p className="mb-4 text-sm text-[var(--ink-6)]">
            When the engine finds this match, {data?.farmerName ?? 'the farmer'}{' '}
            <span className="serial text-xs text-[var(--ink-6)]">{data?.farmerPhone}</span> is alerted instantly:
          </p>

          <div className="mb-4 flex flex-wrap border border-[var(--ink-3)]">
            {(data?.locales ?? [{ code: 'tw', label: 'Twi' }]).map((l) => (
              <button
                key={l.code}
                type="button"
                aria-pressed={locale === l.code}
                className={`smallcaps min-h-11 min-w-[72px] flex-1 py-1.5 transition-colors lg:min-h-9 ${
                  locale === l.code
                    ? 'bg-[var(--forest)] text-[var(--paper)]'
                    : 'bg-[var(--paper-lift)] text-[var(--ink-6)] hover:bg-[var(--paper)] hover:text-[var(--ink)] active:bg-[var(--paper-deep)]'
                }`}
                onClick={() => setLocale(l.code)}
              >
                {l.label}
              </button>
            ))}
          </div>

          {data?.reviewNote && (
            <p className="stamp mb-4 px-3 py-2 text-[11px] normal-case tracking-normal text-[var(--gold-deep)]">
              Machine translation. Native speakers are still checking it.
            </p>
          )}

          <p className="smallcaps mb-1.5 flex items-center gap-2 text-[var(--ink-6)]">
            <Glyph name="sms" className="h-3.5 w-3.5" /> SMS {data?.smsStatus && <StateBadge state={data.smsStatus} />}
          </p>
          <div className="certificate mb-5 bg-[var(--paper-lift)] p-3.5 text-sm leading-relaxed text-[var(--ink)]">
            {data?.sms ?? '…'}
          </div>

          <p className="smallcaps mb-1.5 flex items-center gap-2 text-[var(--ink-6)]">
            <Glyph name="phone" className="h-3.5 w-3.5" /> Automated IVR call{' '}
            {data?.callStatus && <StateBadge state={data.callStatus} />}
          </p>
          <div className="space-y-2">
            {(data?.voice ?? []).map((line, i) => (
              <div key={i} className="flex items-start gap-2.5 border border-[var(--gold)] bg-[var(--gold-wash)] px-3.5 py-3 text-sm text-[var(--ink)]">
                <Glyph name="speak" className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--gold-deep)]" />
                {line}
              </div>
            ))}
            <div className="flex items-center gap-2 pl-1 text-xs text-[var(--ink-6)]">
              <span className="stamp px-1.5 py-0.5 text-[11px] text-[var(--ink)]">1</span> accept
              <span className="stamp ml-2 px-1.5 py-0.5 text-[11px] text-[var(--ink)]">2</span> decline
            </div>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
