import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, shortDate, type ContractListRow, type PublicTrace } from '../api';
import { Card, CROP_EMOJI, inputCls, StateBadge } from '../components/ui';
import { SpineStepper, TraceEventLog } from './Trace';

function QrImage({ url }: { url: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#111827', light: '#ffffff' } }).then((s) => {
      if (alive) setSrc(s);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  if (!src) return <div className="h-full w-full animate-pulse rounded bg-gray-100" />;
  return <img src={src} alt="Traceability QR code" className="h-full w-full" />;
}

/** Frame 09: the certification QR card + chain of custody for any contracted lot. */
export function TraceabilityPage() {
  const { data: contractData } = useQuery({
    queryKey: ['contracts'],
    queryFn: () => api<{ contracts: ContractListRow[] }>('/api/contracts'),
  });
  const contracts = useMemo(() => {
    const rows = contractData?.contracts ?? [];
    // One entry per lot, newest contract first.
    const seen = new Set<string>();
    return rows.filter((c) => (seen.has(c.lotId) ? false : (seen.add(c.lotId), true)));
  }, [contractData]);

  const [lotId, setLotId] = useState<string | null>(null);
  const activeLotId = lotId ?? contracts[0]?.lotId ?? null;
  const active = contracts.find((c) => c.lotId === activeLotId);

  const { data: trace } = useQuery({
    queryKey: ['public-trace', activeLotId],
    queryFn: () => api<PublicTrace>(`/api/public/trace/${activeLotId}`),
    enabled: activeLotId !== null,
  });

  const publicUrl = activeLotId ? `${window.location.origin}/t/${activeLotId}` : '';
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">Quality Certification & Traceability</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Every contracted lot carries a QR — anyone who scans it reads the public, append-only chain of custody
          </p>
        </div>
        <div className="w-72">
          <select className={inputCls} value={activeLotId ?? ''} onChange={(e) => setLotId(e.target.value)}>
            {contracts.map((c) => (
              <option key={c.lotId} value={c.lotId}>
                {CROP_EMOJI[c.commodityCode] ?? ''} {c.commodityName} — {c.farmerName ?? 'farmer'} ({c.lotCode})
              </option>
            ))}
          </select>
        </div>
      </div>

      {contracts.length === 0 ? (
        <Card>
          <p className="text-sm text-gray-400">
            No contracted lots yet. Certification cards appear here once the engine matches one of your demands.
          </p>
        </Card>
      ) : !trace || !active ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* QR card */}
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Certification QR Code</div>
            <div className="h-44 w-44 overflow-hidden rounded-xl border-4 border-[#1B4332] p-2">
              <QrImage url={publicUrl} />
            </div>
            <div className="text-center">
              <div className="font-extrabold text-gray-900">
                {CROP_EMOJI[trace.lot.commodityCode] ?? ''} {trace.lot.commodityName}
              </div>
              <div className="mt-0.5 text-xs text-gray-500">{trace.farmer?.name ?? 'Verified farmer'}</div>
              <div className="mono mt-1 text-[10px] text-gray-400">{trace.lot.lotCode}</div>
            </div>
            <div className="flex w-full flex-col gap-1.5 text-[11px]">
              {(
                [
                  ['Region', trace.lot.regionName],
                  ['Quantity', `${trace.lot.quantityKg} kg (${trace.lot.unitName})`],
                  ['Grade', trace.certification?.gradeBand ?? `${trace.lot.declaredBand} (declared)`],
                  [
                    'AI Confidence',
                    trace.certification?.confidence != null ? `${(trace.certification.confidence * 100).toFixed(0)}%` : '—',
                  ],
                  ['Certified', trace.certification ? shortDate(trace.certification.gradedAt) : 'pending grading'],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-gray-400">{k}</span>
                  <span className="font-semibold text-gray-700">{v}</span>
                </div>
              ))}
            </div>
            <div className="flex w-full gap-2">
              <button
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50"
                onClick={() => {
                  navigator.clipboard.writeText(publicUrl).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
              >
                {copied ? '✓ Link copied' : 'Copy link'}
              </button>
              <Link
                to={`/t/${activeLotId}`}
                target="_blank"
                className="flex-1 rounded-xl bg-[#1B4332] py-2.5 text-center text-sm font-bold text-white transition-colors hover:bg-green-900"
              >
                Open public page ↗
              </Link>
            </div>
          </div>

          {/* Chain of custody */}
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm lg:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Supply Chain Timeline</div>
              <StateBadge state={active.state} />
            </div>
            <div className="mb-5">
              <SpineStepper events={trace.events} />
            </div>
            <TraceEventLog events={trace.events} />
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">Public record</div>
                <div className="mono text-xs font-semibold text-[#1B4332]">{publicUrl}</div>
              </div>
              <Link
                to={`/contracts/${active.id}`}
                className="rounded-xl bg-[#1B4332] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-green-900"
              >
                View contract
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
