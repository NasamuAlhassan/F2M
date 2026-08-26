import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Handset, WaveBars, type SoftKey } from '../components/handset';
import { F2MSeal } from '../components/engrave';

/**
 * The handset simulator — one device that does USSD, voice and SMS, because
 * that is what one phone does.
 *
 * It speaks the real Africa's Talking wire formats against the real server:
 * form-encoded POST /ussd with the cumulative `text=a*b*c` history, and
 * POST /voice/answer returning call XML. Only the carrier is simulated; every
 * screen below is rendered by the same state machine a live shortcode would hit.
 *
 * Open it once per persona — /phone?as=farmer beside /phone?as=driver — and the
 * two handsets work the same trade from opposite ends.
 */

type Persona = 'farmer' | 'driver';
type Mode = 'idle' | 'ussd' | 'ringing' | 'incall';

const DEFAULT_MSISDN: Record<Persona, string> = {
  farmer: '+233201234567',
  driver: '+233541234567',
};

const SHORTCODE = '*384*7247#';

/** Multi-tap letter cycles per key, the way a real feature-phone keypad reads
 *  (`*` switches case/mode instead of contributing a character; `#` types
 *  itself literally). A USSD or DTMF reply is free text on the wire either
 *  way, so this is what makes typing a name — not just a menu digit —
 *  possible at all. */
const TAP_CYCLE: Record<string, string[]> = {
  '1': ['1'],
  '2': ['a', 'b', 'c', '2'],
  '3': ['d', 'e', 'f', '3'],
  '4': ['g', 'h', 'i', '4'],
  '5': ['j', 'k', 'l', '5'],
  '6': ['m', 'n', 'o', '6'],
  '7': ['p', 'q', 'r', 's', '7'],
  '8': ['t', 'u', 'v', '8'],
  '9': ['w', 'x', 'y', 'z', '9'],
  '0': [' ', '0', '+'],
};
type InputMode = 'abc' | 'ABC' | '123';
const NEXT_MODE: Record<InputMode, InputMode> = { abc: 'ABC', ABC: '123', '123': 'abc' };
/** A pause this long commits the pending letter, so the next tap of the same
 *  key starts a fresh character instead of continuing the cycle — "hello"
 *  needs the two Ls to land as two taps of 5, not one held cycle. */
const TAP_TIMEOUT_MS = 650;

interface VoiceCall {
  id: string;
  flow: string;
  status: string;
  createdAt: number;
}
interface SmsRow {
  message: string;
  status: string;
  createdAt: number;
}

/* ── The ringtone ──────────────────────────────────────────────
   Synthesized rather than shipped: no asset to load, nothing to
   404 on stage. Two square-wave chirps on a 1.4s cycle, matched to
   the shell's shiver so the phone looks and sounds like one object. */
function useRingtone(active: boolean, muted: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!active || muted) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctxRef.current ??= new Ctor();
    const ctx = ctxRef.current;
    // Autoplay policy: this resolves once the presenter has touched anything.
    void ctx.resume().catch(() => undefined);

    const chirp = (freq: number, at: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.14, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + dur + 0.03);
    };

    const ring = () => {
      if (ctx.state !== 'running') return;
      const t = ctx.currentTime;
      chirp(1318, t, 0.16);
      chirp(1046, t + 0.2, 0.16);
    };

    ring();
    const id = window.setInterval(ring, 1400);
    return () => window.clearInterval(id);
  }, [active, muted]);
}

/** Read a locally-remembered number so a rehearsal does not need retyping. */
function storedMsisdn(persona: Persona): string {
  try {
    return localStorage.getItem(`ftm_handset:${persona}`) ?? DEFAULT_MSISDN[persona];
  } catch {
    return DEFAULT_MSISDN[persona];
  }
}

export function PhonePage() {
  const [params, setParams] = useSearchParams();
  const persona: Persona = params.get('as') === 'driver' ? 'driver' : 'farmer';

  const [msisdn, setMsisdn] = useState(() => storedMsisdn(persona));
  const [mode, setMode] = useState<Mode>('idle');
  const [screen, setScreen] = useState<string>('');
  const [muted, setMuted] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [wireError, setWireError] = useState<string | null>(null);

  // USSD session
  const sessionRef = useRef<string | null>(null);
  const historyRef = useRef<string[]>([]);

  // Voice call
  const callRef = useRef<VoiceCall | null>(null);
  const callSessionRef = useRef<string>('');
  const [speaking, setSpeaking] = useState(false);
  const [awaitingDigits, setAwaitingDigits] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Composed reply — the line being typed for the current USSD prompt or DTMF
  // gather, built up over one or more keypad taps and sent as a whole on OK
  // (a menu digit is just a one-character line; a name is a longer one).
  const [compose, setCompose] = useState('');
  // Most prompts are numbered menus, so default to plain digits each screen —
  // switching to letters (for a name, say) is one tap of `*` away.
  const [inputMode, setInputMode] = useState<InputMode>('123');
  const tapRef = useRef<{ key: string; cycleIndex: number } | null>(null);
  const tapTimerRef = useRef<number | null>(null);

  // Swapping persona swaps SIM: a different number, and any live session dies.
  useEffect(() => {
    setMsisdn(storedMsisdn(persona));
    sessionRef.current = null;
    historyRef.current = [];
    callRef.current = null;
    setMode('idle');
    setScreen('');
    setCompose('');
    tapRef.current = null;
  }, [persona]);

  useEffect(() => {
    try {
      localStorage.setItem(`ftm_handset:${persona}`, msisdn);
    } catch {
      // Private windows: the default still applies, nothing breaks.
    }
  }, [persona, msisdn]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const idle = mode === 'idle';

  /* ── Incoming calls ──
     Polled in the background too: the whole point is that the phone rings
     while you are looking at the buyer's tab. React Query pauses intervals in
     hidden tabs by default, which would defeat that entirely. */
  const callsQuery = useQuery({
    queryKey: ['handset-calls', msisdn],
    queryFn: () => fetchJson<{ calls: VoiceCall[] }>(`/api/dev/voice-calls?phone=${encodeURIComponent(msisdn)}`),
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    enabled: msisdn.length > 6 && (mode === 'idle' || mode === 'ringing'),
    retry: false,
  });

  const smsQuery = useQuery({
    queryKey: ['handset-sms', msisdn],
    queryFn: () => fetchJson<{ messages: SmsRow[] }>(`/api/dev/sms?phone=${encodeURIComponent(msisdn)}`),
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
    enabled: msisdn.length > 6,
    retry: false,
  });

  // A dead server must never look like a quiet one — that is the worst failure
  // mode on stage, so the wire's health is stated outright.
  const offline = callsQuery.isError || smsQuery.isError;

  const pending = useMemo(
    () => callsQuery.data?.calls.find((c) => c.status === 'placing' || c.status === 'in_progress') ?? null,
    [callsQuery.data],
  );

  useEffect(() => {
    if (mode === 'idle' && pending) {
      callRef.current = pending;
      setMode('ringing');
      setScreen('');
    }
    if (mode === 'ringing' && !pending) {
      // Cancelled at the far end before it was answered.
      callRef.current = null;
      setMode('idle');
    }
  }, [pending, mode]);

  useRingtone(mode === 'ringing', muted);

  /* ── USSD ── */
  const dial = useCallback(async () => {
    sessionRef.current = `sim-${Math.random().toString(36).slice(2, 10)}`;
    historyRef.current = [];
    setMode('ussd');
    setBusy(true);
    setWireError(null);
    try {
      const text = await postForm('/ussd', {
        sessionId: sessionRef.current,
        serviceCode: SHORTCODE,
        phoneNumber: msisdn,
        text: '',
      });
      applyUssd(text);
    } catch (err) {
      failWire(err);
    } finally {
      setBusy(false);
    }
  }, [msisdn]);

  const applyUssd = (text: string) => {
    // A fresh prompt starts a fresh reply — the line just sent, and whatever
    // key was mid-cycle, belong to the screen that's gone now.
    setCompose('');
    setInputMode('123');
    tapRef.current = null;
    if (text.startsWith('CON ')) {
      setScreen(text.slice(4));
    } else if (text.startsWith('END ')) {
      setScreen(`${text.slice(4)}\n\n── call ended ──`);
      sessionRef.current = null;
      historyRef.current = [];
      setMode('idle');
    } else {
      setScreen(text);
    }
  };

  const sendUssd = useCallback(
    async (input: string) => {
      if (!sessionRef.current) return;
      historyRef.current = [...historyRef.current, input];
      setBusy(true);
      try {
        const text = await postForm('/ussd', {
          sessionId: sessionRef.current,
          serviceCode: SHORTCODE,
          phoneNumber: msisdn,
          text: historyRef.current.join('*'),
        });
        applyUssd(text);
      } catch (err) {
        failWire(err);
      } finally {
        setBusy(false);
      }
    },
    [msisdn],
  );

  /** Hanging up tells the server. Africa's Talking would post this to the events
   *  URL; without it the session row lingers until TTL and a re-dial mid-flow
   *  resumes a menu the caller thought they had left. */
  const hangUp = useCallback(async () => {
    const id = sessionRef.current;
    sessionRef.current = null;
    historyRef.current = [];
    setMode('idle');
    setScreen('');
    setCompose('');
    tapRef.current = null;
    if (id) {
      try {
        await fetch('/api/dev/ussd-end', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: id }),
        });
      } catch {
        // Best effort — the session expires on its own soon enough.
      }
    }
  }, []);

  /* ── Voice ── */
  const failWire = (err: unknown) => {
    setWireError(err instanceof Error ? err.message : 'The network dropped the call.');
  };

  const speakXml = (xml: string) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const play = doc.querySelector('Play');
    const say = doc.querySelector('Say');
    const gather = doc.querySelector('GetDigits');
    const record = doc.querySelector('Record');

    if (play) {
      // A real TTS provider sends audio rather than text (D-040). Play it —
      // the old simulator only read <Say> and went blank the moment Khaya was on.
      const url = play.getAttribute('url');
      if (url) void new Audio(url).play().catch(() => undefined);
      setScreen('♪ voice prompt playing…');
    } else {
      setScreen(say?.textContent?.trim() ?? '…');
    }

    setSpeaking(true);
    window.setTimeout(() => setSpeaking(false), 1200);
    setAwaitingDigits(Boolean(gather));
    setCompose('');
    setInputMode('123');
    tapRef.current = null;

    if (!gather && !record) {
      window.setTimeout(() => {
        setScreen((s) => `${s}\n\n── call ended ──`);
        callRef.current = null;
        setMode('idle');
      }, 900);
    }
  };

  const answer = useCallback(
    async (digits?: string) => {
      const call = callRef.current;
      if (!call) return;
      callSessionRef.current ||= `ivr-${Math.random().toString(36).slice(2, 10)}`;
      setMode('incall');
      setBusy(true);
      setWireError(null);
      try {
        const body: Record<string, string> = {
          sessionId: callSessionRef.current,
          isActive: '1',
          callerNumber: msisdn,
        };
        if (digits !== undefined) body.dtmfDigits = digits;
        const xml = await postForm(`/voice/answer?callId=${encodeURIComponent(call.id)}`, body);
        speakXml(xml);
      } catch (err) {
        failWire(err);
      } finally {
        setBusy(false);
      }
    },
    [msisdn],
  );

  const reject = useCallback(async () => {
    const call = callRef.current;
    callRef.current = null;
    setMode('idle');
    setScreen('');
    if (call) {
      try {
        await postForm(`/voice/events?callId=${encodeURIComponent(call.id)}`, { status: 'NoAnswer' });
      } catch {
        // The sweep expires unanswered calls regardless.
      }
    }
  }, []);

  /** The open listing line: speak a lot into existence (D-038). The typed text
   *  stands in for the recording that ASR would otherwise transcribe — kept as
   *  a fallback for when the mic isn't available. */
  const speakListing = useCallback(async () => {
    if (!transcript.trim()) return;
    setMode('incall');
    setBusy(true);
    setWireError(null);
    setScreen('… calling the listing line');
    try {
      const xml = await postForm('/voice/answer', { callerNumber: msisdn, transcript: transcript.trim() });
      speakXml(xml);
      setTranscript('');
    } catch (err) {
      failWire(err);
    } finally {
      setBusy(false);
    }
  }, [msisdn, transcript]);

  /** Real audio path: record the mic, upload the clip, and let the ASR model
   *  actually transcribe it — the same /voice/answer call speakListing makes,
   *  just with recordingUrl instead of a typed transcript. */
  const startRecording = useCallback(async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      setMicError(err instanceof Error ? err.message : 'Could not reach the microphone.');
    }
  }, []);

  const stopRecordingAndSpeak = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setRecording(false);

    const blob = await new Promise<Blob>((resolve) => {
      recorder.addEventListener(
        'stop',
        () => resolve(new Blob(recordedChunksRef.current, { type: recorder.mimeType })),
        { once: true },
      );
      recorder.stop();
    });
    recorderRef.current = null;

    setMode('incall');
    setBusy(true);
    setWireError(null);
    setScreen('… calling the listing line');
    try {
      const form = new FormData();
      form.append('audio', blob, 'recording');
      const uploadRes = await fetch('/voice/upload-recording', { method: 'POST', body: form });
      if (!uploadRes.ok) throw new Error(`Upload failed (${uploadRes.status}).`);
      const { recordingUrl } = (await uploadRes.json()) as { recordingUrl: string };
      const xml = await postForm('/voice/answer', { callerNumber: msisdn, recordingUrl });
      speakXml(xml);
    } catch (err) {
      failWire(err);
    } finally {
      setBusy(false);
    }
  }, [msisdn]);

  /* ── Key routing: one keypad, three jobs ──
     Every tap composes onto the current line rather than sending straight
     away — the only way a name, not just a menu digit, can ever get typed.
     OK/Send submits the composed line as this step's whole reply, same as a
     real handset. A tap cycles that key's letters (again within the timeout
     to advance, or after it to start a fresh character); a press-and-hold
     skips the cycle and drops in the digit directly — the two-speed input a
     real keypad gives you, not just single presses. */
  const composing = mode === 'ussd' || (mode === 'incall' && awaitingDigits);

  const onKey = useCallback(
    (k: string, held: boolean) => {
      if (!composing) return;
      if (k === '*') {
        if (!held) setInputMode((m) => NEXT_MODE[m]);
        tapRef.current = null;
        return;
      }
      if (tapTimerRef.current !== null) window.clearTimeout(tapTimerRef.current);

      if (held || inputMode === '123' || k === '#') {
        setCompose((c) => c + k);
        tapRef.current = null;
        return;
      }

      const cycle = TAP_CYCLE[k] ?? [k];
      const cased = (ch: string) => (inputMode === 'ABC' ? ch.toUpperCase() : ch);
      if (tapRef.current && tapRef.current.key === k) {
        const cycleIndex = (tapRef.current.cycleIndex + 1) % cycle.length;
        setCompose((c) => c.slice(0, -1) + cased(cycle[cycleIndex] ?? k));
        tapRef.current = { key: k, cycleIndex };
      } else {
        setCompose((c) => c + cased(cycle[0] ?? k));
        tapRef.current = { key: k, cycleIndex: 0 };
      }
      tapTimerRef.current = window.setTimeout(() => {
        tapRef.current = null;
      }, TAP_TIMEOUT_MS);
    },
    [composing, inputMode],
  );

  const backspace = useCallback(() => {
    tapRef.current = null;
    setCompose((c) => c.slice(0, -1));
  }, []);

  const sendCompose = useCallback(() => {
    tapRef.current = null;
    const line = compose;
    setCompose('');
    if (mode === 'ussd') void sendUssd(line);
    else if (mode === 'incall' && awaitingDigits) void answer(line);
  }, [mode, awaitingDigits, compose, sendUssd, answer]);

  const softLeft: SoftKey | undefined =
    mode === 'idle'
      ? { label: `Dial ${SHORTCODE}`, onClick: () => void dial(), disabled: busy || offline }
      : undefined;

  const call: SoftKey | undefined =
    mode === 'ringing'
      ? { label: 'Answer', onClick: () => void answer(), disabled: busy }
      : mode === 'idle'
        ? { label: 'Dial', onClick: () => void dial(), disabled: busy || offline }
        : undefined;

  const end: SoftKey | undefined =
    mode === 'ringing'
      ? { label: 'Reject', onClick: () => void reject() }
      : mode === 'ussd' || mode === 'incall'
        ? { label: 'End', onClick: () => void hangUp() }
        : undefined;

  const softRight: SoftKey | undefined = composing
    ? { label: 'Clear', onClick: backspace, disabled: busy || compose.length === 0 }
    : undefined;

  const ok: SoftKey | undefined = composing
    ? { label: 'OK — send', onClick: sendCompose, disabled: busy || compose.length === 0 }
    : undefined;

  const promptBody =
    mode === 'ringing' ? (
      <span className="ember font-semibold">
        ☎ INCOMING CALL{'\n'}Farm to Market{'\n'}
        <span className="text-[11px] opacity-70">{callRef.current?.flow ?? 'offer'}</span>
      </span>
    ) : mode === 'incall' ? (
      <>
        {speaking && (
          <>
            <WaveBars />{' '}
          </>
        )}
        {screen}
      </>
    ) : screen ? (
      screen
    ) : (
      <span className="opacity-70">
        {msisdn}
        {'\n\n'}Press Dial to open{'\n'}
        {SHORTCODE}
      </span>
    );

  // The line being typed, live — a real handset always shows what you have
  // typed so far, plus which of abc/ABC/123 the `*` key would switch to.
  const screenBody = composing ? (
    <>
      {promptBody}
      <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-[#1a2005]/25 pt-1.5">
        <span className="font-bold">
          {compose}
          <span className="opacity-60">▏</span>
        </span>
        <span className="text-[9px] tracking-wide opacity-70">{inputMode}</span>
      </div>
    </>
  ) : (
    promptBody
  );

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      <header className="plate">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-4 px-5 py-3">
          <F2MSeal className="h-10 w-10" dark />
          <div className="mr-auto">
            <div className="display text-base font-semibold tracking-[0.1em]">HANDSET SIMULATOR</div>
            <div className="smallcaps text-[var(--ink-3)]">
              The basic phone, on the real wire · {persona === 'farmer' ? 'Farmer' : 'Driver'}
            </div>
          </div>
          <nav className="flex items-center gap-1">
            {(['farmer', 'driver'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setParams({ as: p }, { replace: true })}
                className={`smallcaps rounded-[2px] border px-3 py-1.5 transition-colors ${
                  persona === p
                    ? 'border-[var(--gold)] text-[var(--gold)]'
                    : 'border-[var(--ink-7)] text-[var(--ink-3)] hover:text-[var(--paper)]'
                }`}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="smallcaps ml-2 rounded-[2px] border border-[var(--ink-7)] px-3 py-1.5 text-[var(--ink-3)] transition-colors hover:text-[var(--paper)]"
              aria-pressed={muted}
            >
              {muted ? 'Ringer off' : 'Ringer on'}
            </button>
            <Link
              to="/login"
              className="smallcaps ml-2 rounded-[2px] border border-[var(--ink-7)] px-3 py-1.5 text-[var(--ink-3)] transition-colors hover:text-[var(--paper)]"
            >
              Portal
            </Link>
          </nav>
        </div>
        <div className="guilloche h-[10px] w-full opacity-90" />
      </header>

      <main className="mx-auto flex max-w-[1100px] flex-wrap items-start gap-8 px-5 py-8">
        <div className="flex-shrink-0">
          <Handset
            statusRight={clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            ringing={mode === 'ringing'}
            powered={mode !== 'idle' || Boolean(screen)}
            softLeft={softLeft}
            softRight={softRight}
            onKey={onKey}
            keysDisabled={busy || !composing}
            call={call}
            end={end}
            ok={ok}
          >
            {screenBody}
          </Handset>
          {composing && (
            <p className="mt-3 w-[330px] text-center text-[11px] leading-relaxed text-[var(--ink-6)]">
              Tap a key to cycle its letters, hold to type the digit instead. <span className="text-[var(--gold)]">*</span>{' '}
              switches abc / ABC / 123.
            </p>
          )}
        </div>

        <div className="flex min-w-[300px] flex-1 flex-col gap-5">
          {offline && (
            <p className="stamp px-3 py-2 text-[11px] text-[var(--stamp)]">
              No answer from the server — start it with <span className="serial">npm run dev</span>.
            </p>
          )}
          {wireError && <p className="stamp px-3 py-2 text-[11px] text-[var(--stamp)]">{wireError}</p>}

          <section className="certificate p-5">
            <h2 className="smallcaps mb-3 text-[var(--ink-6)]">The SIM</h2>
            <label className="smallcaps block text-[var(--ink-6)]" htmlFor="msisdn">
              Number
            </label>
            <input
              id="msisdn"
              className="serial mt-1 w-full rounded-[2px] border border-[var(--ink-7)] bg-[var(--paper-lift)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--gold)]"
              value={msisdn}
              onChange={(e) => setMsisdn(e.target.value.trim())}
              disabled={mode !== 'idle'}
            />
            <p className="mt-2 text-xs leading-relaxed text-[var(--ink-6)]">
              This is the phone's identity — the same number the server knows it by. Register a new one over USSD, or
              type a number you registered earlier to pick that farmer back up.
            </p>
          </section>

          <section className="certificate p-5">
            <h2 id="transcript-label" className="smallcaps mb-3 text-[var(--ink-6)]">
              Speak a listing
            </h2>
            <p className="mb-3 text-xs leading-relaxed text-[var(--ink-6)]">
              The open voice line (D-038): say what you have — the crop, how many bags or baskets, and the quality —
              and the real speech-to-text model transcribes it into a lot.
            </p>
            <button
              type="button"
              onClick={() => void (recording ? stopRecordingAndSpeak() : startRecording())}
              disabled={mode !== 'idle' || busy}
              aria-pressed={recording}
              className={`smallcaps w-full rounded-[2px] border px-4 py-3 transition-colors disabled:opacity-40 ${
                recording
                  ? 'animate-pulse border-[var(--stamp)] bg-[var(--stamp)] text-[var(--paper)]'
                  : 'border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]'
              }`}
            >
              {recording ? '● Recording — tap to stop and send' : '🎙 Record a listing'}
            </button>
            {micError && <p className="stamp mt-2 px-3 py-2 text-[11px] text-[var(--stamp)]">{micError}</p>}

            <details className="mt-4">
              <summary className="smallcaps cursor-pointer text-[11px] text-[var(--ink-5)]">
                No microphone? Type it instead
              </summary>
              <div className="mt-3">
                <textarea
                  id="transcript"
                  name="transcript"
                  aria-labelledby="transcript-label"
                  className="w-full rounded-[2px] border border-[var(--ink-7)] bg-[var(--paper-lift)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--gold)]"
                  rows={3}
                  placeholder="I have ten bags of maize, grade B, ready now"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  disabled={mode !== 'idle'}
                />
                <p className="mt-2 text-xs leading-relaxed text-[var(--ink-6)]">
                  Typed text skips ASR and is used as the transcript directly — useful for testing without a mic.
                </p>
                <button
                  type="button"
                  onClick={() => void speakListing()}
                  disabled={mode !== 'idle' || !transcript.trim()}
                  className="smallcaps mt-3 rounded-[2px] border border-[var(--ink)] bg-[var(--ink)] px-4 py-2 text-[var(--paper)] transition-opacity disabled:opacity-40"
                >
                  Call &amp; speak (typed)
                </button>
              </div>
            </details>
          </section>

          <section className="certificate p-5">
            <div className="rule-double mb-3 flex items-baseline justify-between pb-1.5">
              <h2 className="smallcaps text-[var(--ink-6)]">Messages</h2>
              <span className="serial text-[11px] text-[var(--ink-5)]">{smsQuery.data?.messages.length ?? 0}</span>
            </div>
            {smsQuery.data?.messages.length ? (
              <ul className="flex flex-col gap-2.5">
                {smsQuery.data.messages.map((m, i) => (
                  <li key={`${m.createdAt}-${i}`} className="rounded-[2px_10px_10px_10px] bg-[var(--paper-deep)] p-3">
                    <p className="text-sm leading-relaxed text-[var(--ink)]">{m.message}</p>
                    <p className="serial mt-1.5 text-[10px] text-[var(--ink-5)]">
                      {new Date(m.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                      {m.status}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hatch rounded-[2px] px-3 py-6 text-center text-xs text-[var(--ink-5)]">
                No messages yet.
              </p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

/* ── Wire helpers ── */

async function postForm(path: string, fields: Record<string, string>): Promise<string> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  if (!res.ok) throw new Error(`The line failed (${res.status}).`);
  return res.text();
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}
