import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ghs, shortDate, type Demand, type Registries } from '../api';
import { POLL } from '../poll';
import { NewDemandForm } from '../components/DemandForm';
import { MatchBanner, MatchRow, SimulationDrawer, type Feed } from '../components/engine';
import { CropMark, Glyph } from '../components/engrave';
import { Modal } from '../components/Modal';
import { btnCls, btnGhostCls, BusyLabel, Card, EmptyState, ErrorStamp, numCls, pillCls, plateBtnCls, Skeleton, StateBadge, tableCls, TableScroll, tdCls, thCls } from '../components/ui';
import { useT } from '../lib/i18n';

const regionLabel = (code: string): string =>
  code
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');

/**
 * Orders = the buyer's order book and the engine working it, on one page:
 * my demands (compact ledger, form in a modal), the advice-of-match notice
 * when an offer is live, and the intent feed the engine matches against.
 */
export function OrdersPage() {
  const { t } = useT();
  const queryClient = useQueryClient();
  // The registry never polls, so one failed fetch used to leave "+ New Demand"
  // permanently inert — it set state and the modal, gated on `registries`,
  // rendered nothing. The trigger now waits out the first load and the modal
  // owns the failure.
  const {
    data: registries,
    isPending: registriesPending,
    isFetching: registriesFetching,
    refetch: refetchRegistries,
  } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries') });
  const { data: demandData, isPending: demandsPending, isError: demandsFailed } = useQuery({
    queryKey: ['demands'],
    queryFn: () => api<{ demands: Demand[] }>('/api/demands'),
    refetchInterval: POLL.active,
  });
  const { data: feed, isPending: feedPending, isError: feedFailed } = useQuery({
    queryKey: ['engine-feed'],
    queryFn: () => api<Feed>('/api/engine/feed'),
    refetchInterval: POLL.active,
  });

  const [showForm, setShowForm] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commodityById = useMemo(
    () => new Map((registries?.commodities ?? []).map((c) => [c.id, c])),
    [registries],
  );

  const simulate = useMutation({
    mutationFn: (contractId: string) =>
      api('/api/engine/simulate-accept', { method: 'POST', body: JSON.stringify({ contractId }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['engine-feed'] }),
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed'),
  });

  const matches = feed?.matches ?? [];
  const newestOffered = matches.find((m) => m.state === 'OFFERED') ?? null;
  // The banner above carries the live offer, so this list is everything else,
  // capped for the card. The card's title counts `matches`, not the cap — the
  // capped array under-reported the moment a buyer had more than five.
  const restMatches = matches.filter((m) => m !== newestOffered).slice(0, 5);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="headline text-3xl text-[var(--ink)] sm:text-4xl">{t('web.orders.title', 'Orders')}</h1>
          <p className="mt-1 text-sm text-[var(--ink-6)]">
            {t('web.orders.subtitle', "What you want to buy. When a farmer's lot fits, we reserve it and tell the farmer straight away.")}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          <span
            className="hidden items-center gap-1.5 text-xs text-[var(--ink-6)] sm:flex"
            title={t('web.orders.matchingHint', 'New listings are checked against your orders as they arrive')}
          >
            <span className="ember inline-block h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
            {t('web.orders.matchingLive', 'Matching live')}
          </span>
          <button
            type="button"
            className={`${btnCls} w-full sm:w-auto`}
            onClick={() => setShowForm(true)}
            disabled={registriesPending}
            aria-busy={registriesPending || undefined}
            title={registriesPending ? 'Loading the crop registry…' : undefined}
          >
            <BusyLabel busy={registriesPending} label={t('web.orders.post', 'Post what you need')} />
          </button>
        </div>
      </div>
      {error && (
        <ErrorStamp message={error} onDismiss={() => setError(null)} className="mb-4" />
      )}

      {newestOffered && (
        <MatchBanner
          match={newestOffered}
          simulateEnabled={feed?.simulateEnabled ?? false}
          onPreview={() => setPreview(newestOffered.contractId)}
          onSimulate={() => simulate.mutate(newestOffered.contractId)}
          simulating={simulate.isPending && simulate.variables === newestOffered.contractId}
        />
      )}

      <div className={demandsPending || demandsFailed || demandData?.demands.length ? 'certificate mb-4 overflow-hidden bg-[var(--paper-lift)] p-3' : 'mb-4'}>
        {/* A cold load, a dead wire and a genuinely empty order book all collapse
            to the same missing table — so each states which one it is. Telling a
            buyer with live orders that they have none is the worst of the three. */}
        {demandsPending ? (
          <div className="p-4">
            <Skeleton lines={4} label={t('web.orders.loading', 'Loading your orders')} />
          </div>
        ) : demandsFailed ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="font-semibold text-[var(--stamp)]">Couldn't load your demands</div>
            <div className="mt-1 text-sm text-[var(--ink-6)]">The page keeps retrying — nothing you posted is lost</div>
          </div>
        ) : !demandData?.demands.length ? (
          <EmptyState
            icon={<CropMark code="MAIZE" className="h-7 w-7" />}
            title={t('web.orders.emptyTitle', 'Tell farmers what you need')}
            body={t(
              'web.orders.emptyBody',
              'Say the crop, how much and your price. We match it against every lot listed now, and every new one as it arrives.',
            )}
            action={
              <button
                type="button"
                className={btnCls}
                onClick={() => setShowForm(true)}
                disabled={registriesPending}
                aria-busy={registriesPending || undefined}
              >
                <BusyLabel busy={registriesPending} label={t('web.orders.post', 'Post what you need')} />
              </button>
            }
          />
        ) : (
          <>
          {/* Phones: one card per order, the whole card opens its matches. */}
          <ul className="flex flex-col gap-2 sm:hidden">
            {demandData.demands.map((d) => {
              const commodity = commodityById.get(d.commodityId);
              return (
                <li key={d.id}>
                  <Link
                    to={`/demands/${d.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-[var(--ink-2)] bg-[var(--paper)] p-3.5 transition-[background-color,scale] active:scale-[0.99] active:bg-[var(--paper-deep)]"
                  >
                    <CropMark code={commodity?.code ?? ''} className="h-7 w-7 flex-shrink-0 text-[var(--ink-7)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-bold text-[var(--ink)]">{commodity?.name ?? t('web.orders.crop', 'Produce')}</span>
                        <StateBadge state={d.status} />
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--ink-6)]">
                        {t('web.orders.cardLine', '{kg} kg · {left} kg still to find · grade {band} or better', {
                          kg: d.quantityKg,
                          left: d.remainingKg,
                          band: d.minBand,
                        })}
                      </div>
                      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-[var(--ink-6)]">
                        <span className="serial text-sm font-bold text-[var(--gold-deep)]">
                          {ghs(d.priceTerms[d.minBand as 'A' | 'B' | 'C'] ?? 0)}/kg
                        </span>
                        <span>
                          {shortDate(d.windowStart)} to {shortDate(d.windowEnd)}
                        </span>
                      </div>
                    </div>
                    <Glyph name="chevron" className="h-4 w-4 flex-shrink-0 -rotate-90 text-[var(--ink-5)]" />
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="hidden sm:block">
          <TableScroll minWidth={640}>
          <table className={tableCls}>
            <thead>
              <tr>
                <th className={thCls}>Commodity</th>
                <th className={thCls}>Quantity</th>
                <th className={thCls}>Remaining</th>
                <th className={thCls}>Min Grade</th>
                <th className={thCls}>Price (min band)</th>
                <th className={thCls}>Window</th>
                <th className={thCls}>Status</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {demandData.demands.map((d) => {
                const commodity = commodityById.get(d.commodityId);
                return (
                  <tr key={d.id} className="hover:bg-[var(--paper)]">
                    <td className={`${tdCls} font-bold`}>
                      <span className="flex items-center gap-2">
                        <CropMark code={commodity?.code ?? ''} className="h-5 w-5 flex-shrink-0 text-[var(--ink-7)]" />
                        {commodity?.name ?? '—'}
                      </span>
                    </td>
                    <td className={`${tdCls} ${numCls} text-xs`}>{d.quantityKg} kg</td>
                    <td className={`${tdCls} ${numCls} text-xs`}>{d.remainingKg} kg</td>
                    <td className={`${tdCls} display font-semibold`}>{d.minBand}</td>
                    <td className={tdCls}>
                      <span className="serial font-bold text-[var(--gold-deep)]">
                        {ghs(d.priceTerms[d.minBand as 'A' | 'B' | 'C'] ?? 0)}
                      </span>
                      <span className="smallcaps ml-1 text-[var(--ink-6)]">/kg</span>
                    </td>
                    <td className={`${tdCls} text-xs text-[var(--ink-6)]`}>
                      {shortDate(d.windowStart)} – {shortDate(d.windowEnd)}
                    </td>
                    <td className={tdCls}>
                      <StateBadge state={d.status} />
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <Link className={pillCls} to={`/demands/${d.id}`}>
                        Matches
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </TableScroll>
          </div>
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`${t('web.orders.matchesTitle', 'Recent matches')}${matches.length ? ` (${matches.length})` : ''}`}>
          {feedPending ? (
            <p className="text-sm text-[var(--ink-6)]">Loading…</p>
          ) : feedFailed ? (
            <p className="text-sm text-[var(--stamp)]">Couldn't reach the engine — retrying.</p>
          ) : restMatches.length === 0 ? (
            /* Keyed on this list alone: a single OFFERED match lives in the banner
               above and leaves this one empty — the first-run state for every new
               buyer — and the old `&& !newestOffered` mapped it to a blank card. */
            <p className="text-sm text-[var(--ink-6)]">
              {newestOffered
                ? 'The live offer above is the only match so far — the rest land here as the engine works.'
                : t('web.orders.noMatches', 'No matches yet. Post what you need and we will look for it.')}
            </p>
          ) : (
            restMatches.map((m) => (
              <MatchRow
                key={m.contractId}
                match={m}
                simulateEnabled={feed?.simulateEnabled ?? false}
                onPreview={() => setPreview(m.contractId)}
                onSimulate={() => simulate.mutate(m.contractId)}
                simulating={simulate.isPending && simulate.variables === m.contractId}
              />
            ))
          )}
        </Card>

        <Card title={`${t('web.orders.feedTitle', 'Just listed')} — ${t('web.orders.feedSub', 'produce on the market now ({n})', { n: feed?.lots.length ?? 0 })}`}>
          {feedPending ? (
            <p className="text-sm text-[var(--ink-6)]">Loading…</p>
          ) : feedFailed ? (
            <p className="text-sm text-[var(--stamp)]">Couldn't reach the engine — retrying.</p>
          ) : !feed?.lots.length ? (
            <p className="text-sm text-[var(--ink-6)]">No open produce listings right now.</p>
          ) : (
            <div>
              {feed.lots.slice(0, 6).map((l) => (
                <div key={l.lotCode} className="border-b border-[var(--ink-2)] py-2.5 text-sm last:border-b-0">
                  <p className="font-bold text-[var(--ink)]">
                    {l.remainingKg}kg {l.commodityName}
                    <span className="serial ml-2 text-[11px] font-normal text-[var(--ink-6)]">{l.lotCode}</span>
                  </p>
                  <p className="text-xs text-[var(--ink-6)]">
                    {l.farmerName} · {t('web.orders.grade', 'grade {g}', { g: l.declaredBand })} · {regionLabel(l.regionCode)} · ready {shortDate(l.readyDate)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {showForm && (
        <Modal label="Post a new demand" onClose={() => setShowForm(false)}>
            <div className="certificate overflow-hidden bg-[var(--paper)]">
              <div className="plate on-dark flex items-center justify-between gap-4 px-6 py-5">
                <div>
                  <p className="headline text-2xl">{t('web.orders.formTitle', 'Post what you need')}</p>
                  <p className="mt-1 text-sm text-[var(--ink-2)]">
                    {t('web.orders.formHint', 'We start looking for it as soon as you post.')}
                  </p>
                </div>
                <button type="button" className={plateBtnCls} onClick={() => setShowForm(false)}>
                  Close
                </button>
              </div>
              <div className="p-4">
                {registries ? (
                  <NewDemandForm
                    registries={registries}
                    onDone={() => setShowForm(false)}
                    onCancel={() => setShowForm(false)}
                  />
                ) : (
                  /* The trigger already waits out the first load, so an absent
                     registry here means the fetch failed — say so and hand over
                     the one control that fixes it, never an empty dialog. */
                  <div className="py-8 text-center">
                    <p className="text-sm text-[var(--ink-6)]">Couldn't load the crop registry — the demand form needs it.</p>
                    <button
                      type="button"
                      className={`${btnGhostCls} mt-3`}
                      onClick={() => refetchRegistries()}
                      disabled={registriesFetching}
                      aria-busy={registriesFetching || undefined}
                    >
                      <BusyLabel busy={registriesFetching} label="Try again" busyLabel="Retrying…" />
                    </button>
                  </div>
                )}
              </div>
            </div>
        </Modal>
      )}

      {preview && <SimulationDrawer contractId={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
