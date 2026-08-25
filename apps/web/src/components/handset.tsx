import { useRef, type ReactNode } from 'react';

/**
 * The handset — a feature phone rendered as an object rather than a rectangle.
 *
 * The chassis is cut from the world's own ink (D-039) so the device sits inside
 * the Trade Instrument rather than beside it, but the screen stays an honest
 * monochrome LCD: that panel is the whole point of the claim that a farmer on a
 * Nokia is a first-class counterparty. Type on it is Courier Prime — self-hosted
 * like every other face here, because a demo cannot depend on the network to
 * look like itself.
 */

export interface SoftKey {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}

/** Keypad face, in the order a phone actually carries them. */
const KEYS: ReadonlyArray<readonly [string, string]> = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
];

/** How long a press has to hold before it counts as a hold instead of a tap. */
const HOLD_MS = 450;

/** The four-bar waveform shown while the far end is speaking. */
export function WaveBars({ className }: { className?: string }) {
  return (
    <span className={`inline-flex h-[15px] items-end gap-[2px] align-middle ${className ?? ''}`}>
      {[0, 1, 2, 3].map((i) => (
        <i
          key={i}
          className="wave-bar w-[3px] rounded-[1px] bg-[#3d4a12]"
          style={{ animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </span>
  );
}

interface HandsetProps {
  /** Right-hand status text — the clock. */
  statusRight?: ReactNode;
  /** Network label, left of the status bar. */
  network?: string;
  /** Screen contents. */
  children: ReactNode;
  /** Shell shivers and the backlight surges. */
  ringing?: boolean;
  /** Dark screen when the handset is idle. */
  powered?: boolean;
  softLeft?: SoftKey;
  softRight?: SoftKey;
  /** `held` is true for a press-and-hold — a real keypad's shortcut straight
   *  to the digit, instead of tapping through that key's letters to reach it. */
  onKey?: (key: string, held: boolean) => void;
  keysDisabled?: boolean;
  /** Green send key. */
  call?: SoftKey;
  /** Red end key. */
  end?: SoftKey;
  /** D-pad centre — OK/Send for a composed line, when text entry is live. */
  ok?: SoftKey;
}

export function Handset({
  statusRight,
  network = 'MTN GH',
  children,
  ringing = false,
  powered = true,
  softLeft,
  softRight,
  onKey,
  keysDisabled = false,
  call,
  end,
  ok,
}: HandsetProps) {
  return (
    <div className={`w-[330px] flex-shrink-0 ${ringing ? 'handset-ring' : ''}`}>
      <div
        className="rounded-t-[42px] rounded-b-[30px] border border-black/40 px-4 pb-5 pt-4"
        style={{
          background: 'linear-gradient(168deg, #22453b 0%, #14322b 42%, #0e241f 100%)',
          boxShadow:
            '0 30px 60px -18px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.14), inset 0 -2px 6px rgba(0,0,0,.5)',
        }}
      >
        {/* Earpiece — a milled slot with a grille behind it. */}
        <div className="mx-auto mb-3 flex h-[7px] w-20 items-center justify-center overflow-hidden rounded-full bg-black/55 shadow-[inset_0_1px_2px_rgba(0,0,0,.9)]">
          <span
            className="h-full w-full opacity-60"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(255,255,255,.35) 0.5px, transparent 0.6px)',
              backgroundSize: '4px 4px',
            }}
          />
        </div>

        {/* Maker's mark: embossed, wordless — this is a handset, not a brand. */}
        <div className="mx-auto mb-3 flex items-center justify-center gap-[3px] opacity-30">
          <span className="h-[3px] w-[3px] rounded-full bg-[var(--paper)]" />
          <span className="h-[3px] w-8 rounded-full bg-[var(--paper)]" />
          <span className="h-[3px] w-[3px] rounded-full bg-[var(--paper)]" />
        </div>

        {/* ── The LCD ── */}
        <div
          className="rounded-[6px] border-[5px] border-[#0b1a16] p-[3px]"
          style={{ boxShadow: 'inset 0 3px 12px rgba(0,0,0,.55), 0 1px 0 rgba(255,255,255,.06)' }}
        >
          <div
            className={`serial flex min-h-[236px] flex-col rounded-[2px] px-3 py-2.5 text-[12.5px] leading-[1.55] ${
              ringing ? 'lcd-pulse' : ''
            }`}
            style={
              powered
                ? { background: '#8b9a3c', color: '#1a2005' }
                : { background: '#3f4826', color: '#5c6438' }
            }
          >
            <div className="mb-2 flex items-center justify-between border-b border-[#1a2005]/25 pb-1.5 text-[10px] tracking-wide">
              <span className="flex items-center gap-1">
                <SignalBars />
                {network}
              </span>
              <span>{statusRight}</span>
            </div>
            <div className="flex-1 whitespace-pre-wrap break-words">{children}</div>
          </div>
        </div>

        {/* ── Soft keys ── */}
        <div className="mt-3 flex items-start justify-between gap-2">
          <SoftButton soft={softLeft} align="left" />
          <SoftButton soft={softRight} align="right" />
        </div>

        {/* ── Call keys flanking the D-pad ── */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <CallKey soft={call} tone="send" />
          <DPad ok={ok} />
          <CallKey soft={end} tone="end" />
        </div>

        {/* ── Keypad ── */}
        <div className="mt-3 grid grid-cols-3 gap-x-2.5 gap-y-2">
          {KEYS.map(([digit, letters]) => (
            <KeypadButton key={digit} digit={digit} letters={letters} disabled={keysDisabled || !onKey} onKey={onKey} />
          ))}
        </div>

        {/* Microphone port. */}
        <div className="mx-auto mt-4 h-[5px] w-14 rounded-full bg-black/45 shadow-[inset_0_1px_2px_rgba(0,0,0,.9)]" />
      </div>
    </div>
  );
}

function SignalBars() {
  return (
    <span className="inline-flex h-[9px] items-end gap-[1.5px]" aria-hidden="true">
      {[3, 5, 7, 9].map((h) => (
        <i key={h} className="w-[2px] rounded-[0.5px] bg-[#1a2005]" style={{ height: `${h}px` }} />
      ))}
    </span>
  );
}

function SoftButton({ soft, align }: { soft?: SoftKey; align: 'left' | 'right' }) {
  if (!soft) return <span className="h-[26px] w-[86px]" />;
  return (
    <button
      type="button"
      disabled={soft.disabled}
      onClick={soft.onClick}
      className={`smallcaps h-[26px] w-[86px] border border-black/45 text-[9px] text-[var(--paper)] shadow-[0_2px_0_#0a1c17] transition-[transform,box-shadow] active:translate-y-[2px] active:shadow-none disabled:opacity-30 disabled:active:translate-y-0 disabled:active:shadow-[0_2px_0_#0a1c17] ${
        align === 'left' ? 'rounded-[4px_12px_12px_4px]' : 'rounded-[12px_4px_4px_12px]'
      }`}
      style={{ background: 'linear-gradient(180deg, #2f5449 0%, #1c3b33 100%)' }}
    >
      {soft.label}
    </button>
  );
}

function CallKey({ soft, tone }: { soft?: SoftKey; tone: 'send' | 'end' }) {
  const face =
    tone === 'send'
      ? 'linear-gradient(180deg, #2e6b45 0%, #1d4a2e 100%)'
      : 'linear-gradient(180deg, #8f3527 0%, #66231a 100%)';
  if (!soft) return <span className="h-[34px] w-[62px]" />;
  return (
    <button
      type="button"
      disabled={soft.disabled}
      onClick={soft.onClick}
      className="smallcaps h-[34px] w-[62px] rounded-[10px] border border-black/45 text-[8.5px] text-[var(--paper)] shadow-[0_2.5px_0_#0a1c17] transition-[transform,box-shadow] active:translate-y-[2.5px] active:shadow-none disabled:opacity-30 disabled:active:translate-y-0 disabled:active:shadow-[0_2.5px_0_#0a1c17]"
      style={{ background: face }}
    >
      {soft.label}
    </button>
  );
}

/** Navigation ring. Its centre doubles as OK/Send — the one button that submits
 *  whatever line the keypad just composed, same as the centre key on a real
 *  feature phone. Decorative (no input) whenever nothing is being composed. */
function DPad({ ok }: { ok?: SoftKey }) {
  return (
    <div
      className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-black/45 shadow-[0_2.5px_0_#0a1c17]"
      style={{ background: 'linear-gradient(180deg, #2f5449 0%, #1c3b33 100%)' }}
    >
      {ok ? (
        <button
          type="button"
          disabled={ok.disabled}
          onClick={ok.onClick}
          aria-label={ok.label}
          className="serial flex h-[22px] w-[22px] items-center justify-center rounded-full border border-black/40 bg-[#14322b] text-[8px] font-bold text-[#8fd0a8] shadow-[inset_0_1px_2px_rgba(0,0,0,.6)] transition-opacity active:opacity-70 disabled:opacity-40"
        >
          OK
        </button>
      ) : (
        <div
          aria-hidden="true"
          className="h-[22px] w-[22px] rounded-full border border-black/40 bg-[#14322b] shadow-[inset_0_1px_2px_rgba(0,0,0,.6)]"
        />
      )}
    </div>
  );
}

/** One keypad key: a quick tap cycles onto the next letter it carries (the
 *  same key pressed again advances the cycle), a press-and-hold jumps
 *  straight to the digit — the two-speed input every feature-phone keypad
 *  actually offers, letters by tapping, digits by holding. */
function KeypadButton({
  digit,
  letters,
  disabled,
  onKey,
}: {
  digit: string;
  letters: string;
  disabled: boolean;
  onKey?: (key: string, held: boolean) => void;
}) {
  const timerRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const onPointerDown = () => {
    if (disabled) return;
    firedRef.current = false;
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      onKey?.(digit, true);
    }, HOLD_MS);
  };

  const onPointerUp = () => {
    clearTimer();
    if (!firedRef.current) onKey?.(digit, false);
  };

  const onPointerLeave = () => {
    // A drag-off cancels the press entirely, same as any button.
    clearTimer();
    firedRef.current = true;
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onContextMenu={(e) => e.preventDefault()}
      className="group flex h-[42px] flex-col items-center justify-center rounded-[9px] border border-black/45 leading-none text-[var(--paper)] shadow-[0_2.5px_0_#0a1c17] transition-[transform,box-shadow] active:translate-y-[2.5px] active:shadow-none disabled:opacity-35 disabled:active:translate-y-0 disabled:active:shadow-[0_2.5px_0_#0a1c17]"
      style={{ background: 'linear-gradient(180deg, #2f5449 0%, #1c3b33 100%)', touchAction: 'manipulation' }}
      aria-label={letters ? `${digit} ${letters} — tap to cycle letters, hold for the digit` : digit}
    >
      <span
        className={`text-[15px] font-semibold ${
          digit === '*' ? 'text-[var(--gold)]' : digit === '#' ? 'text-[#8fd0a8]' : ''
        }`}
      >
        {digit}
      </span>
      {letters && <span className="mt-[2px] text-[7.5px] tracking-[0.12em] text-[var(--ink-3)]">{letters}</span>}
    </button>
  );
}
