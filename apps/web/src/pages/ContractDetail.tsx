import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, dateTime, ghs, type AvailableDriver, type ContractDetail, type JobView, type TransportQuoteView } from '../api';
import { POLL } from '../poll';
import { Glyph, VehicleMark } from '../components/engrave';
import { QrImage } from '../components/QrImage';
import {
  backLinkCls,
  btnCls,
  btnGhostCls,
  BusyLabel,
  Card,
  EmptyState,
  ErrorStamp,
  GradeBadge,
  LoadGate,
  numCls,
  pillCls,
  pillSolidCls,
  Skeleton,
  Spinner,
  StateBadge,
  tableCls,
  TableScroll,
  tdCls,
  thCls,
} from '../components/ui';
import { useT, type UiLanguage } from '../lib/i18n';

type T = UiLanguage['t'];

/** UPPER_EAST → "Upper East": region codes never reach the screen raw. */
const regionLabel = (code: string): string =>
  code
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');

/** Ledger account ids ("escrow:contract:…") in words; the raw id stays in the tooltip for audits. */
function accountLabel(account: string, t: T): string {
  if (account === 'external:momo') return t('web.contract.acctMomo', 'Mobile money');
  if (account.startsWith('escrow:contract:')) return t('web.contract.acctEscrow', 'Held for this deal');
  if (account.startsWith('escrow:job:')) return t('web.contract.acctEscrowJob', 'Held for the driver');
  if (account.startsWith('farmer:') && account.endsWith(':payable')) return t('web.contract.acctFarmer', 'Owed to the farmer');
  if (account.startsWith('driver:') && account.endsWith(':payable')) return t('web.contract.acctDriver', 'Owed to the driver');
  if (account.startsWith('buyer:') && account.endsWith(':refunds')) return t('web.contract.acctRefund', 'Returned to you');
  return account;
}


/** The escrow lifecycle as numbered engraved stations + the payout advice. */
function TransactionFlow({ data }: { data: ContractDetail }) {
  const { t } = useT();
  const { contract, lot, farmer } = data;
  const payout = data.payments.find((p) => p.direction === 'disbursement' && p.jobId === null);
  const steps = [
    { key: 'accepted', label: t('web.contract.stepAccepted', 'Accepted'), sublabel: t('web.contract.stepAcceptedSub', 'farmer said yes'), at: contract.acceptedAt },
    { key: 'held', label: t('web.contract.stepHeld', 'Money held'), sublabel: t('web.contract.stepHeldSub', 'your payment is safe'), at: contract.fundedAt },
    { key: 'collected', label: t('web.contract.stepCollected', 'Collected'), sublabel: t('web.contract.stepCollectedSub', 'goods picked up'), at: contract.pickupConfirmedAt },
    {
      key: 'graded',
      label: t('web.contract.stepGraded', 'Graded'),
      sublabel: contract.finalGrade
        ? t('web.contract.stepGradedSubDone', 'grade {g}', { g: contract.finalGrade })
        : t('web.contract.stepGradedSub', 'quality checked'),
      at: contract.gradedAt,
    },
    { key: 'paid', label: t('web.contract.stepPaid', 'Farmer paid'), sublabel: t('web.contract.stepPaidSub', 'money sent'), at: payout ? payout.createdAt : null },
    { key: 'done', label: t('web.contract.stepDone', 'Done'), sublabel: t('web.contract.stepDoneSub', 'all accounts closed'), at: contract.settledAt },
  ];
  const activeIdx = steps.findIndex((s) => s.at === null);
  // The rail stops at the first unfinished station, not at the tally of
  // finished ones: those timestamps need not arrive in order, and a payout
  // landing before gradedAt drew the bar straight past a pip still pending.
  const filledCount = activeIdx === -1 ? steps.length : activeIdx;
  const refund = contract.finalAmount !== null ? contract.holdAmount - contract.finalAmount : null;

  return (
    <Card title={`${t('web.contract.flowTitle', 'Progress')} — ${t('web.contract.flowSub', 'your money is held safely until the produce is graded')}`}>
      {/* Six stations need ~600px of rail; on narrow paper the strip scrolls in
          its own frame — the same rule the SVG route spine follows. */}
      <div className="overflow-x-auto">
        <ol className="relative flex min-w-[600px] items-start justify-between">
          <li aria-hidden="true" className="absolute left-0 right-0 top-4 h-px bg-[var(--ink-2)]">
            <div
              className="h-full bg-[var(--forest)] transition-[width] duration-[var(--dur-base)]"
              style={{ width: `${steps.length > 1 ? (Math.max(0, filledCount - 1) / (steps.length - 1)) * 100 : 0}%` }}
            />
          </li>
          {steps.map((step, i) => {
            const done = step.at !== null;
            const active = i === activeIdx;
            return (
              <li
                key={step.key}
                aria-current={active ? 'step' : undefined}
                className="relative z-10 flex flex-1 flex-col items-center gap-1.5"
              >
                <div
                  aria-hidden="true"
                  className={`serial flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] text-xs font-bold ${
                    done
                      ? 'border-[var(--forest)] bg-[var(--forest)] text-[var(--paper)]'
                      : active
                        ? 'ember border-[var(--gold)] bg-[var(--gold-wash)] text-[var(--gold-deep)]'
                        : 'border-[var(--ink-3)] bg-[var(--paper)] text-[var(--ink-6)]'
                  }`}
                >
                  {done ? <Glyph name="check" className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <div className="text-center">
                  <div
                    className={`smallcaps ${done ? 'text-[var(--ink)]' : active ? 'text-[var(--gold-ink)]' : 'text-[var(--ink-6)]'}`}
                  >
                    {step.label}
                    <span className="sr-only">
                      {done
                        ? `, ${t('web.contract.stepStateDone', 'done')}`
                        : active
                          ? `, ${t('web.contract.stepStateNow', 'next')}`
                          : `, ${t('web.contract.stepStateLater', 'still to come')}`}
                    </span>
                  </div>
                  <div className="serial mt-0.5 max-w-[84px] text-[11px] leading-tight text-[var(--ink-6)]">
                    {step.at ? dateTime(step.at) : step.sublabel}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {payout && (
        <div className="certificate seal-land mt-4 overflow-hidden bg-[var(--paper)]">
          <div className="plate on-dark flex flex-wrap items-center gap-3 px-5 py-4">
            <div>
              <p className="headline text-xl">{t('web.contract.payoutTitle', 'Mobile money payment')}</p>
              <p className="mt-0.5 text-sm text-[var(--ink-2)]">
                {t('web.contract.payoutEyebrow', 'Sent to {name}', { name: farmer?.name ?? t('web.contract.theFarmer', 'the farmer') })}
              </p>
            </div>
            <span className="ml-auto">
              {payout.status === 'successful' ? (
                <span className="stamp flex items-center gap-1 px-2 py-0.5 text-[11px] text-[var(--paper)]">
                  <Glyph name="check" className="h-3 w-3" />
                  {t('web.contract.confirmed', 'Confirmed')}
                </span>
              ) : (
                <StateBadge state={payout.status} />
              )}
            </span>
          </div>
          <div className="grid gap-5 p-4 md:grid-cols-2">
            <div>
              <p className="rule-double smallcaps mb-2.5 pb-1.5 text-[var(--ink-6)]">{t('web.contract.paidTo', 'Paid to')}</p>
              <div className="flex items-center justify-between rounded-2xl border border-[var(--ink-2)] bg-[var(--paper-lift)] p-3">
                <div>
                  <div className="stamp inline-block px-1.5 py-0.5 text-[11px] text-[var(--ink)]">MTN MoMo</div>
                  <div className="serial mt-1.5 text-xs text-[var(--ink-6)]">+{payout.counterpartyMsisdn}</div>
                </div>
                <div className="text-right">
                  <div className="serial text-lg font-bold text-[var(--gold-deep)]">{ghs(payout.amount)}</div>
                  <div className="smallcaps text-[var(--ink-6)]">
                    {payout.provider === 'mock'
                      ? t('web.contract.mockProvider', 'practice payment')
                      : t('web.contract.mainChannel', 'main account')}
                  </div>
                </div>
              </div>
            </div>
            <div>
              <p className="rule-double smallcaps mb-2.5 pb-1.5 text-[var(--ink-6)]">{t('web.contract.paymentDetails', 'Payment details')}</p>
              <dl className="flex flex-col gap-1.5">
                {(
                  [
                    [t('web.contract.recLot', 'Lot'), lot.lotCode],
                    [t('web.contract.recHeld', 'Held from you'), ghs(contract.holdAmount)],
                    [
                      t('web.contract.recFarmer', 'Paid to farmer'),
                      contract.finalAmount !== null ? ghs(contract.finalAmount) : ghs(payout.amount),
                    ],
                    [t('web.contract.recRefund', 'Returned to you'), refund !== null ? ghs(refund) : '—'],
                    [t('web.contract.recTime', 'Time'), dateTime(payout.createdAt)],
                    [t('web.contract.recRef', 'Reference'), `${payout.providerRef.slice(0, 13)}…`],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-3">
                    <dt className="smallcaps flex-shrink-0 text-[var(--ink-6)]">{label}</dt>
                    <dd className="serial text-right text-xs font-semibold text-[var(--ink)]">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/** "broken_kernels" → "Broken kernels". */
function criterionLabel(code: string): string {
  const words = code.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function ContractDetailPage() {
  const { t } = useT();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ['contract', id],
    queryFn: () => api<ContractDetail>(`/api/contracts/${id}`),
    refetchInterval: POLL.live, // payments + grading move live during a demo
  });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // One timer, replaced not stacked: two copies inside 2s used to let the
  // first timer wipe the second's "Copied", and it fired after unmount too.
  const copiedTimer = useRef<number | null>(null);
  const flashCopied = () => {
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
  };
  useEffect(() => () => void (copiedTimer.current && window.clearTimeout(copiedTimer.current)), []);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['contract', id] });
  const onError = (err: unknown) =>
    setError(err instanceof Error ? err.message : t('web.contract.actionFailed', 'That did not work. Please try again.'));

  const confirmPickup = useMutation({
    mutationFn: () => api(`/api/contracts/${id}/confirm-pickup`, { method: 'POST' }),
    onSuccess: invalidate,
    onError,
  });
  const runGrading = useMutation({
    mutationFn: () => api(`/api/contracts/${id}/grade`, { method: 'POST' }),
    onSuccess: invalidate,
    onError,
  });
  const uploadPhoto = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('photo', file);
      return api(`/api/contracts/${id}/photos`, { method: 'POST', body: form });
    },
    onSuccess: invalidate,
    onError,
  });
  const callFarmer = useMutation({
    mutationFn: () => api(`/api/contracts/${id}/call-farmer`, { method: 'POST' }),
    onError,
  });

  if (!data) return <LoadGate isError={isError} retrying={isFetching} onRetry={() => void refetch()} label={t('web.contract.loadLabel', 'this contract')} />;
  const { contract, lot, farmer, commodity, payments, ledger, photos, gradings, match } = data;
  const canPhoto = ['FUNDS_HELD', 'PICKUP_CONFIRMED', 'DISPUTED'].includes(contract.state);
  const canGrade = ['PICKUP_CONFIRMED', 'DISPUTED'].includes(contract.state) && photos.length > 0;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const publicUrl = `${window.location.origin}/t/${lot.id}`;
  const farmerName = farmer?.name ?? t('web.contract.theFarmerCap', 'The farmer');

  return (
    <div>
      <Link
        to="/contracts"
        className={backLinkCls}
      >
        <span aria-hidden="true">←&nbsp;</span>
        {t('web.contract.back', 'All contracts')}
      </Link>
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="headline text-3xl text-[var(--ink)] sm:text-4xl">
          {contract.quantityKg.toLocaleString()} kg {commodity.name.toLowerCase()}
        </h1>
        <span className="serial text-sm text-[var(--ink-6)]">{t('web.contract.lotCode', 'Lot {code}', { code: lot.lotCode })}</span>
        <StateBadge state={contract.state} />
      </div>
      {error && <ErrorStamp message={error} onDismiss={() => setError(null)} className="mb-4" />}

      <div className="flex flex-col gap-4 xl:flex-row">
        {/* ── Main column ─────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          <TransactionFlow data={data} />

          {gradings.length > 0 && (
            <Card title={`${t('web.contract.gradeTitle', 'Quality check')} — ${t('web.contract.gradeSub', 'the AI explains every grade')}`}>
              {gradings.map((g) => (
                <div key={g.id} className="certificate mb-4 bg-[var(--paper)] p-3 last:mb-0">
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="stamp-land inline-flex scale-[1.9] px-3 py-3">
                      <GradeBadge grade={g.gradeBand ?? '…'} />
                    </span>
                    <div className="min-w-44 flex-1">
                      {g.confidence !== null && (
                        <>
                          <div className="mb-1 flex items-baseline justify-between text-xs">
                            <span className="smallcaps text-[var(--ink-6)]">{t('web.contract.howSure', 'How sure')}</span>
                            <span className="serial text-sm font-bold text-[var(--ink)]">
                              {(g.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div aria-hidden="true" className="h-[7px] rounded-full border border-[var(--ink-3)] bg-[var(--paper-lift)] p-[1.5px]">
                            <div className="h-full rounded-full bg-[var(--ink)]" style={{ width: `${Math.round(g.confidence * 100)}%` }} />
                          </div>
                        </>
                      )}
                      <p className="serial mt-1.5 text-[11px] text-[var(--ink-6)]" title={[g.provider, g.model].filter(Boolean).join(' · ')}>
                        {t('web.contract.checkNo', 'Check {n}', { n: g.attempt })}
                        {g.provider === 'mock' ? ` · ${t('web.contract.mockGrade', 'practice grade')}` : ''} · {dateTime(g.createdAt)}
                      </p>
                    </div>
                    <StateBadge state={g.status} />
                  </div>
                  {g.reasons.length > 0 && (
                    // A list, not a table: each check reads as a line on a phone,
                    // and the grader's codes are written as words.
                    <ul className="mt-3 divide-y divide-[var(--ink-2)] border-y border-[var(--ink-2)]">
                      {g.reasons.map((r, i) => (
                        <li key={i} className="py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-[var(--ink)]">{criterionLabel(r.criterion)}</span>
                            <GradeBadge grade={r.bandForCriterion} />
                          </div>
                          <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--ink-6)]">{r.observation}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {contract.disputeNote && g.status === 'resolved' && (
                    <p className="mt-3 rounded-2xl bg-[var(--stamp-wash)] px-3 py-2 text-[11px] text-[var(--stamp-deep)]">
                      {t('web.contract.disputeNote', 'The farmer questioned the grade: “{note}”', { note: contract.disputeNote })}
                    </p>
                  )}
                </div>
              ))}
              <p className="text-[11px] text-[var(--ink-6)]">
                {t(
                  'web.contract.gradeExplain',
                  'The farmer gets this grade, the amount and the main reason on their phone. They have a set time to question it.',
                )}
              </p>
            </Card>
          )}

          {['FUNDS_HELD', 'PICKUP_CONFIRMED', 'GRADED', 'DISPUTED', 'SETTLED'].includes(contract.state) && (
            <TransportSection
              contractId={contract.id}
              contractState={contract.state}
              farmerSuggested={(() => {
                const suggest = [...data.trace].reverse().find((e) => e.type === 'TRANSPORT_SUGGESTED');
                const request = [...data.trace].reverse().find((e) => e.type === 'TRANSPORT_REQUESTED');
                return !!suggest && (!request || suggest.seq > request.seq);
              })()}
              farmerName={farmerName}
              onError={onError}
            />
          )}

          <Card
            title={`${t('web.contract.photosTitle', 'Pickup photos')}${
              photos.length
                ? ` — ${photos.length === 1 ? t('web.contract.photoOne', '1 photo') : t('web.contract.photoMany', '{n} photos', { n: photos.length })}`
                : ''
            }`}
            actions={
              canPhoto ? (
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadPhoto.mutate(file);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className={btnGhostCls}
                    onClick={() => fileRef.current?.click()}
                    disabled={uploadPhoto.isPending}
                    aria-busy={uploadPhoto.isPending || undefined}
                  >
                    <BusyLabel busy={uploadPhoto.isPending} label={t('web.contract.upload', 'Add a photo')} busyLabel={t('web.contract.uploading', 'Uploading…')} />
                  </button>
                  {contract.state === 'FUNDS_HELD' && (
                    <button
                      type="button"
                      className={btnCls}
                      onClick={() => confirmPickup.mutate()}
                      disabled={confirmPickup.isPending}
                      aria-busy={confirmPickup.isPending || undefined}
                    >
                      <BusyLabel busy={confirmPickup.isPending} label={t('web.contract.confirmPickup', 'Confirm goods collected')} />
                    </button>
                  )}
                  {canGrade && (
                    <button
                      type="button"
                      className={btnCls}
                      onClick={() => runGrading.mutate()}
                      disabled={runGrading.isPending}
                      aria-busy={runGrading.isPending || undefined}
                    >
                      <BusyLabel
                        busy={runGrading.isPending}
                        label={
                          contract.state === 'DISPUTED'
                            ? t('web.contract.regrade', 'Check the grade again')
                            : t('web.contract.grade', 'Check quality with AI')
                        }
                        busyLabel={t('web.contract.grading', 'Checking…')}
                      />
                    </button>
                  )}
                </div>
              ) : undefined
            }
          >
            {photos.length === 0 ? (
              <EmptyState
                compact
                icon={<Glyph name="camera" className="h-5 w-5" />}
                title={t('web.contract.noPhotosTitle', 'No photos yet')}
                body={
                  canPhoto
                    ? t('web.contract.noPhotosBody', 'Add a photo of the produce at pickup. The AI needs at least one to grade it.')
                    : t('web.contract.noPhotosLater', 'Photos taken at pickup show here.')
                }
              />
            ) : (
              <ul className="flex flex-wrap gap-3">
                {photos.map((p, i) => (
                  <li key={p.id}>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden rounded-2xl border border-[var(--ink-3)] p-1 transition-[border-color,opacity] hover:border-[var(--ink-6)] active:opacity-80"
                    >
                      <img
                        src={p.url}
                        alt={t('web.contract.photoAlt', 'Pickup photo {n}, opens in a new tab', { n: i + 1 })}
                        loading="lazy"
                        decoding="async"
                        className="h-24 w-24 rounded-xl object-cover"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* ── Right rail ──────────────────────────────────────── */}
        <aside className="w-full flex-shrink-0 xl:w-80" aria-label={t('web.contract.railLabel', 'Deal details')}>
          <div className="xl:sticky xl:top-4">
            <Card title={`${t('web.contract.dealTitle', 'The deal')} — ${t('web.contract.dealSub', 'farmer, money and prices')}`}>
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-[var(--ink)]">{farmer?.name}</p>
                    <p className="serial text-[11px] text-[var(--ink-6)]">
                      {farmer?.phone}
                      {farmer?.regionCode ? ` · ${regionLabel(farmer.regionCode)}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`${pillCls} flex-shrink-0`}
                    onClick={() => callFarmer.mutate()}
                    disabled={callFarmer.isPending}
                    aria-busy={callFarmer.isPending || undefined}
                    aria-label={
                      callFarmer.isSuccess
                        ? t('web.contract.callBookedLabel', 'Call to {name} booked', { name: farmerName })
                        : t('web.contract.callLabel', 'Call {name} through F2M', { name: farmerName })
                    }
                  >
                    {callFarmer.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Glyph name="phone" className="h-3.5 w-3.5" />}
                    {callFarmer.isSuccess ? t('web.contract.callBooked', 'Call booked') : t('web.contract.call', 'Call')}
                  </button>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                  <span className="serial text-xs text-[var(--ink-6)]">{lot.lotCode}</span>
                  <span className="text-[11px] text-[var(--ink-6)]">
                    {t('web.contract.declared', 'farmer said grade {g}', { g: lot.declaredBand })} ·{' '}
                    {t('web.contract.fit', 'fit')}{' '}
                    <span className="serial font-bold text-[var(--gold-deep)]">{match.score.toFixed(2)}</span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-[var(--ink-2)] bg-[var(--paper)] p-2 text-center">
                    <div className="serial text-sm font-bold text-[var(--ink)]">{ghs(contract.holdAmount)}</div>
                    <div className="smallcaps text-[11px] text-[var(--ink-6)]">{t('web.contract.held', 'held for the farmer')}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--ink-2)] bg-[var(--paper)] p-2 text-center">
                    <div className="serial text-sm font-bold text-[var(--gold-deep)]">
                      {contract.finalAmount !== null ? ghs(contract.finalAmount) : '—'}
                    </div>
                    <div className="smallcaps text-[11px] text-[var(--ink-6)]">
                      {contract.finalGrade
                        ? t('web.contract.finalAt', 'final, grade {g}', { g: contract.finalGrade })
                        : t('web.contract.awaitingGrade', 'waiting for the grade')}
                    </div>
                  </div>
                </div>
                <div>
                  <p className="rule-double smallcaps mb-2 pb-1.5 text-[var(--ink-6)]">
                    {t('web.contract.priceGrid', 'GHS per kg, by grade (fixed at the offer)')}
                  </p>
                  <ul className="flex gap-1.5">
                    {(['A', 'B', 'C', 'REJECT'] as const).map((band) => (
                      <li
                        key={band}
                        className={`flex flex-1 flex-col items-center gap-1 rounded-xl border py-1.5 ${
                          contract.finalGrade === band ? 'border-[var(--gold)] bg-[var(--gold-wash)] ring-1 ring-[var(--gold)]' : 'border-[var(--ink-2)]'
                        }`}
                      >
                        <GradeBadge grade={band} />
                        <span className="serial text-[11px] font-semibold text-[var(--ink-7)]">
                          {(contract.priceTerms[band] / 100).toFixed(2)}
                        </span>
                        {contract.finalGrade === band && (
                          <span className="sr-only">{t('web.contract.finalGradeSr', 'final grade')}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>

            <Card title={`${t('web.contract.qrTitle', 'QR code')} — ${t('web.contract.qrSub', 'the public record of this lot')}`}>
              <div className="flex items-center gap-3">
                <div className="h-24 w-24 flex-shrink-0 rounded-xl border-2 border-[var(--ink)] bg-white p-1.5">
                  <QrImage url={publicUrl} />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-[11px] leading-snug text-[var(--ink-6)]">
                    {t(
                      'web.contract.qrExplain',
                      'Anyone who scans it sees where this lot came from and every step since. No login, and no money details.',
                    )}
                  </p>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      className={pillCls}
                      onClick={() => {
                        // navigator.clipboard is undefined on any non-secure
                        // origin — which is exactly how this gets demoed, off a
                        // laptop at http://192.168.x.x. Unguarded, that throws
                        // synchronously and the button silently does nothing.
                        void (async () => {
                          // Phones hand the link to their own share sheet
                          // (WhatsApp, SMS), which is how a link gets passed on.
                          if (canShare) {
                            try {
                              await navigator.share({ title: document.title, url: publicUrl });
                              return;
                            } catch (err) {
                              if (err instanceof DOMException && err.name === 'AbortError') return;
                            }
                          }
                          try {
                            if (!navigator.clipboard) throw new Error('clipboard unavailable');
                            await navigator.clipboard.writeText(publicUrl);
                            setCopied(true);
                            flashCopied();
                          } catch {
                            setCopyFailed(true);
                          }
                        })();
                      }}
                    >
                      {copied
                        ? t('web.contract.copied', 'Copied')
                        : canShare
                          ? t('web.contract.share', 'Share link')
                          : t('web.contract.copy', 'Copy link')}
                    </button>
                    <span className="sr-only" aria-live="polite">
                      {copied ? t('web.contract.copiedSr', 'Link copied') : ''}
                    </span>
                    {copyFailed && (
                      <div role="status" className="text-[11px] leading-snug text-[var(--stamp-deep)]">
                        <p>{t('web.contract.copyFailed', 'This page cannot copy for you. Select the link and copy it:')}</p>
                        <p className="serial mt-0.5 select-all break-all text-[var(--ink)]">{publicUrl}</p>
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <Link to={`/t/${lot.id}`} target="_blank" className={pillSolidCls}>
                        {t('web.contract.publicPage', 'Public page')}
                        <span className="sr-only">{t('web.contract.newTab', ' (opens in a new tab)')}</span>
                      </Link>
                      <Link to={`/lots/${lot.id}/trace`} className={pillCls}>
                        {t('web.contract.fullTrace', 'Full history')}
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <Card
              title={`${t('web.contract.paymentsTitle', 'Payments')}${
                payments.length
                  ? ` — ${payments.length === 1 ? t('web.contract.paymentOne', '1 payment') : t('web.contract.paymentMany', '{n} payments', { n: payments.length })}`
                  : ''
              }`}
            >
              {payments.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Glyph name="scale" className="h-5 w-5" />}
                  title={t('web.contract.noPaymentsTitle', 'No payments yet')}
                  body={t('web.contract.noPaymentsBody', 'Your money is taken and held as soon as the farmer accepts.')}
                />
              ) : (
                <ul>
                  {payments.map((p) => (
                    <li key={p.id} className="border-b border-[var(--ink-2)] py-2 text-sm last:border-b-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-semibold text-[var(--ink)]">
                          {p.direction === 'collection'
                            ? t('web.contract.payHeld', 'Held from you')
                            : p.jobId
                              ? t('web.contract.payDriver', 'Paid to driver')
                              : t('web.contract.payFarmer', 'Paid to farmer')}
                        </p>
                        <span className={`${numCls} flex-shrink-0 font-bold text-[var(--gold-deep)]`}>{ghs(p.amount)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <p className="serial text-[11px] text-[var(--ink-6)]">{dateTime(p.createdAt)}</p>
                        <StateBadge state={p.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {ledger.length > 0 && (
                <details className="group mt-3 border-t border-[var(--ink-2)] pt-2">
                  <summary className="smallcaps -mx-2 flex min-h-11 items-center justify-between gap-2 rounded-xl px-2 text-[var(--ink-6)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--ink)] active:bg-[var(--paper-deep)] lg:min-h-9">
                    {t('web.contract.ledger', 'Accounts: money in always equals money out')}
                    <Glyph
                      name="chevron"
                      className="h-4 w-4 shrink-0 transition-[rotate] duration-[var(--dur-base)] group-open:rotate-180 motion-reduce:transition-none"
                    />
                  </summary>
                  <div className="mt-2 overflow-hidden rounded-xl border border-[var(--ink-2)]">
                    <TableScroll minWidth={300}>
                      <table className="w-full text-left text-[11px]">
                        <thead>
                          <tr className="border-b border-[var(--ink-2)]">
                            <th scope="col" className="smallcaps px-2 py-1 text-[var(--ink-6)]">
                              {t('web.contract.colAccount', 'Account')}
                            </th>
                            <th scope="col" className="smallcaps px-2 py-1 text-right text-[var(--ink-6)]">
                              {t('web.contract.colOut', 'Out')}
                            </th>
                            <th scope="col" className="smallcaps px-2 py-1 text-right text-[var(--ink-6)]">
                              {t('web.contract.colIn', 'In')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {ledger.map((l) => (
                            <tr key={l.id} className="border-b border-[var(--ink-2)] last:border-b-0">
                              <td className="px-2 py-1 text-[var(--ink-7)]" title={l.account}>
                                {accountLabel(l.account, t)}
                              </td>
                              <td className="serial px-2 py-1 text-right text-[var(--stamp-deep)]">{l.debit ? ghs(l.debit) : ''}</td>
                              <td className="serial px-2 py-1 text-right text-[var(--ink)]">{l.credit ? ghs(l.credit) : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableScroll>
                  </div>
                </details>
              )}
            </Card>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** The middle-mile bridge: quote → request or direct-hire → live job → confirm delivery. */
function TransportSection({
  contractId,
  contractState,
  farmerSuggested,
  farmerName,
  onError,
}: {
  contractId: string;
  contractState: string;
  farmerSuggested: boolean;
  farmerName: string;
  onError: (err: unknown) => void;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [showDrivers, setShowDrivers] = useState(false);
  const { data: jobData } = useQuery({
    queryKey: ['transport', contractId],
    queryFn: () => api<{ job: JobView | null }>(`/api/contracts/${contractId}/transport`),
    refetchInterval: POLL.live,
  });
  const job = jobData?.job ?? null;
  const canRequest = contractState === 'FUNDS_HELD' && (!job || ['CANCELLED', 'CANCELLED_REFUNDED'].includes(job.state));
  // isLoading/isError are read below: this query always starts cold when the
  // card mounts, and rendering the "no transport requested" copy in that gap
  // told the buyer the opposite of the truth on a contract ready to quote.
  const {
    data: quoteData,
    isLoading: quoteLoading,
    isError: quoteError,
    isFetching: quoteFetching,
    refetch: refetchQuote,
  } = useQuery({
    queryKey: ['transport-quote', contractId],
    queryFn: () => api<{ quotes: TransportQuoteView[] }>(`/api/contracts/${contractId}/transport-quote`),
    enabled: canRequest,
  });
  const { data: driverData } = useQuery({
    queryKey: ['drivers-available'],
    queryFn: () => api<{ drivers: AvailableDriver[] }>('/api/drivers/available'),
    enabled: canRequest && showDrivers,
    refetchInterval: POLL.ambient,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['transport', contractId] });
  const request = useMutation({
    mutationFn: (body: { vehicleClassCode?: string; preferredDriverId?: string }) =>
      api(`/api/contracts/${contractId}/transport`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: invalidate,
    onError,
  });
  const retry = useMutation({
    mutationFn: (jobId: string) => api(`/api/jobs/${jobId}/retry-dispatch`, { method: 'POST' }),
    onSuccess: invalidate,
    onError,
  });
  const deliver = useMutation({
    mutationFn: (jobId: string) => api(`/api/jobs/${jobId}/deliver`, { method: 'POST' }),
    onSuccess: invalidate,
    onError,
  });

  return (
    <Card title={`${t('web.contract.transportTitle', 'Transport')} — ${t('web.contract.transportSub', 'a driver brings it from the farm to you')}`}>
      {job && !['CANCELLED', 'CANCELLED_REFUNDED'].includes(job.state) ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-[var(--ink-2)] bg-[var(--paper)] p-3">
          <span className="serial text-sm font-bold text-[var(--ink)]">{job.jobCode}</span>
          <StateBadge state={job.state} />
          <span className="flex items-center gap-2 text-sm text-[var(--ink-7)]">
            <VehicleMark code={job.vehicleClassCode} className="h-6 w-6" />
            {job.vehicleClassName}
          </span>
          <span className="serial text-sm text-[var(--ink-7)]">{job.distanceKm} km</span>
          <span className="serial text-sm font-bold text-[var(--gold-deep)]">{ghs(job.quoteAmount)}</span>
          {job.driver && (
            <span className="text-sm">
              <span className="font-bold text-[var(--ink)]">{job.driver.name}</span>{' '}
              <span className="serial text-[11px] text-[var(--ink-6)]">{job.driver.phone}</span>
            </span>
          )}
          <div className="ml-auto">
            {job.state === 'NO_DRIVER' && (
              <button
                type="button"
                className={btnGhostCls}
                onClick={() => retry.mutate(job.id)}
                disabled={retry.isPending}
                aria-busy={retry.isPending || undefined}
              >
                <BusyLabel busy={retry.isPending} label={t('web.contract.retryDispatch', 'Look for a driver again')} />
              </button>
            )}
            {job.state === 'PICKED_UP' && (
              <button
                type="button"
                className={btnCls}
                onClick={() => deliver.mutate(job.id)}
                disabled={deliver.isPending}
                aria-busy={deliver.isPending || undefined}
              >
                <BusyLabel busy={deliver.isPending} label={t('web.contract.confirmDelivery', 'I have received the goods')} />
              </button>
            )}
            {job.state === 'DELIVERED' && (
              <span className="text-sm font-semibold text-[var(--ink-6)]">{t('web.contract.payingDriver', 'Paying the driver…')}</span>
            )}
            {job.state === 'PAID' && (
              <span className="flex items-center gap-1.5 text-sm font-bold text-[var(--success)]">
                <Glyph name="check" className="h-4 w-4" />
                {t('web.contract.driverPaid', 'Driver paid')}
              </span>
            )}
          </div>
        </div>
      ) : canRequest && quoteData ? (
        <div>
          {farmerSuggested && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--gold)] bg-[var(--gold-wash)] px-3 py-2.5">
              <span aria-hidden="true" className="ember inline-block h-2 w-2 rounded-full bg-[var(--gold-deep)]" />
              <p className="text-sm font-semibold text-[var(--ink)]">
                {t(
                  'web.contract.farmerAsked',
                  '{name} has asked for a driver. To agree, request one below. The fee comes from your account and is held until delivery.',
                  { name: farmerName },
                )}
              </p>
            </div>
          )}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-xl text-sm text-[var(--ink-6)]">
              {t(
                'web.contract.quotesExplain',
                'Prices for every vehicle that can carry this load. When a driver accepts, the fee is held. They are paid when you confirm delivery.',
              )}
            </p>
            <button
              type="button"
              className={pillCls}
              aria-expanded={showDrivers}
              aria-controls="contract-drivers"
              onClick={() => setShowDrivers((v) => !v)}
            >
              {showDrivers ? t('web.contract.hideDrivers', 'Hide drivers') : t('web.contract.chooseDriver', 'Choose a driver')}
              <Glyph
                name="chevron"
                className={`h-3.5 w-3.5 transition-[rotate] duration-[var(--dur-base)] motion-reduce:transition-none ${showDrivers ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
          {showDrivers && (
            <div id="contract-drivers" className="mb-3 space-y-2 rounded-2xl border border-[var(--ink-2)] bg-[var(--paper)] p-3">
              {!driverData ? (
                <Skeleton lines={2} label={t('web.contract.loadingDrivers', 'Loading drivers')} />
              ) : driverData.drivers.length === 0 ? (
                <p className="text-sm text-[var(--ink-6)]">
                  {t('web.contract.noDrivers', 'No drivers are online right now. You can still request a vehicle below and we will find the nearest driver.')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {driverData.drivers.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--ink-2)] pb-2 last:border-b-0 last:pb-0">
                      <VehicleMark code={d.vehicleClassCode} className="h-7 w-7 text-[var(--ink)]" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-[var(--ink)]">
                          {d.name}
                          {d.busy && (
                            <span className="stamp ml-2 px-1.5 py-0.5 text-[11px] text-[var(--ink-6)]">
                              {t('web.contract.onAJob', 'on a job')}
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-[var(--ink-6)]">
                          {d.vehicleClassName} · {t('web.contract.upTo', 'up to {kg} kg', { kg: d.capacityKg.toLocaleString() })} ·{' '}
                          {d.routeRegions.length === 0
                            ? t('web.contract.drivesAnywhere', 'drives anywhere')
                            : d.routeRegions.length === 1
                              ? t('web.contract.regionOne', 'drives in 1 region')
                              : t('web.contract.regionMany', 'drives in {n} regions', { n: d.routeRegions.length })}
                        </p>
                      </div>
                      <a
                        href={`tel:${d.phone}`}
                        className={pillCls}
                        aria-label={t('web.contract.callDriver', 'Call {name}', { name: d.name })}
                      >
                        <Glyph name="phone" className="h-3.5 w-3.5" /> {t('web.contract.call', 'Call')}
                      </a>
                      <button
                        type="button"
                        className={pillSolidCls}
                        disabled={d.busy || request.isPending}
                        aria-busy={(request.isPending && request.variables?.preferredDriverId === d.id) || undefined}
                        onClick={() => request.mutate({ preferredDriverId: d.id })}
                        aria-label={t('web.contract.hireLabel', 'Hire {name}', { name: d.name })}
                      >
                        <BusyLabel
                          busy={request.isPending && request.variables?.preferredDriverId === d.id}
                          label={t('web.contract.hire', 'Hire')}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-[var(--ink-6)]">
                {t(
                  'web.contract.hireExplain',
                  'Hiring offers the job to that driver first, at their vehicle’s price. If they say no, we offer it to the nearest driver.',
                )}
              </p>
            </div>
          )}
          {quoteData.quotes.length === 0 ? (
            <EmptyState
              compact
              icon={<VehicleMark code="light_truck" className="h-6 w-6" />}
              title={t('web.contract.noQuotesTitle', 'No vehicle fits this load')}
              body={t('web.contract.noQuotesBody', 'None of our vehicles can carry this much in one trip.')}
            />
          ) : (
            <TableScroll minWidth={520}>
              <table className={tableCls}>
                <caption className="sr-only">{t('web.contract.quotesCaption', 'Transport prices by vehicle')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={thCls}>{t('web.contract.colVehicle', 'Vehicle')}</th>
                    <th scope="col" className={thCls}>{t('web.contract.colCarries', 'Carries')}</th>
                    <th scope="col" className={thCls}>{t('web.contract.colDistance', 'Distance')}</th>
                    <th scope="col" className={thCls}>{t('web.contract.colRate', 'How it is priced')}</th>
                    <th scope="col" className={thCls}>{t('web.contract.colTotal', 'Total')}</th>
                    <th scope="col" className={thCls}>
                      <span className="sr-only">{t('web.contract.colAction', 'Request')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {quoteData.quotes.map((q, i) => (
                    <tr key={q.vehicleClassCode} className="hover:bg-[var(--paper)]">
                      <th scope="row" className={`${tdCls} text-left font-bold`}>
                        <span className="flex items-center gap-2">
                          <VehicleMark code={q.vehicleClassCode} className="h-6 w-6 flex-shrink-0 text-[var(--ink-7)]" />
                          {q.vehicleClassName}
                          {i === 0 && (
                            <span className="stamp px-1.5 py-0.5 text-[11px] text-[var(--ink)]">{t('web.contract.cheapest', 'cheapest')}</span>
                          )}
                        </span>
                      </th>
                      <td className={`${tdCls} ${numCls} text-xs`}>{q.capacityKg.toLocaleString()} kg</td>
                      <td className={`${tdCls} ${numCls} text-xs`}>{q.distanceKm} km</td>
                      <td className={`${tdCls} serial text-[11px] text-[var(--ink-6)]`}>
                        {t('web.contract.rate', '{base} + {perKm} per km', { base: ghs(q.baseFee), perKm: ghs(q.perKmRate) })}
                      </td>
                      <td className={`${tdCls} serial font-bold text-[var(--gold-deep)]`}>{ghs(q.quoteAmount)}</td>
                      <td className={`${tdCls} text-right`}>
                        <button
                          type="button"
                          className={btnCls}
                          onClick={() => request.mutate({ vehicleClassCode: q.vehicleClassCode })}
                          disabled={request.isPending}
                          aria-busy={(request.isPending && request.variables?.vehicleClassCode === q.vehicleClassCode) || undefined}
                          aria-label={t('web.contract.requestLabel', 'Request a driver with a {vehicle}', { vehicle: q.vehicleClassName })}
                        >
                          <BusyLabel
                            busy={request.isPending && request.variables?.vehicleClassCode === q.vehicleClassCode}
                            label={t('web.contract.request', 'Request driver')}
                            busyLabel={t('web.contract.requesting', 'Requesting…')}
                          />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
      ) : canRequest && quoteLoading ? (
        <Skeleton lines={3} label={t('web.contract.loadingQuotes', 'Loading transport prices')} />
      ) : canRequest && quoteError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-[var(--ink-6)]">
            {t('web.contract.quotesFailed', 'We could not load transport prices. Check your connection and try again.')}
          </p>
          <button
            type="button"
            className={btnGhostCls}
            onClick={() => void refetchQuote()}
            disabled={quoteFetching}
            aria-busy={quoteFetching || undefined}
          >
            <BusyLabel busy={quoteFetching} label={t('web.contract.tryAgain', 'Try again')} />
          </button>
        </div>
      ) : (
        <p className="text-sm text-[var(--ink-6)]">
          {job
            ? t('web.contract.transportCancelled', 'The last driver booking was cancelled.')
            : t('web.contract.noTransport', 'No driver booked for this contract.')}
        </p>
      )}
    </Card>
  );
}
