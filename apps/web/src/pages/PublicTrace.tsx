import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, shortDate, type PublicTrace } from '../api';
import { CropMark, cropAccent, F2MSeal, Glyph } from '../components/engrave';
import { SkipLink } from '../components/SkipLink';
import { btnGhostCls, BusyLabel, Card, EmptyState, GradeBadge, Skeleton } from '../components/ui';
import { useT } from '../lib/i18n';
import { SpineStepper, TraceEventLog } from './Trace';

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

            <Card title={`${t('web.publicTrace.progressTitle', 'Progress')} — ${t('web.publicTrace.progressSub', 'from listing to payment')}`}>
              <SpineStepper events={data.events} />
            </Card>

            <Card
              title={`${t('web.publicTrace.stepsTitle', 'Every step')} — ${
                data.events.length === 1
                  ? t('web.publicTrace.entryOne', '1 entry')
                  : t('web.publicTrace.entryMany', '{n} entries', { n: data.events.length })
              }`}
            >
              <TraceEventLog events={data.events} />
              <p className="mt-3 border-t border-[var(--ink-2)] pt-3 text-[11px] leading-relaxed text-[var(--ink-6)]">
                {t(
                  'web.publicTrace.recordNote',
                  'This record only grows. Each entry was written at the moment it happened, and no one can change or delete it. Personal and payment details are not shown here.',
                )}
              </p>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
