import { useId, useMemo, useState } from 'react';
import { ghs } from '../api';
import { useT } from '../lib/i18n';

export interface SeriesPoint {
  t: number; // start of the bucket, ms
  median: number; // pesewas per kg
  low: number;
  high: number;
  count: number;
}

const W = 640;
const H = 240;
const M = { top: 26, right: 74, bottom: 26, left: 54 };

const fmtDate = (ms: number, long: boolean) =>
  new Date(ms).toLocaleDateString('en-GB', long ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });

/** Four or five round tick values spanning [lo, hi]. */
function niceTicks(lo: number, hi: number): number[] {
  const span = Math.max(hi - lo, 1);
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/**
 * One crop's price over time: the middle price as a line, the usual range as a
 * quiet band behind it, the latest value labelled at the end. One series, so
 * no legend; the heading names it. A gap in the data breaks the line instead of
 * drawing across it, and a table view carries the same numbers for anyone who
 * cannot read a chart (D-053).
 */
export function PriceChart({ points, bucketDays, long, label }: { points: SeriesPoint[]; bucketDays: number; long?: boolean; label: string }) {
  const { t } = useT();
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const geo = useMemo(() => {
    if (points.length === 0) return null;
    const t0 = points[0]!.t;
    const t1 = points[points.length - 1]!.t + bucketDays * 86_400_000;
    const lo = Math.min(...points.map((p) => p.low));
    const hi = Math.max(...points.map((p) => p.high));
    const pad = (hi - lo) * 0.12 || hi * 0.1 || 10;
    const ticks = niceTicks(Math.max(0, lo - pad), hi + pad);
    const yMin = Math.min(ticks[0] ?? lo, lo - pad);
    const yMax = Math.max(ticks[ticks.length - 1] ?? hi, hi + pad);
    const x = (ms: number) => M.left + ((ms - t0) / Math.max(t1 - t0, 1)) * (W - M.left - M.right);
    const y = (v: number) => M.top + (1 - (v - yMin) / Math.max(yMax - yMin, 1)) * (H - M.top - M.bottom);
    // Break the line wherever more than two empty buckets sit between neighbours.
    const segments: SeriesPoint[][] = [];
    for (const p of points) {
      const last = segments[segments.length - 1];
      if (last && p.t - last[last.length - 1]!.t <= bucketDays * 86_400_000 * 3) last.push(p);
      else segments.push([p]);
    }
    return { t0, t1, x, y, ticks, segments };
  }, [points, bucketDays]);

  if (!geo) return null;
  const { x, y, ticks, segments } = geo;
  const last = points[points.length - 1]!;
  const active = hover !== null ? points[hover]! : null;
  const xOf = (p: SeriesPoint) => x(p.t + (bucketDays * 86_400_000) / 2);

  function nearest(clientX: number, el: SVGSVGElement) {
    const rect = el.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(xOf(p) - px) < Math.abs(xOf(points[best]!) - px)) best = i;
    });
    setHover(best);
  }

  const summary = t('web.prices.chartSummary', '{label}: {n} readings, from {from} to {to}. Latest {price} per kg.', {
    label,
    n: points.length,
    from: fmtDate(points[0]!.t, Boolean(long)),
    to: fmtDate(last.t, Boolean(long)),
    price: ghs(last.median),
  });

  return (
    <figure className="m-0">
      <div className="mb-1 flex items-center justify-between gap-3">
        <figcaption className="smallcaps text-[var(--ink-6)]">{label}</figcaption>
        <button
          type="button"
          onClick={() => setTable((v) => !v)}
          aria-pressed={table}
          className="smallcaps min-h-8 rounded-full px-3 text-[var(--ink-6)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
        >
          {table ? t('web.prices.viewChart', 'Chart') : t('web.prices.viewTable', 'Table')}
        </button>
      </div>

      {table ? (
        <div className="max-h-64 overflow-auto rounded-xl border border-[var(--ink-2)]">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{summary}</caption>
            <thead className="sticky top-0 bg-[var(--paper-lift)]">
              <tr className="text-[var(--ink-6)]">
                <th scope="col" className="px-3 py-2 font-semibold">{t('web.prices.colPeriod', 'Period')}</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">{t('web.prices.colMiddle', 'Middle price / kg')}</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">{t('web.prices.colRange', 'Usual range')}</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">{t('web.prices.colReports', 'Reports')}</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.t} className="border-t border-[var(--ink-1)]">
                  <td className="px-3 py-1.5">{fmtDate(p.t, Boolean(long))}</td>
                  <td className="serial px-3 py-1.5 text-right">{ghs(p.median)}</td>
                  <td className="serial px-3 py-1.5 text-right text-[var(--ink-6)]">{ghs(p.low)} – {ghs(p.high)}</td>
                  <td className="px-3 py-1.5 text-right text-[var(--ink-6)]">{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="block h-auto w-full touch-pan-y select-none"
            role="img"
            aria-label={summary}
            aria-describedby={`${id}-hint`}
            tabIndex={0}
            onPointerMove={(e) => nearest(e.clientX, e.currentTarget)}
            onPointerDown={(e) => nearest(e.clientX, e.currentTarget)}
            onPointerLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? points.length) - 1));
              else if (e.key === 'ArrowRight') setHover((h) => Math.min(points.length - 1, (h ?? -1) + 1));
              else if (e.key === 'Escape') setHover(null);
              else return;
              e.preventDefault();
            }}
          >
            {/* faint grid + y labels */}
            {ticks.map((v) => (
              <g key={v}>
                <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="var(--ink-2)" strokeWidth="1" opacity="0.7" />
                <text x={M.left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--ink-6)" className="serial">
                  {(v / 100).toLocaleString('en-GH', { maximumFractionDigits: 2 })}
                </text>
              </g>
            ))}
            <text x={4} y={11} textAnchor="start" fontSize="10" fill="var(--ink-6)">GHS per kg</text>
            {/* x labels: first, middle, last — each a date the chart reaches */}
            {[points[0]!, points[Math.floor((points.length - 1) / 2)]!, last].map((p, i) => (
              <text key={`${p.t}-${i}`} x={xOf(p)} y={H - 6} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fontSize="11" fill="var(--ink-6)">
                {fmtDate(p.t, Boolean(long))}
              </text>
            ))}

            {segments.map((seg, i) => {
              const top = seg.map((p) => `${xOf(p)},${y(p.high)}`);
              const bottom = [...seg].reverse().map((p) => `${xOf(p)},${y(p.low)}`);
              return seg.length > 1 ? (
                <g key={i}>
                  <polygon points={[...top, ...bottom].join(' ')} fill="var(--forest)" opacity="0.13" />
                  <polyline points={seg.map((p) => `${xOf(p)},${y(p.median)}`).join(' ')} fill="none" stroke="var(--forest)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                </g>
              ) : (
                <circle key={i} cx={xOf(seg[0]!)} cy={y(seg[0]!.median)} r="3" fill="var(--forest)" />
              );
            })}

            {/* the latest value, marked and named */}
            <circle cx={xOf(last)} cy={y(last.median)} r="5" fill="var(--forest)" stroke="var(--paper-lift)" strokeWidth="2" />
            <text x={xOf(last) + 10} y={y(last.median)} dy="0.32em" fontSize="12" fontWeight="700" fill="var(--ink)" className="serial">
              {(last.median / 100).toFixed(2)}
            </text>

            {active && (
              <g pointerEvents="none">
                <line x1={xOf(active)} x2={xOf(active)} y1={M.top} y2={H - M.bottom} stroke="var(--ink-5)" strokeWidth="1" strokeDasharray="3 3" />
                <circle cx={xOf(active)} cy={y(active.median)} r="5" fill="var(--forest)" stroke="var(--paper-lift)" strokeWidth="2" />
              </g>
            )}
          </svg>
          <p id={`${id}-hint`} className="sr-only">
            {t('web.prices.chartKeys', 'Use the left and right arrow keys to move between readings.')}
          </p>
          {active && (
            <div
              className="pointer-events-none absolute top-1 z-10 rounded-lg bg-[var(--forest-night)] px-3 py-2 text-xs text-[var(--paper-lift)] shadow-lg"
              style={{ left: `${(xOf(active) / W) * 100}%`, transform: xOf(active) > W * 0.6 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}
            >
              <div className="font-semibold">{fmtDate(active.t, Boolean(long))}</div>
              <div className="serial text-sm font-bold">{ghs(active.median)} / kg</div>
              <div className="text-[var(--ink-2)]">
                {t('web.prices.tipRange', 'Usually {low} – {high}', { low: ghs(active.low), high: ghs(active.high) })}
              </div>
              <div className="text-[var(--ink-2)]">{t('web.prices.tipReports', '{n} reports', { n: active.count })}</div>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

/** A small line with no axes: the shape of the last weeks, for a card. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <div className="h-8" aria-hidden="true" />;
  const w = 96;
  const h = 32;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(hi - lo, 1);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 8) + 2, h - 5 - ((v - lo) / span) * (h - 10)] as const);
  const end = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-24" role="img" aria-label={label}>
      <polyline points={pts.map(([px, py]) => `${px},${py}`).join(' ')} fill="none" stroke="var(--forest)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={end[0]} cy={end[1]} r="3" fill="var(--forest)" stroke="var(--paper-lift)" strokeWidth="1.5" />
    </svg>
  );
}
