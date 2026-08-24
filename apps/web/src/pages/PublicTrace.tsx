import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, shortDate, type PublicTrace } from '../api';
import { Card, CROP_EMOJI, GradeBadge } from '../components/ui';
import { SpineStepper, TraceEventLog } from './Trace';

/**
 * The QR-code destination (D-033): no login, no money details — the journey
 * and the quality story any consumer or market inspector may verify.
 */
export function PublicTracePage() {
  const { lotId } = useParams<{ lotId: string }>();
  const { data, error } = useQuery({
    queryKey: ['public-trace', lotId],
    queryFn: () => api<PublicTrace>(`/api/public/trace/${lotId}`),
    retry: 1,
  });

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <header className="bg-[#1B4332] text-white shadow-lg">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#D97706] text-sm font-extrabold">F2M</div>
          <div>
            <div className="text-base font-extrabold leading-tight">Farm to Market</div>
            <div className="text-[10px] leading-tight text-green-300">Verified Supply Chain Trace · Ghana</div>
          </div>
          <span className="ml-auto flex items-center gap-1.5 rounded-full border border-green-500/40 bg-green-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-green-300">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
            Public record
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-6">
        {error ? (
          <Card>
            <p className="text-sm text-gray-500">This trace could not be found. Check the QR code or link and try again.</p>
          </Card>
        ) : !data ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <>
            <div className="mb-5 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-4 p-5">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-green-50 text-3xl">
                  {CROP_EMOJI[data.lot.commodityCode] ?? '📦'}
                </div>
                <div className="min-w-44 flex-1">
                  <div className="flex items-center gap-2">
                    <h1 className="text-lg font-extrabold text-gray-900">
                      {data.lot.quantityKg}kg {data.lot.commodityName}
                    </h1>
                    <GradeBadge grade={data.certification?.gradeBand ?? data.lot.declaredBand} />
                  </div>
                  <p className="text-sm text-gray-500">
                    Grown by <span className="font-bold text-gray-800">{data.farmer?.name ?? 'a verified farmer'}</span>
                    {data.farmer && (
                      <>
                        {' '}
                        in {data.farmer.district ? `${data.farmer.district}, ` : ''}
                        {data.farmer.regionName}
                      </>
                    )}
                  </p>
                  <p className="mono mt-0.5 text-[10px] text-gray-400">
                    {data.lot.lotCode} · listed {shortDate(data.lot.createdAt)}
                  </p>
                </div>
                {data.certification && (
                  <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-center">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-green-700">AI Certified</div>
                    <div className="mono text-xl font-extrabold text-[#1B4332]">
                      Grade {data.certification.gradeBand}
                      {data.certification.confidence !== null && (
                        <span className="ml-1 text-xs font-bold text-green-700">
                          {(data.certification.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] text-green-700/70">
                      {data.certification.model ?? 'vision model'} · {shortDate(data.certification.gradedAt)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <Card title="Transaction Spine">
              <SpineStepper events={data.events} />
            </Card>

            <Card title={`Chain of Custody (${data.events.length} events)`}>
              <TraceEventLog events={data.events} />
              <p className="mt-3 text-[10px] text-gray-400">
                This record is append-only: every event was written by the platform at the moment it happened and cannot
                be edited or deleted. Personal and payment details are not part of the public record.
              </p>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
