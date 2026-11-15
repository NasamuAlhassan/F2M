import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ghs, shortDate, type Registries } from '../api';
import { CropMark, Glyph } from '../components/engrave';
import { PriceChart, Sparkline, type SeriesPoint } from '../components/PriceChart';
import { PriceHint } from '../components/PriceHint';
import { WatchBox } from '../components/WatchBox';
import { Card, EmptyState, Field, LoadGate, inputCls, tableCls, tdCls, thCls } from '../components/ui';
import { useT } from '../lib/i18n';
import { POLL } from '../poll';

type Confidence = 'high' | 'medium' | 'low' | 'reference';
interface Estimate {
  pricePerKg: number;
  lowPerKg: number;
  highPerKg: number;
  confidence: Confidence;
  basis: Partial<Record<'deal' | 'market' | 'ask' | 'offer' | 'request' | 'reference', number>>;
  count: number;
  newestAt: number;
}
interface Trend {
  windowDays: number;
  change: number;
  direction: 'rising' | 'falling' | 'steady';
}
interface Unit {
  code: string;
  name: string;
  kgPerUnit: number;
}
interface CropRow {
  commodityCode: string;
  commodityName: string;
  unit: Unit | null;
  estimate: Estimate | null;
  trend: Trend | null;
  trendText: string;
  spark: number[];
  supplyKg: number;
  demandKg: number;
  sellers: number;
  balance: number | null;
}
interface Overview {
  generatedAt: number;
  crops: CropRow[];
}
interface CropDetail {
  commodityCode: string;
  commodityName: string;
  unit: Unit | null;
  estimate: Estimate | null;
  trend30: Trend | null;
  trend90: Trend | null;
  recent: SeriesPoint[];
  history: SeriesPoint[];
  markets: Array<{ market: string; regionCode: string | null; pricePerKg: number; observedAt: number; kind: 'report' | 'reference' }>;
  outlook: { text: string | null; peakMonth: number; lowMonth: number; years: number } | null;
  whereItIs: Array<{ regionCode: string; regionName: string; supplyKg: number; sellers: number; demandKg: number; buyers: number; balance: number | null }>;
}

const DAY = 86_400_000;
const kgFmt = (kg: number) => kg.toLocaleString('en-GH', { maximumFractionDigits: 0 });
const ageText = (ms: number) => {
  const d = Math.max(0, Math.round((Date.now() - ms) / DAY));
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

/** Direction as an arrow plus words: never colour alone, and no good/bad colour — rising is good news to a seller and bad news to a buyer. */
function TrendMark({ trend, text }: { trend: Trend | null; text: string }) {
  if (!trend) return null;
  const arrow = trend.direction === 'rising' ? '↑' : trend.direction === 'falling' ? '↓' : '→';
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--ink-7)]">
      <span aria-hidden="true" className="serial text-sm">{arrow}</span>
      {text}
    </span>
  );
}

export function PricesPage() {
  const { t } = useT();
  const [regionCode, setRegionCode] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data: registries } = useQuery({ queryKey: ['registries'], queryFn: () => api<Registries>('/api/registries'), staleTime: 5 * 60_000 });
  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ['price-overview', regionCode],
    queryFn: () => api<Overview>(`/api/prices/overview${regionCode ? `?regionCode=${regionCode}` : ''}`),
    refetchInterval: POLL.slow,
  });

  // Open on the crop with the most to say.
  useEffect(() => {
    if (!selected && data) {
      const first = [...data.crops].sort((a, b) => (b.estimate?.count ?? 0) - (a.estimate?.count ?? 0))[0];
      if (first) setSelected(first.commodityCode);
    }
  }, [data, selected]);

  const heading = (
    <>
      <h1 className="headline text-3xl text-[var(--ink)] sm:text-4xl">{t('web.prices.title', 'Market prices')}</h1>
      <p className="mb-5 mt-1 max-w-2xl text-sm text-[var(--ink-6)]">
        {t(
          'web.prices.subtitleLive',
          'What each crop is fetching now, which way it is moving, and who has it or wants it. Updated as deals and listings happen.',
        )}
      </p>
    </>
  );

  if (!data) {
    return (
      <div>
        {heading}
        <LoadGate isError={isError} retrying={isFetching} onRetry={() => void refetch()} label={t('web.prices.loadLabel', 'market prices')} />
      </div>
    );
  }

  const withData = data.crops.filter((c) => c.estimate && c.estimate.confidence !== 'reference');
  const movers = data.crops.filter((c) => c.trend).sort((a, b) => Math.abs(b.trend!.change) - Math.abs(a.trend!.change));
  // Only a crop buyers want more of than is listed is "scarce"; otherwise name the one most wanted.
  const wanted = data.crops.filter((c) => c.balance !== null).sort((a, b) => a.balance! - b.balance!)[0];
  const tightest = wanted && wanted.balance! < 1 ? wanted : undefined;
  const mostWanted = tightest ? undefined : data.crops.filter((c) => c.demandKg > 0).sort((a, b) => b.demandKg - a.demandKg)[0];
  const newest = Math.max(0, ...data.crops.map((c) => c.estimate?.newestAt ?? 0));

  if (data.crops.length === 0) {
    return (
      <div>
        {heading}
        <EmptyState
          icon={<Glyph name="scale" className="h-7 w-7" />}
          title={t('web.prices.emptyTitle', 'No prices yet')}
          body={t('web.prices.emptyBody', 'Prices show here as soon as the first market reports them.')}
        />
      </div>
    );
  }

  return (
    <div>
      {heading}

      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div className="w-full sm:w-64">
          <Field label={t('web.prices.region', 'Where')}>
            <select className={inputCls} value={regionCode} onChange={(e) => setRegionCode(e.target.value)}>
              <option value="">{t('web.prices.allGhana', 'All of Ghana')}</option>
              {(registries?.regions ?? []).map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="pb-2 text-xs text-[var(--ink-6)]" aria-live="polite">
          <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[var(--forest)] align-middle" />
          {newest > 0
            ? t('web.prices.newestReading', 'Newest reading {when}', { when: ageText(newest) })
            : t('web.prices.noLiveYet', 'No live readings yet — showing reference prices')}
        </p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label={t('web.prices.kpiLive', 'Crops with live prices')} value={`${withData.length} / ${data.crops.length}`} sub={t('web.prices.kpiLiveSub', 'backed by recent deals or reports')} />
        <Kpi
          label={t('web.prices.kpiMover', 'Biggest move')}
          value={movers[0] ? `${movers[0].trend!.change > 0 ? '+' : '−'}${Math.round(Math.abs(movers[0].trend!.change) * 100)}%` : '—'}
          sub={movers[0] ? `${movers[0].commodityName}, ${movers[0].trend!.windowDays} days` : t('web.prices.kpiMoverNone', 'needs two months of readings')}
          accent
        />
        <Kpi
          label={tightest ? t('web.prices.kpiTight', 'Scarcest right now') : t('web.prices.kpiWanted', 'Most wanted')}
          value={(tightest ?? mostWanted)?.commodityName ?? '—'}
          sub={
            tightest || mostWanted
              ? t('web.prices.kpiTightSub', 'buyers want {want} kg, {have} kg listed', {
                  want: kgFmt((tightest ?? mostWanted)!.demandKg),
                  have: kgFmt((tightest ?? mostWanted)!.supplyKg),
                })
              : t('web.prices.kpiTightNone', 'no open buyer requests')
          }
        />
        <Kpi
          label={t('web.prices.kpiSupply', 'Listed for sale')}
          value={`${kgFmt(data.crops.reduce((s, c) => s + c.supplyKg, 0))} kg`}
          sub={t('web.prices.kpiSupplySub', 'from {n} sellers', { n: data.crops.reduce((s, c) => s + c.sellers, 0) })}
        />
      </div>

      <ul className="mb-6 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {data.crops.map((c) => {
          const on = c.commodityCode === selected;
          return (
            <li key={c.commodityCode}>
              <button
                type="button"
                onClick={() => {
                  setSelected(c.commodityCode);
                  // On a phone the detail sits below every crop: bring it into view.
                  requestAnimationFrame(() => {
                    const el = document.getElementById('crop-detail');
                    if (!el || el.getBoundingClientRect().top < window.innerHeight * 0.6) return;
                    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
                  });
                }}
                aria-pressed={on}
                className={`certificate flex min-h-11 w-full flex-col gap-2 bg-[var(--paper-lift)] p-4 text-left transition-[border-color,background-color] hover:bg-[var(--paper)] ${on ? 'ring-2 ring-[var(--forest)]' : ''}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold text-[var(--ink)]">
                    <CropMark code={c.commodityCode} className="h-6 w-6" />
                    {c.commodityName}
                  </span>
                  <Confidence level={c.estimate?.confidence ?? null} />
                </span>
                {c.estimate ? (
                  <span className="flex items-end justify-between gap-3">
                    <span>
                      <span className="serial block text-2xl font-bold text-[var(--ink)]">
                        {ghs(c.estimate.pricePerKg)}
                        <span className="ml-1 text-xs font-medium text-[var(--ink-6)]">/ kg</span>
                      </span>
                      {c.unit && (
                        <span className="text-xs text-[var(--ink-6)]">
                          {t('web.prices.perUnit', '{price} per {unit}', { price: ghs(Math.round(c.estimate.pricePerKg * c.unit.kgPerUnit)), unit: c.unit.name.toLowerCase() })}
                        </span>
                      )}
                    </span>
                    <Sparkline values={c.spark} label={t('web.prices.sparkLabel', '{crop} price over the last 12 weeks', { crop: c.commodityName })} />
                  </span>
                ) : (
                  <span className="text-sm text-[var(--ink-6)]">{t('web.prices.noPrice', 'No recent price yet')}</span>
                )}
                <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-[var(--ink-6)]">
                  <TrendMark trend={c.trend} text={c.trendText} />
                  <span>
                    {t('web.prices.supplyDemand', '{have} kg listed · {want} kg wanted', { have: kgFmt(c.supplyKg), want: kgFmt(c.demandKg) })}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {selected && (
        <div id="crop-detail" className="scroll-mt-24">
          <CropPanel code={selected} regionCode={regionCode} />
        </div>
      )}
    </div>
  );
}

function Confidence({ level }: { level: Confidence | null }) {
  const { t } = useT();
  const text =
    level === 'high'
      ? t('web.prices.confHigh', 'Live')
      : level === 'medium'
        ? t('web.prices.confMedium', 'Fairly recent')
        : level === 'low'
          ? t('web.prices.confLow', 'Few reports')
          : level === 'reference'
            ? t('web.prices.confReference', 'Reference only')
            : t('web.prices.confNone', 'No data');
  return <span className="smallcaps rounded-full bg-[var(--paper-deep)] px-2 py-0.5 text-[11px] text-[var(--ink-7)]">{text}</span>;
}

function CropPanel({ code, regionCode }: { code: string; regionCode: string }) {
  const { t } = useT();
  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ['price-crop', code, regionCode],
    queryFn: () => api<CropDetail>(`/api/prices/crop/${code}${regionCode ? `?regionCode=${regionCode}` : ''}`),
    refetchInterval: POLL.slow,
  });
  const [side, setSide] = useState<'sell' | 'buy'>('sell');
  const [typed, setTyped] = useState('');

  if (!data) {
    return <LoadGate isError={isError} retrying={isFetching} onRetry={() => void refetch()} label={t('web.prices.loadLabel', 'market prices')} />;
  }
  const e = data.estimate;
  const longHasRecent = data.history.some((p) => p.t > Date.now() - 365 * DAY);
  const lastHistory = data.history[data.history.length - 1];
  const typedPesewas = typed.trim() && Number(typed) > 0 ? Math.round(Number(typed) * 100) : null;
  const basisText = e
    ? Object.entries(e.basis)
        .filter(([, n]) => n)
        .map(([k, n]) => BASIS_WORD(t, k, n as number))
        .join(', ')
    : '';

  return (
    <section aria-label={data.commodityName} className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Card title={`${data.commodityName} — ${t('web.prices.detailTitle', 'price and outlook')}`}>
        <div className="space-y-5 p-4">
          {e ? (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="serial text-3xl font-bold text-[var(--ink)]">
                  {ghs(e.pricePerKg)} <span className="text-sm font-medium text-[var(--ink-6)]">/ kg</span>
                </p>
                <p className="text-xs text-[var(--ink-6)]">
                  {t('web.prices.usually', 'Usually {low} – {high}', { low: ghs(e.lowPerKg), high: ghs(e.highPerKg) })}
                  {data.unit && ` · ${ghs(Math.round(e.pricePerKg * data.unit.kgPerUnit))} ${t('web.prices.perUnitShort', 'per {unit}', { unit: data.unit.name.toLowerCase() })}`}
                </p>
              </div>
              <div className="text-right text-xs text-[var(--ink-6)]">
                <TrendMark trend={data.trend30} text={data.trend30 ? `${data.trend30.direction === 'rising' ? '+' : data.trend30.direction === 'falling' ? '−' : ''}${Math.round(Math.abs(data.trend30.change) * 100)}% ${t('web.prices.in30', 'in 30 days')}` : ''} />
                {data.trend90 && <p>{`${data.trend90.change >= 0 ? '+' : '−'}${Math.round(Math.abs(data.trend90.change) * 100)}% ${t('web.prices.in90', 'in 90 days')}`}</p>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--ink-6)]">{t('web.prices.noPriceLong', 'There is no recent price for this crop yet. It appears as soon as someone lists it, bids or reports a market price.')}</p>
          )}

          {e && (
            <p className="text-xs leading-relaxed text-[var(--ink-6)]">
              {t('web.prices.basedOn', 'Based on {basis}. Newest {when}.', { basis: basisText, when: ageText(e.newestAt) })}
              {e.confidence === 'reference' && ` ${t('web.prices.referenceWarn', 'These are placeholder reference prices, not live ones.')}`}
            </p>
          )}

          {data.outlook?.text && (
            <p className="rounded-xl bg-[var(--gold-wash)] px-3 py-2 text-xs leading-snug text-[var(--gold-ink)]">
              {data.outlook.text}{' '}
              {t('web.prices.outlookBasis', 'Based on {years} years of market history; a usual pattern, not a forecast.', { years: data.outlook.years })}
            </p>
          )}

          {data.recent.length > 1 ? (
            <PriceChart points={data.recent} bucketDays={7} label={t('web.prices.chartRecent', 'Last four months, weekly')} />
          ) : (
            e && <p className="text-xs text-[var(--ink-6)]">{t('web.prices.chartThin', 'A chart appears once there are readings in two different weeks.')}</p>
          )}

          {data.history.length > 1 && (
            <div>
              <PriceChart points={data.history} bucketDays={30} long label={t('web.prices.chartHistory', 'Six years, monthly')} />
              {!longHasRecent && lastHistory && (
                <p className="mt-1 text-xs text-[var(--ink-6)]">
                  {t('web.prices.historyEnds', 'The official market history ends {date}. Prices then were lower across the board, so use it for the shape of the year, not today’s level.', {
                    date: new Date(lastHistory.t).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      <div className="space-y-5">
        <Card title={t('web.prices.checkTitle', 'Check a price')}>
          <div className="space-y-3 p-4">
            <div role="group" aria-label={t('web.prices.iAm', 'I am')} className="flex gap-2">
              {(['sell', 'buy'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={side === s}
                  onClick={() => setSide(s)}
                  className={`min-h-11 flex-1 rounded-full border px-3 text-sm font-semibold ${side === s ? 'border-[var(--forest)] bg-[var(--forest)] text-[var(--paper-lift)]' : 'border-[var(--ink-4)] text-[var(--ink)]'}`}
                >
                  {s === 'sell' ? t('web.prices.selling', 'Selling') : t('web.prices.buying', 'Buying')}
                </button>
              ))}
            </div>
            <Field label={data.unit ? t('web.prices.priceUnitLabel', 'Price per {unit} (GHS)', { unit: data.unit.name.toLowerCase() }) : t('web.prices.priceKgLabel', 'Price per kg (GHS)')}>
              <input className={inputCls} inputMode="decimal" value={typed} onChange={(ev) => setTyped(ev.target.value)} placeholder="0.00" />
            </Field>
            <PriceHint commodityCode={code} unitCode={data.unit?.code ?? null} price={typedPesewas} side={side} />
          </div>
        </Card>

        <Card title={t('web.prices.whereTitle', 'Where it is, where it is wanted')}>
          {data.whereItIs.length === 0 ? (
            <p className="p-4 text-xs text-[var(--ink-6)]">{t('web.prices.whereNone', 'Nobody has listed or asked for this crop right now.')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <caption className="sr-only">{t('web.prices.whereCaption', 'Kilograms listed and requested, by region')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={thCls}>{t('web.prices.colRegion', 'Region')}</th>
                    <th scope="col" className={`${thCls} text-right`}>{t('web.prices.colListed', 'Listed')}</th>
                    <th scope="col" className={`${thCls} text-right`}>{t('web.prices.colWanted', 'Wanted')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.whereItIs.map((r) => (
                    <tr key={r.regionCode}>
                      <td className={tdCls}>
                        {r.regionName}
                        {r.balance !== null && r.balance < 1 && (
                          <span className="ml-1.5 text-[11px] font-semibold text-[var(--gold-ink)]">{t('web.prices.scarce', 'short')}</span>
                        )}
                      </td>
                      <td className={`${tdCls} serial text-right`}>
                        {kgFmt(r.supplyKg)} kg
                        <span className="block text-[11px] text-[var(--ink-6)]">{r.sellers === 1 ? t('web.prices.sellerOne', '1 seller') : t('web.prices.sellersN', '{n} sellers', { n: r.sellers })}</span>
                      </td>
                      <td className={`${tdCls} serial text-right`}>
                        {kgFmt(r.demandKg)} kg
                        <span className="block text-[11px] text-[var(--ink-6)]">{r.buyers === 1 ? t('web.prices.buyerOne', '1 buyer') : t('web.prices.buyersN', '{n} buyers', { n: r.buyers })}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={t('web.alerts.title', 'Alerts')}>
          <WatchBox commodityCode={code} commodityName={data.commodityName} />
        </Card>

        <Card title={t('web.prices.byMarket', 'By market')}>
          {data.markets.length === 0 ? (
            <p className="p-4 text-xs text-[var(--ink-6)]">{t('web.prices.noMarkets', 'No market has reported this crop recently.')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <caption className="sr-only">{t('web.prices.marketCaption', 'Latest price per kg at each market')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={thCls}>{t('web.prices.colMarket', 'Market')}</th>
                    <th scope="col" className={`${thCls} text-right`}>{t('web.prices.colPrice', 'Per kg')}</th>
                    <th scope="col" className={thCls}>{t('web.prices.colSeen', 'Seen')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.markets.map((m) => (
                    <tr key={m.market}>
                      <td className={tdCls}>
                        {m.market}
                        {m.kind === 'reference' && <span className="ml-1.5 text-[11px] text-[var(--ink-6)]">{t('web.prices.refTag', 'reference')}</span>}
                      </td>
                      <td className={`${tdCls} serial text-right`}>{ghs(m.pricePerKg)}</td>
                      <td className={`${tdCls} text-[var(--ink-6)]`}>{shortDate(m.observedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="certificate bg-[var(--paper-lift)] p-4">
      <p className="smallcaps text-[var(--ink-6)]">{label}</p>
      <p className={`serial mt-1.5 text-2xl font-bold ${accent ? 'text-[var(--gold-deep)]' : 'text-[var(--ink)]'}`}>{value}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-[var(--ink-6)]">{sub}</p>
    </div>
  );
}

/** "1 deal", "2 deals": each kind of price reading, counted. */
function BASIS_WORD(t: ReturnType<typeof useT>['t'], kind: string, n: number): string {
  const one = n === 1;
  switch (kind) {
    case 'deal':
      return one ? t('web.prices.bDeal1', '1 deal') : t('web.prices.bDeals', '{n} deals', { n });
    case 'market':
      return one ? t('web.prices.bMarket1', '1 market report') : t('web.prices.bMarkets', '{n} market reports', { n });
    case 'ask':
      return one ? t('web.prices.bAsk1', '1 asking price') : t('web.prices.bAsks', '{n} asking prices', { n });
    case 'offer':
      return one ? t('web.prices.bOffer1', '1 offer') : t('web.prices.bOffers', '{n} offers', { n });
    case 'request':
      return one ? t('web.prices.bRequest1', '1 buyer request') : t('web.prices.bRequests', '{n} buyer requests', { n });
    default:
      return one ? t('web.prices.bRef1', '1 reference quote') : t('web.prices.bRefs', '{n} reference quotes', { n });
  }
}
