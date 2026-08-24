import type { ReactNode, SVGProps } from 'react';

/**
 * The engraving plate (D-039, seed 222cf785): every icon in the Trade
 * Instrument world is drawn line-work — one stroke weight, currentColor,
 * no emoji. Crops and vehicles read like the engraved vignettes on a
 * printed certificate.
 */

function Mark({ children, ...rest }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ── Crop vignettes ─────────────────────────────────────────── */

const CROP_PATHS: Record<string, ReactNode> = {
  MAIZE: (
    <>
      <ellipse cx="12" cy="10.5" rx="3.6" ry="6.5" />
      <path d="M12 5v11M9.2 8.5h5.6M9 11h6M9.2 13.5h5.6" strokeWidth="0.9" />
      <path d="M8.6 14.5C6.5 16.5 6 19 6.5 21c2.2-.4 4-1.8 5-3.6M15.4 14.5c2.1 2 2.6 4.5 2.1 6.5-2.2-.4-4-1.8-5-3.6" />
    </>
  ),
  TOMATO: (
    <>
      <circle cx="12" cy="13.5" r="6.5" />
      <path d="M12 7.2V4.5M12 7.2l-3-1.6M12 7.2l3-1.6M12 7.2l-1.4 2M12 7.2l1.4 2" strokeWidth="1.1" />
      <path d="M8 12.2c.4-1.6 1.5-2.7 3-3.1" strokeWidth="0.8" />
    </>
  ),
  YAM: (
    <>
      <path d="M6 17.5C4.5 15.5 5 11.5 8 8.5s7.5-4 9.5-2.2 1 5.8-2 8.8-7.5 4.2-9.5 2.4Z" />
      <path d="M6.2 17.8 4.5 20M8.5 19l-1 2.2M16.8 5.8 18.5 4" strokeWidth="1" />
      <path d="M9 12.5c1.5-1.8 3.6-3.2 5.5-3.8" strokeWidth="0.8" />
    </>
  ),
  RICE: (
    <>
      <path d="M8 21c1-5 2.5-9.5 5.5-13.5" />
      <ellipse cx="14.6" cy="6" rx="1.4" ry="2.3" transform="rotate(28 14.6 6)" strokeWidth="1" />
      <ellipse cx="17.6" cy="8.4" rx="1.4" ry="2.3" transform="rotate(55 17.6 8.4)" strokeWidth="1" />
      <ellipse cx="11.4" cy="8.2" rx="1.4" ry="2.3" transform="rotate(8 11.4 8.2)" strokeWidth="1" />
      <ellipse cx="15.2" cy="11.4" rx="1.4" ry="2.3" transform="rotate(70 15.2 11.4)" strokeWidth="1" />
    </>
  ),
  GROUNDNUT: (
    <>
      <path d="M9.5 5.5c2.2 0 3.4 1.5 3.6 3.2.2 1.5.8 2.3 2 2.8 1.6.7 2.6 2 2.6 3.8 0 2.6-2 4.2-4.3 4.2-2.1 0-3.3-1.3-3.6-3-.2-1.4-.8-2.3-2-2.9-1.5-.7-2.4-2-2.4-3.7 0-2.6 1.9-4.4 4.1-4.4Z" />
      <path d="M7.5 8.5l2.6 2.6M6.8 11l2.4 2.4M13 12.6l2.7 2.7M12.4 15.3l2.5 2.5" strokeWidth="0.8" />
    </>
  ),
  PEPPER: (
    <>
      <path d="M14.5 7.5c2 .5 3.5 2.5 3.2 5-.4 3.6-3.4 7-7.2 8.3-2.5.9-4.6.2-5-1.5-.3-1.4.8-2.4 2.7-3.4 3-1.6 5.2-4.5 6.3-8.4Z" />
      <path d="M14.5 7.5c-.3-1.6.4-2.8 1.8-3.5M14.2 4.6c1.2-.7 2.7-.6 3.8.3" strokeWidth="1.1" />
    </>
  ),
  ONION: (
    <>
      <path d="M12 7.5c3.5 0 6 2.4 6 5.6 0 3.4-2.7 5.9-6 5.9s-6-2.5-6-5.9c0-3.2 2.5-5.6 6-5.6Z" />
      <path d="M12 7.5c-.8-1.4-.8-2.8 0-4.3.8 1.5.8 2.9 0 4.3Z" strokeWidth="1.1" />
      <path d="M9.3 8.3c-.9 3.2-.9 6.4 0 9.6M14.7 8.3c.9 3.2.9 6.4 0 9.6" strokeWidth="0.8" />
      <path d="M9.5 19.5l-.7 1.7M12 19.8V21.6M14.5 19.5l.7 1.7" strokeWidth="0.9" />
    </>
  ),
  PLANTAIN: (
    <>
      <path d="M5 8c1.5 6 6 9.5 12.5 9.8l1-2C13 15 9.5 12 8 6.5Z" />
      <path d="M6.8 6.2C8.6 11.5 12 14.3 17 15.2" strokeWidth="0.8" />
      <path d="M8 6.5 7.2 4.8c-.8-.3-1.7-.2-2.4.3L5 8" strokeWidth="1.1" />
    </>
  ),
};

export function CropMark({ code, className }: { code: string; className?: string }) {
  return <Mark className={className}>{CROP_PATHS[code] ?? <circle cx="12" cy="12" r="7" />}</Mark>;
}

/* ── Vehicle vignettes ──────────────────────────────────────── */

const VEHICLE_PATHS: Record<string, ReactNode> = {
  tricycle: (
    <>
      <circle cx="6" cy="17.5" r="2.4" />
      <circle cx="17" cy="17.5" r="2.4" />
      <path d="M13 17.5H8.4M19.4 17.5H21v-4.8L19 9h-5v8.5" />
      <path d="M14 12.5h5.6M6 15.1V9.8h4M6 9.8 4.5 8" />
    </>
  ),
  van: (
    <>
      <circle cx="7" cy="17.5" r="2.2" />
      <circle cx="17" cy="17.5" r="2.2" />
      <path d="M4.8 17.5H3.5V8.5h11v9h-4.5M19.2 17.5H21v-5l-2.5-4h-4" />
      <path d="M17 10.5h1.6l1.4 2.3H17Z" strokeWidth="1" />
    </>
  ),
  light_truck: (
    <>
      <circle cx="6.5" cy="18" r="2.1" />
      <circle cx="12.5" cy="18" r="2.1" />
      <circle cx="18.5" cy="18" r="2.1" />
      <path d="M4.4 18H3V6.5h12.5V18h-.9M8.6 18h1.8M14.6 18h1.8" />
      <path d="M15.5 9.5H19l2 3.5v5h-.4" />
    </>
  ),
};

export function VehicleMark({ code, className }: { code: string; className?: string }) {
  return <Mark className={className}>{VEHICLE_PATHS[code] ?? VEHICLE_PATHS.van}</Mark>;
}

/* ── Document glyphs (one stroke, same plate) ───────────────── */

const GLYPH_PATHS: Record<string, ReactNode> = {
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5.5 5.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 17h12l-1.5-2.2V10a4.5 4.5 0 0 0-9 0v4.8Z" />
      <path d="M10 19.5a2 2 0 0 0 4 0M12 5.5V4" />
    </>
  ),
  phone: (
    <>
      <path d="M5.5 4.5 8.7 4l1.6 4-2 1.6a12.5 12.5 0 0 0 6 6l1.7-2 4 1.6-.5 3.2c-.2 1-1.1 1.7-2.1 1.5C10.5 18.7 5.3 13.5 4 6.6c-.2-1 .5-1.9 1.5-2.1Z" />
    </>
  ),
  camera: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="1.5" />
      <path d="M8.5 7.5 10 5h4l1.5 2.5" />
      <circle cx="12" cy="13.5" r="3.3" />
    </>
  ),
  scale: (
    <>
      <path d="M12 4v16M8 20h8M12 6.5 6 8.2M12 6.5l6 1.7" />
      <path d="M3.5 13.5 6 8.2l2.5 5.3a2.7 2.7 0 0 1-5 0ZM15.5 13.5 18 8.2l2.5 5.3a2.7 2.7 0 0 1-5 0Z" />
    </>
  ),
  farmer: (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20c.8-3.6 3.4-5.6 6.5-5.6s5.7 2 6.5 5.6" />
      <path d="M7.5 7h9M9.7 5.2C10.3 4 11.1 3.4 12 3.4s1.7.6 2.3 1.8" strokeWidth="1.1" />
    </>
  ),
  driver: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 10V4.3M13.7 13.2l4.5 3.6M10.3 13.2l-4.5 3.6" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  cross: <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />,
  route: (
    <>
      <circle cx="5.5" cy="18.5" r="2" />
      <circle cx="18.5" cy="5.5" r="2" />
      <path d="M7.5 18.5h6a3 3 0 0 0 3-3v-4a3 3 0 0 1 3-3" strokeDasharray="2.5 2.5" />
    </>
  ),
  sms: (
    <>
      <path d="M3.5 5.5h17v11h-9l-4.5 3.5v-3.5h-3.5Z" />
      <path d="M7.5 9.5h9M7.5 12.5h6" strokeWidth="1" />
    </>
  ),
  speak: (
    <>
      <path d="M12 4a3.2 3.2 0 0 1 3.2 3.2v4.6a3.2 3.2 0 0 1-6.4 0V7.2A3.2 3.2 0 0 1 12 4Z" />
      <path d="M6.5 11.8a5.5 5.5 0 0 0 11 0M12 17.5V20.5M9.5 20.5h5" />
    </>
  ),
};

export function Glyph({ name, className }: { name: keyof typeof GLYPH_PATHS | string; className?: string }) {
  return <Mark className={className}>{GLYPH_PATHS[name] ?? <circle cx="12" cy="12" r="7" />}</Mark>;
}

/* ── The rosette — the engraved seal ornament ───────────────── */

export function Rosette({ className }: { className?: string }) {
  const petals = Array.from({ length: 16 }, (_, i) => (i * 360) / 16);
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="22.5" strokeWidth="1.4" />
      <circle cx="24" cy="24" r="19.5" strokeWidth="0.7" />
      {petals.map((a) => (
        <ellipse
          key={a}
          cx="24"
          cy="9.5"
          rx="2.6"
          ry="5.5"
          strokeWidth="0.6"
          transform={`rotate(${a} 24 24)`}
        />
      ))}
      <circle cx="24" cy="24" r="10.5" strokeWidth="0.7" />
    </svg>
  );
}

/** The F2M seal — rosette with engraved initials. */
export function F2MSeal({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <span className={`relative inline-flex items-center justify-center ${className ?? ''}`}>
      <Rosette className={`h-full w-full ${dark ? 'text-[var(--paper)]' : 'text-[var(--gold)]'}`} />
      <span
        className={`display absolute text-[0.34em] font-bold tracking-[0.08em] ${
          dark ? 'text-[var(--paper)]' : 'text-[var(--ink)]'
        }`}
      >
        F2M
      </span>
    </span>
  );
}

/* ── The spine as an engraved route (transit raise) ─────────── */

const ROUTE_STATIONS = [
  { label: 'Register', doneWhen: ['LOT_REGISTERED'] },
  { label: 'Match', doneWhen: ['MATCHED'] },
  { label: 'Contract', doneWhen: ['CONTRACT_ACCEPTED', 'FUNDS_HELD'] },
  { label: 'Grade', doneWhen: ['GRADED'] },
  { label: 'Pay', doneWhen: ['PAYMENT_RELEASED', 'SETTLED'] },
  { label: 'Trace', doneWhen: ['SETTLED'] },
];

/** Six stations, done legs inked solid, the active station burning gold. */
export function RouteSpine({ eventTypes, compact }: { eventTypes: string[]; compact?: boolean }) {
  const seen = new Set(eventTypes);
  const done = ROUTE_STATIONS.map((s) => s.doneWhen.some((t) => seen.has(t)));
  const activeIdx = done.findIndex((d) => !d);
  const W = 600;
  const y = 14;
  const pad = 30;
  const step = (W - pad * 2) / (ROUTE_STATIONS.length - 1);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${compact ? 40 : 46}`}
        className="w-full"
        style={{ minWidth: 600 }}
        fill="none"
        aria-label="Transaction spine"
      >
        {ROUTE_STATIONS.slice(0, -1).map((_, i) => {
          const x1 = pad + i * step + 8;
          const x2 = pad + (i + 1) * step - 8;
          const legDone = done[i] && done[i + 1];
          const legActive = done[i] && !done[i + 1];
          return (
            <line
              key={i}
              x1={x1}
              y1={y}
              x2={x2}
              y2={y}
              stroke={legDone ? 'var(--ink)' : legActive ? 'var(--ink-3)' : 'var(--ink-2)'}
              strokeWidth={legDone ? 2 : 1}
              strokeDasharray={legDone ? undefined : '1.5 4'}
              className={legDone ? 'route-ink' : undefined}
              style={legDone ? ({ '--route-len': x2 - x1, strokeDasharray: x2 - x1 } as React.CSSProperties) : undefined}
            />
          );
        })}
        {ROUTE_STATIONS.map((s, i) => {
          const x = pad + i * step;
          const isDone = done[i];
          const isActive = i === activeIdx;
          return (
            <g key={s.label}>
              {isDone ? (
                <>
                  <circle cx={x} cy={y} r="6" fill="var(--ink)" />
                  <path
                    d={`M${x - 2.6} ${y + 0.2} l1.8 1.9 l3.4 -3.8`}
                    stroke="var(--paper)"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              ) : isActive ? (
                <>
                  <circle cx={x} cy={y} r="7" stroke="var(--gold)" strokeWidth="1.4" className="ember" />
                  <circle cx={x} cy={y} r="3" fill="var(--gold)" />
                </>
              ) : (
                <circle cx={x} cy={y} r="5" stroke="var(--ink-3)" strokeWidth="1" fill="var(--paper)" />
              )}
              <text
                x={x}
                y={compact ? 36 : 40}
                textAnchor="middle"
                fill={isDone ? 'var(--ink)' : isActive ? 'var(--gold-ink)' : 'var(--ink-6)'}
                style={{ font: `600 10px 'Public Sans', sans-serif`, letterSpacing: '0.1em' }}
              >
                {s.label.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
