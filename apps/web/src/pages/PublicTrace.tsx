import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, dateTime, shortDate, type PublicTrace, type TraceEvent } from '../api';
import { CropMark, cropAccent, F2MSeal, Glyph } from '../components/engrave';
import { SkipLink } from '../components/SkipLink';
import { btnGhostCls, BusyLabel, Card, EmptyState, GradeBadge, Skeleton } from '../components/ui';
import { useT } from '../lib/i18n';
import { TraceEventLog } from './Trace';

/**
 * The QR-code destination (D-033): no login, no money details — a public
 * verification certificate any consumer or market inspector can read.
 * Icons only, never a stock crop photo: this page vouches for one real lot,
 * and a picture of someone else's maize would be a claim it cannot make.
 */
export function PublicTracePage() {
  const { t } = useT();
  const { lotId } = useParams<{ lotId: string }>();
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: ['public-trace', lotId],
    queryFn: () => api<PublicTrace>(`/api/public/trace/${lotId}`),
    retry: 1,
  });
  // A 4xx means the link itself is wrong (a mistyped or cut-off code); anything
  // else is the network or the server, which a retry can fix.
  const notFound = error instanceof ApiError && error.status >= 400 && error.status < 500;

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      <SkipLink />
      <header className="border-b border-[var(--ink-1)]">
        <div className="mx-auto flex min-h-[72px] max-w-4xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <span aria-hidden="true">
            <F2MSeal className="h-10 w-10" />
          </span>
          <div>
            <div className="text-lg font-extrabold uppercase leading-tight tracking-[0.04em] text-[var(--forest-deep)]">
              Farm to Market
            </div>
            <div className="smallcaps leading-tight text-[var(--ink-6)]">
              {t('web.publicTrace.tagline', 'Produce record · Ghana')}
            </div>
          </div>
          <span className="stamp ml-auto flex items-center gap-1.5 bg-[var(--gold-wash)] px-3 py-1 text-[11px] text-[var(--gold-ink)]">
            <span aria-hidden="true" className="ember inline-block h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
            {t('web.publicTrace.publicBadge', 'Open to everyone')}
          </span>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-4xl px-4 py-6 focus:outline-none sm:px-6">
        {error ? (
          <>
            <h1 className="sr-only">{t('web.publicTrace.errorHeading', 'Produce record')}</h1>
            {notFound ? (
              <EmptyState
                icon={<Glyph name="search" className="h-7 w-7" />}
                title={t('web.publicTrace.notFoundTitle', 'We could not find this lot')}
                body={t(
                  'web.publicTrace.notFoundBody',
                  'Check that the QR code or link is complete and try again. If it still does not work, ask the seller for a new code.',
                )}
                action={
                  <Link to="/" className={`${btnGhostCls} inline-flex items-center`}>
                    {t('web.publicTrace.home', 'Go to Farm to Market')}
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={<Glyph name="route" className="h-7 w-7" />}
                title={t('web.publicTrace.offlineTitle', 'We could not load this record')}
                body={t('web.publicTrace.offlineBody', 'Check your internet connection, then try again.')}
                action={
                  <button
                    type="button"
                    className={btnGhostCls}
                    onClick={() => void refetch()}
                    disabled={isFetching}
                    aria-busy={isFetching || undefined}
                  >
                    <BusyLabel
                      busy={isFetching}
                      label={t('web.publicTrace.retry', 'Try again')}
                      busyLabel={t('web.publicTrace.retrying', 'Trying again…')}
                    />
                  </button>
                }
              />
            )}
          </>
        ) : !data ? (
          <div className="certificate bg-[var(--paper-lift)] p-5">
            <Skeleton lines={4} label={t('web.publicTrace.loading', 'Loading the produce record')} />
          </div>
        ) : (
          <>
            <div className="certificate mb-5 bg-[var(--paper-lift)]">
              <div className="flex flex-wrap items-center gap-5 p-5">
                <div
                  className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl"
                  style={{ background: cropAccent(data.lot.commodityCode).wash, color: cropAccent(data.lot.commodityCode).ink }}
                >
                  <CropMark code={data.lot.commodityCode} className="h-12 w-12" />
                </div>
                <div className="min-w-44 flex-1">
                  <p className="text-sm text-[var(--ink-6)]">{t('web.publicTrace.eyebrow', 'Where this food came from')}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h1 className="headline text-3xl text-[var(--ink)] sm:text-4xl">
                      {data.lot.quantityKg.toLocaleString()} kg {data.lot.commodityName.toLowerCase()}
                    </h1>
                    <span className="flex items-center gap-1.5">
                      <GradeBadge grade={data.certification?.gradeBand ?? data.lot.declaredBand} />
                      {!data.certification && (
                        <span className="text-[11px] text-[var(--ink-6)]">
                          {t('web.publicTrace.declaredGrade', 'farmer’s own grade')}
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-[var(--ink-6)]">
                    {t('web.publicTrace.grownBy', 'Grown by')}{' '}
                    <span className="font-bold text-[var(--ink)]">
                      {data.farmer?.name ?? t('web.publicTrace.someFarmer', 'a verified farmer')}
                    </span>
                    {data.farmer && (
                      <>
                        {' '}
                        {t('web.publicTrace.in', 'in')} {data.farmer.district ? `${data.farmer.district}, ` : ''}
                        {data.farmer.regionName}
                      </>
                    )}
                  </p>
                  <p className="serial mt-1 text-[11px] text-[var(--ink-6)]">
                    {t('web.publicTrace.lotLine', 'Lot {code} · listed {date}', {
                      code: data.lot.lotCode,
                      date: shortDate(data.lot.createdAt),
                    })}
                  </p>
                </div>
                {data.certification && (
                  <div className="seal-land rounded-2xl border border-[var(--ink-3)] bg-[var(--paper)] px-4 py-3 text-center">
                    <div className="smallcaps text-[var(--ink-6)]">{t('web.publicTrace.checkedByAi', 'Checked by AI')}</div>
                    <div className="headline mt-0.5 text-2xl text-[var(--ink)]">
                      {(data.certification.gradeBand ?? data.lot.declaredBand) === 'REJECT'
                        ? t('web.publicTrace.rejected', 'Rejected')
                        : t('web.publicTrace.gradeBig', 'Grade {g}', { g: data.certification.gradeBand ?? data.lot.declaredBand })}
                    </div>
                    <div className="serial mt-0.5 text-[11px] text-[var(--ink-6)]">
                      {data.certification.confidence !== null && (
                        <>
                          {t('web.publicTrace.sure', '{pct}% sure', {
                            pct: (data.certification.confidence * 100).toFixed(0),
                          })}
                          {' · '}
                        </>
                      )}
                      {shortDate(data.certification.gradedAt)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <Card title={`${t('web.publicTrace.journeyTitle', 'Its journey')} — ${t('web.publicTrace.journeySub', 'from the farm to the market')}`}>
              <Journey trace={data} />
            </Card>

            {/* The story first; the full ledger stays one tap away, unchanged. */}
            <details className="group certificate mb-5 bg-[var(--paper-lift)]">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-[inherit] px-5 py-3 text-[15px] font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--paper)] [&::-webkit-details-marker]:hidden">
                <span>
                  {t('web.publicTrace.fullRecord', 'See the full record')}
                  <span className="ml-2 text-sm font-normal text-[var(--ink-6)]">
                    {data.events.length === 1
                      ? t('web.publicTrace.entryOne', '1 entry')
                      : t('web.publicTrace.entryMany', '{n} entries', { n: data.events.length })}
                  </span>
                </span>
                <Glyph name="chevron" className="h-4 w-4 shrink-0 transition-[rotate] duration-[var(--dur-base)] group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <div className="px-5 pb-5">
                <TraceEventLog events={data.events} />
                <p className="mt-3 border-t border-[var(--ink-2)] pt-3 text-[11px] leading-relaxed text-[var(--ink-6)]">
                  {t(
                    'web.publicTrace.recordNote',
                    'This record only grows. Each entry was written at the moment it happened, and no one can change or delete it. Personal and payment details are not shown here.',
                  )}
                </p>
              </div>
            </details>
          </>
        )}
      </main>
    </div>
  );
}

/**
 * The record told as a journey: up to seven stops a shopper understands,
 * each with the moment it happened, and the next stop still to come.
 * Built from the same entries as the full record below it.
 */
function Journey({ trace }: { trace: PublicTrace }) {
  const { t } = useT();
  const first = (types: string[]): TraceEvent | undefined =>
    trace.events.filter((e) => types.includes(e.type)).sort((a, b) => a.createdAt - b.createdAt)[0];
  const place = trace.farmer ? [trace.farmer.district, trace.farmer.regionName].filter(Boolean).join(', ') : trace.lot.regionName;
  const grade = trace.certification?.gradeBand;
  const stops: Array<{ key: string; title: string; detail?: string; at?: number }> = [
    {
      key: 'listed',
      title: trace.farmer
        ? t('web.publicTrace.jListed', 'Listed by {farmer}', { farmer: trace.farmer.name })
        : t('web.publicTrace.jListedAnon', 'Listed by the farmer'),
      detail: place,
      at: first(['LOT_REGISTERED'])?.createdAt ?? trace.lot.createdAt,
    },
    {
      key: 'sold',
      title: t('web.publicTrace.jSold', 'Sold to a buyer'),
      detail: first(['FUNDS_HELD']) ? t('web.publicTrace.jSoldHeld', 'The buyer’s money was held safely before pickup.') : undefined,
      at: first(['CONTRACT_ACCEPTED', 'LOT_SOLD'])?.createdAt,
    },
    { key: 'collected', title: t('web.publicTrace.jCollected', 'Collected from the farm'), at: first(['PICKUP_CONFIRMED', 'DRIVER_AT_PICKUP', 'IN_TRANSIT'])?.createdAt },
    {
      key: 'graded',
      title: grade && grade !== 'REJECT' ? t('web.publicTrace.jGraded', 'Checked: grade {g}', { g: grade }) : t('web.publicTrace.jGradedPlain', 'Quality checked'),
      detail:
        trace.certification?.confidence != null
          ? t('web.publicTrace.jGradedHow', 'From photos taken at pickup, {pct}% sure', { pct: (trace.certification.confidence * 100).toFixed(0) })
          : undefined,
      at: first(['GRADED', 'DISPUTE_RESOLVED'])?.createdAt,
    },
    { key: 'road', title: t('web.publicTrace.jRoad', 'On the road to market'), at: first(['DRIVER_DEPARTED'])?.createdAt },
    { key: 'delivered', title: t('web.publicTrace.jDelivered', 'Delivered'), at: first(['DRIVER_ARRIVED', 'DELIVERED', 'TRANSPORT_DELIVERED', 'RECEIPT_CONFIRMED'])?.createdAt },
    { key: 'paid', title: t('web.publicTrace.jPaid', 'The farmer was paid in full'), at: first(['SETTLED'])?.createdAt },
  ];
  // Reached stops, plus the one that comes next. A stop the sale skipped
  // (the buyer collected it, so no road) simply is not shown.
  const lastReached = stops.reduce((i, s, idx) => (s.at ? idx : i), -1);
  const shown = stops.filter((s, idx) => s.at || idx === lastReached + 1).filter((s, idx, arr) => s.at || idx === arr.length - 1);
  const closed = ['withdrawn', 'expired', 'cancelled'].includes(trace.lot.status) && !stops[1]!.at;

  return (
    <>
      <ol>
        {shown.map((s, i) => {
          const done = Boolean(s.at);
          const last = i === shown.length - 1;
          return (
            <li key={s.key} className="relative flex gap-3.5 pb-5 last:pb-0">
              {!last && (
                <span
                  aria-hidden
                  className={`absolute left-[11px] top-6 bottom-0 w-0.5 -translate-x-1/4 rounded-full ${done && shown[i + 1]?.at ? 'bg-[var(--forest)]/35' : 'border-l border-dashed border-[var(--ink-3)]'}`}
                />
              )}
              {done ? (
                <span aria-hidden className="relative mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[var(--forest)] text-[var(--paper-lift)]">
                  <Glyph name="check" className="h-3.5 w-3.5" />
                </span>
              ) : (
                <span aria-hidden className="step-current relative mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 border-[var(--gold)] bg-[var(--paper-lift)]">
                  <span className="h-2 w-2 rounded-full bg-[var(--gold)]" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className={`text-[15px] leading-snug ${done ? 'font-semibold text-[var(--ink)]' : 'text-[var(--ink-6)]'}`}>
                    {!done && <span className="smallcaps mr-2 text-[var(--gold-ink)]">{t('web.publicTrace.next', 'Next')}</span>}
                    {s.title}
                  </p>
                  {s.at && <span className="serial text-xs text-[var(--ink-6)]">{dateTime(s.at)}</span>}
                </div>
                {done && s.detail && <p className="mt-0.5 text-sm text-[var(--ink-6)]">{s.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {closed && (
        <p className="mt-4 rounded-2xl bg-[var(--paper-deep)] px-4 py-3 text-sm text-[var(--ink-7)]">
          {t('web.publicTrace.closed', 'This lot is no longer for sale.')}
        </p>
      )}
    </>
  );
}
