import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, shortDate, type PublicTrace } from '../api';
import { CropMark, F2MSeal } from '../components/engrave';
import { Card, GradeBadge } from '../components/ui';
import { SpineStepper, TraceEventLog } from './Trace';

/**
 * The QR-code destination (D-033): no login, no money details — a public
 * verification certificate any consumer or market inspector can read.
 */
export function PublicTracePage() {
  const { lotId } = useParams<{ lotId: string }>();
  const { data, error } = useQuery({
    queryKey: ['public-trace', lotId],
    queryFn: () => api<PublicTrace>(`/api/public/trace/${lotId}`),
    retry: 1,
  });

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      <header className="plate">
        <div className="mx-auto flex min-h-[68px] max-w-4xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
          <F2MSeal className="h-11 w-11" dark />
          <div>
            <div className="display text-base font-semibold leading-tight tracking-[0.1em]">FARM TO MARKET</div>
            <div className="smallcaps leading-tight text-[var(--ink-3)]">Verified Supply Chain Trace · Ghana</div>
          </div>
          <span className="stamp ml-auto flex items-center gap-1.5 px-2 py-1 text-[11px] text-[var(--paper)]">
            <span className="ember inline-block h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
            Public record
          </span>
        </div>
        <div className="guilloche h-[10px] w-full opacity-90" />
      </header>

      <main className="mx-auto max-w-4xl px-6 py-6">
        {error ? (
          <Card>
            <p className="text-sm text-[var(--ink-6)]">This trace could not be found. Check the QR code or link and try again.</p>
          </Card>
        ) : !data ? (
          <p className="text-sm text-[var(--ink-6)]">Loading…</p>
        ) : (
          <>
            <div className="certificate mb-4 bg-[var(--paper-lift)]">
              <div className="flex flex-wrap items-center gap-5 p-5">
                <div className="hatch flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-lg">
                  <CropMark code={data.lot.commodityCode} className="h-12 w-12 text-[var(--forest)]" />
                </div>
                <div className="min-w-44 flex-1">
                  <div className="flex items-center gap-2.5">
                    <h1 className="display text-lg font-semibold tracking-[0.03em] text-[var(--ink)]">
                      {data.lot.quantityKg}KG {data.lot.commodityName.toUpperCase()}
                    </h1>
                    <GradeBadge grade={data.certification?.gradeBand ?? data.lot.declaredBand} />
                  </div>
                  <p className="mt-0.5 text-sm text-[var(--ink-6)]">
                    Grown by <span className="font-bold text-[var(--ink)]">{data.farmer?.name ?? 'a verified farmer'}</span>
                    {data.farmer && (
                      <>
                        {' '}
                        in {data.farmer.district ? `${data.farmer.district}, ` : ''}
                        {data.farmer.regionName}
                      </>
                    )}
                  </p>
                  <p className="serial mt-1 text-[11px] text-[var(--ink-6)]">
                    LOT № {data.lot.lotCode} · listed {shortDate(data.lot.createdAt)}
                  </p>
                </div>
                {data.certification && (
                  <div className="seal-land border border-[var(--ink)] bg-[var(--paper)] px-4 py-3 text-center shadow-[inset_0_0_0_3px_var(--paper),inset_0_0_0_4px_var(--ink-2)]">
                    <div className="smallcaps text-[var(--ink-6)]">AI Certified</div>
                    <div className="display mt-0.5 text-xl font-semibold text-[var(--ink)]">
                      GRADE {data.certification.gradeBand}
                      {data.certification.confidence !== null && (
                        <span className="serial ml-1.5 text-xs font-bold text-[var(--gold-deep)]">
                          {(data.certification.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <div className="serial mt-0.5 text-[11px] text-[var(--ink-6)]">
                      {data.certification.model ?? 'vision model'} · {shortDate(data.certification.gradedAt)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <Card title="Transaction Spine">
              <SpineStepper events={data.events} />
            </Card>

            <Card title={`Chain of Custody (${data.events.length} entries)`}>
              <TraceEventLog events={data.events} />
              <p className="mt-3 border-t border-[var(--ink-2)] pt-3 text-[11px] leading-relaxed text-[var(--ink-6)]">
                This record is append-only: every entry was written by the platform at the moment it happened and cannot
                be edited or deleted. Personal and payment details are not part of the public record.
              </p>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
