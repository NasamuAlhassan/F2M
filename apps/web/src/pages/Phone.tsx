import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Handset, WaveBars, type SoftKey } from '../components/handset';
import { F2MSeal, Glyph } from '../components/engrave';
import { blobToWav } from '../lib/wav';
import { useT } from '../lib/i18n';
import { SkipLink } from '../components/SkipLink';
import { btnGhostCls, inputCls } from '../components/ui';
import { pillItemCls, SlidingPillGroup } from '../components/SlidingPill';

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

/** What a call is waiting for after its last response, and where each kind of
 *  answer goes. A response can ask for one key, a number ended with #, speech,
 *  or a number or speech (PHASE2.md, "What a call can do"). */
interface CallStep {
  digits: 'none' | 'key' | 'number';
  record: boolean;
  digitsUrl: string | null;
  recordUrl: string | null;
}
const NO_STEP: CallStep = { digits: 'none', record: false, digitsUrl: null, recordUrl: null };

/** The server writes absolute callback URLs from its public base, which in a
 *  demo is a tunnel. The simulator posts to the same path and query on its own
 *  origin, so the dev proxy carries it and the token rides along. */
function toPath(url: string): string {
  const u = new URL(url, window.location.origin);
  return `${u.pathname}${u.search}`;
}

function newSessionId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The short tone before a recording starts, as the gateway plays it. */
function beep() {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1000;
    gain.gain.value = 0.06;
    osc.connect(gain).connect(ctx.destination);
    osc.onended = () => void ctx.close();
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {
    // No audio device: the screen still says the call is listening.
  }
}

function recordBtnCls(on: boolean): string {
  return `flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold shadow-sm transition-[background-color,scale] not-disabled:active:scale-[0.97] disabled:opacity-40 ${
    on
      ? 'bg-[var(--stamp)] text-[var(--paper-lift)] not-disabled:hover:bg-[var(--stamp-deep)] not-disabled:active:bg-[var(--stamp-deep)]'
      : 'bg-[var(--forest)] text-[var(--paper-lift)] not-disabled:hover:bg-[var(--forest-deep)] not-disabled:active:bg-[var(--forest-deep)]'
  }`;
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
  const { t } = useT();
  useEffect(() => {
    document.title = `${t('web.phone.tab', 'Handset simulator')} · Farm to Market`;
  }, [t]);
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
  // What the call is waiting for right now, and where each answer goes.
  const [step, setStepState] = useState<CallStep>(NO_STEP);
  const stepRef = useRef<CallStep>(NO_STEP);
  const setStep = (s: CallStep) => {
    stepRef.current = s;
    setStepState(s);
  };
  const msisdnRef = useRef(msisdn);
  useEffect(() => {
    msisdnRef.current = msisdn;
  }, [msisdn]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playTokenRef = useRef(0);
  const redirectsRef = useRef(0);
  const [spoken, setSpoken] = useState('');
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
    callSessionRef.current = '';
    stopVoice();
    setStep(NO_STEP);
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
  // A server that is up but failing is a different fix from one that is off.
  const fault = callsQuery.error ?? smsQuery.error;
  const serverFault = fault instanceof HttpError && fault.fromServer ? fault : null;

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
    if (recorderRef.current) {
      recorderRef.current.stop();
      recorderRef.current = null;
      setRecording(false);
    }
    endCall(false);
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

  /** Plays a response's clips in order, as the gateway does. Resolves true
   *  when they all finished, false when something newer cut in. */
  const playClips = async (urls: string[]): Promise<boolean> => {
    const token = ++playTokenRef.current;
    for (const url of urls) {
      if (token !== playTokenRef.current) return false;
      await new Promise<void>((resolve) => {
        const audio = new Audio(url);
        audioRef.current = audio;
        for (const ev of ['ended', 'error', 'pause'] as const) audio.addEventListener(ev, () => resolve(), { once: true });
        audio.play().catch(() => resolve());
      });
    }
    return token === playTokenRef.current;
  };

  /** Cuts the voice off: the caller answered over it, or hung up. */
  const stopVoice = () => {
    playTokenRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
  };

  const endCall = (showEnded: boolean) => {
    stopVoice();
    setStep(NO_STEP);
    setSpoken('');
    callRef.current = null;
    callSessionRef.current = '';
    redirectsRef.current = 0;
    if (showEnded) setScreen((sc) => `${sc}\n\n── call ended ──`);
    setMode('idle');
  };

  /** One leg of a call: post the answer, then act on the XML that comes back.
   *  Resolves true when the server answered. */
  const exchange = async (path: string, answerFields: Record<string, string>): Promise<boolean> => {
    stopVoice();
    setStep(NO_STEP);
    setBusy(true);
    setWireError(null);
    try {
      const xml = await postForm(path, {
        sessionId: callSessionRef.current,
        isActive: '1',
        callerNumber: msisdnRef.current,
        ...answerFields,
      });
      speakXml(xml);
      return true;
    } catch (err) {
      failWire(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const speakXml = (xml: string) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const said = [...doc.querySelectorAll('Say')].map((n) => n.textContent?.trim() ?? '').filter(Boolean);
    const clips = [...doc.querySelectorAll('Play')].map((n) => n.getAttribute('url')).filter((u): u is string => Boolean(u));
    const gather = doc.querySelector('GetDigits');
    const record = doc.querySelector('Record');
    const redirect = doc.querySelector('Redirect')?.textContent?.trim() || null;

    // A real TTS voice sends audio rather than text (D-040), so a clip-only
    // prompt shows that it is playing instead of going blank.
    setScreen(said.length ? said.join('\n\n') : redirect ? 'One moment please…' : clips.length ? '♪ voice prompt playing…' : '…');
    setStep({
      // No numDigits means a number ended with #; numDigits="1" is one key.
      digits: !gather ? 'none' : gather.getAttribute('numDigits') === '1' ? 'key' : 'number',
      record: Boolean(record),
      digitsUrl: gather?.getAttribute('callbackUrl') || null,
      recordUrl: record?.getAttribute('callbackUrl') || null,
    });
    setCompose('');
    setInputMode('123');
    tapRef.current = null;
    if (!redirect) redirectsRef.current = 0;

    setSpeaking(true);
    if (!clips.length) window.setTimeout(() => setSpeaking(false), 1200);
    const session = callSessionRef.current;
    void playClips(clips).then((finished) => {
      if (clips.length) setSpeaking(false);
      if (!finished || callSessionRef.current !== session) return;
      if (redirect) {
        // "One moment" while the voice is prepared, then the gateway fetches
        // the same step again. A loop that never settles stops here.
        redirectsRef.current += 1;
        if (redirectsRef.current > 4) {
          failWire(new Error('The call kept saying "one moment". Hang up and try again.'));
          return;
        }
        void exchange(toPath(redirect), {});
      } else if (record) {
        if (record.getAttribute('playBeep') !== 'false') beep();
      } else if (!gather) {
        window.setTimeout(() => {
          if (callSessionRef.current === session) endCall(true);
        }, 900);
      }
    });
  };

  /** Picks up a ringing call (no digits), or sends keys to wherever the last
   *  GetDigits asked for them. */
  const answer = useCallback(async (digits?: string) => {
    const call = callRef.current;
    const url = digits !== undefined ? stepRef.current.digitsUrl : null;
    const path = url ? toPath(url) : call ? `/voice/answer?callId=${encodeURIComponent(call.id)}` : null;
    if (!path) return;
    callSessionRef.current ||= newSessionId('ivr');
    setMode('incall');
    await exchange(path, digits === undefined ? {} : { dtmfDigits: digits });
  }, []);

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

  /** Where speech goes. In a call, to the Record step's callbackUrl (it
   *  carries the callId). With no call up, to the open listing line (D-038),
   *  whose first leg has no callId yet. */
  const sendSpeech = async (fields: { transcript: string } | { recordingUrl: string }): Promise<boolean> => {
    const st = stepRef.current;
    if (st.record) {
      const url = st.recordUrl ?? st.digitsUrl;
      if (!url) {
        failWire(new Error('The call did not say where to send the answer.'));
        return false;
      }
      return exchange(toPath(url), fields);
    }
    return openListingLine(fields);
  };

  /** Rings the open listing line. With nothing said yet it answers with its
   *  menu, and the call carries its own id from then on; with a transcript or
   *  recording it is the one-breath listing. */
  const openListingLine = (fields: Record<string, string>): Promise<boolean> => {
    callSessionRef.current = newSessionId('ivr');
    redirectsRef.current = 0;
    setMode('incall');
    setScreen('… calling the listing line');
    return exchange('/voice/answer', fields);
  };

  /** Typed text stands in for the recording that ASR would transcribe, for
   *  when the mic isn't available. */
  const speakListing = useCallback(async () => {
    if (!transcript.trim()) return;
    if (await sendSpeech({ transcript: transcript.trim() })) setTranscript('');
  }, [transcript]);

  const sendSpoken = useCallback(async () => {
    if (!spoken.trim()) return;
    if (await sendSpeech({ transcript: spoken.trim() })) setSpoken('');
  }, [spoken]);

  /** Real audio: record the mic, upload the clip, and let the ASR model
   *  transcribe it. Speaking over the voice cuts it off, as on a real call. */
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
      stopVoice();
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

    if (!stepRef.current.record) {
      setMode('incall');
      setScreen('… calling the listing line');
    }
    setBusy(true);
    setWireError(null);
    let recordingUrl: string;
    try {
      // WAV, not the recorder's WebM: the language Space (and every other
      // speech provider) reads it; if the browser can't convert, WebM goes up
      // as before and only the ffmpeg-backed local service will take it.
      const wav = await blobToWav(blob);
      const form = new FormData();
      form.append('audio', wav.blob, wav.converted ? 'recording.wav' : 'recording');
      const uploadRes = await fetch('/voice/upload-recording', { method: 'POST', body: form });
      if (!uploadRes.ok) throw new Error(`Upload failed (${uploadRes.status}).`);
      ({ recordingUrl } = (await uploadRes.json()) as { recordingUrl: string });
    } catch (err) {
      failWire(err);
      setBusy(false);
      return;
    }
    await sendSpeech({ recordingUrl });
  }, []);

  /* ── Key routing: one keypad, three jobs ──
     Every tap composes onto the current line rather than sending straight
     away — the only way a name, not just a menu digit, can ever get typed.
     OK/Send submits the composed line as this step's whole reply, same as a
     real handset. A tap cycles that key's letters (again within the timeout
     to advance, or after it to start a fresh character); a press-and-hold
     skips the cycle and drops in the digit directly — the two-speed input a
     real keypad gives you, not just single presses. */
  const composing = mode === 'ussd' || (mode === 'incall' && step.digits !== 'none');
  const numberEntry = mode === 'incall' && step.digits === 'number';

  const onKey = useCallback(
    (k: string, held: boolean) => {
      if (!composing) return;
      if (numberEntry) {
        // A number answer: digits and * build the line ("*" alone means
        // "say that again"), and # sends it without the #.
        if (tapTimerRef.current !== null) window.clearTimeout(tapTimerRef.current);
        tapRef.current = null;
        if (k === '#') {
          if (compose) {
            setCompose('');
            void answer(compose);
          }
          return;
        }
        setCompose((c) => c + k);
        return;
      }
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
    [composing, numberEntry, compose, answer, inputMode],
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
    else if (mode === 'incall' && step.digits !== 'none') void answer(line);
  }, [mode, step.digits, compose, sendUssd, answer]);

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
    ? { label: 'Send', onClick: sendCompose, disabled: busy || compose.length === 0 }
    : undefined;

  /* ── Physical keyboard ──
     With focus anywhere outside a text field, the computer's keys drive the
     handset: 0–9 * # are the keypad (Alt for the held digit), Enter is the
     green key (OK while composing), Escape is End/Reject, Backspace is Clear.
     The latest actions sit in a ref so the listener binds once. */
  const keyboardRef = useRef({ composing, busy, onKey, ok, call, end, softRight });
  useEffect(() => {
    keyboardRef.current = { composing, busy, onKey, ok, call, end, softRight };
  });
  useEffect(() => {
    const press = (soft?: SoftKey) => {
      if (!soft || soft.disabled || !soft.onClick) return false;
      soft.onClick();
      return true;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      const h = keyboardRef.current;

      if (/^[0-9*#]$/.test(e.key)) {
        if (!h.composing || h.busy) return;
        e.preventDefault();
        h.onKey(e.key, e.altKey);
        return;
      }
      if (e.altKey || e.repeat) return;
      // Enter on a focused control already activates that control.
      if (e.key === 'Enter') {
        if (target?.closest('button, a[href], summary, [role="button"]')) return;
        if (press(h.composing ? h.ok : h.call)) e.preventDefault();
      } else if (e.key === 'Escape') {
        if (press(h.end)) e.preventDefault();
      } else if (e.key === 'Backspace') {
        if (press(h.softRight)) e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const promptBody =
    mode === 'ringing' ? (
      <span className="ember font-semibold">
        ☎ INCOMING CALL{'\n'}Farm to Market{'\n'}
        <span className="text-[11px]">{callRef.current?.flow ?? 'offer'}</span>
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
      <span>
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
          <span aria-hidden="true">▏</span>
        </span>
        <span className="text-[10px] tracking-wide">{inputMode}</span>
      </div>
    </>
  ) : (
    promptBody
  );

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      <SkipLink />
      <header className="z-20 border-b border-[var(--ink-1)] bg-[var(--paper)]/90 backdrop-blur-md lg:sticky lg:top-0">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3">
          <Link to="/" className="flex min-h-11 items-center gap-2.5 rounded-full transition-opacity hover:opacity-85 active:opacity-70" aria-label="Farm to Market, home">
            <F2MSeal className="h-10 w-10" />
          </Link>
          <div className="mr-auto">
            <div className="eyebrow">
              {t('web.phone.eyebrow', 'Basic phone')} · {persona === 'farmer' ? t('web.phone.farmer', 'Farmer') : t('web.phone.driver', 'Driver')}
            </div>
            <h1 className="headline mt-0.5 text-2xl text-[var(--ink)]">{t('web.phone.title', 'Handset simulator')}</h1>
          </div>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Simulator">
            <SlidingPillGroup
              watch={persona}
              className="flex rounded-full border border-[var(--ink-2)] bg-[var(--paper-lift)] p-1"
              role="group"
              aria-label={t('web.phone.who', 'Who is holding the phone')}
            >
              {(['farmer', 'driver'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={persona === p}
                  onClick={() => setParams({ as: p }, { replace: true })}
                  className={pillItemCls(persona === p)}
                >
                  {p === 'farmer' ? t('web.phone.farmer', 'Farmer') : t('web.phone.driver', 'Driver')}
                </button>
              ))}
            </SlidingPillGroup>
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="min-h-11 rounded-full border border-[var(--ink-2)] bg-[var(--paper-lift)] px-4 text-sm font-medium text-[var(--ink-7)] transition-[background-color,color,scale] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] active:scale-[0.97] active:bg-[var(--paper-deep)]"
              aria-pressed={muted}
            >
              {muted ? t('web.phone.ringerOff', 'Ringer off') : t('web.phone.ringerOn', 'Ringer on')}
            </button>
            <Link
              to="/login"
              className="inline-flex min-h-11 items-center rounded-full bg-[var(--forest)] px-4 text-sm font-semibold text-[var(--paper-lift)] transition-[background-color,scale] hover:bg-[var(--forest-deep)] active:scale-[0.97] active:bg-[var(--forest-deep)]"
            >
              {t('web.phone.portal', 'Web portal')}
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto flex max-w-[1100px] flex-wrap items-start gap-8 px-5 py-8">
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
          {numberEntry ? (
            <p className="mt-3 w-[330px] text-center text-[11px] leading-relaxed text-[var(--ink-6)]">
              {t('web.phone.numberHint', 'Type the number, then press # to send it. * on its own hears the question again.')}
            </p>
          ) : (
            composing && (
              <p className="mt-3 w-[330px] text-center text-[11px] leading-relaxed text-[var(--ink-6)]">
                {t('web.phone.keysHint', 'Tap a key to cycle its letters, hold to type the digit instead. * switches abc / ABC / 123.')}
              </p>
            )
          )}
        </div>

        <div className="flex min-w-[300px] flex-1 flex-col gap-5">
          {offline && (
            <p role="alert" className="rounded-2xl bg-[var(--stamp-wash)] px-4 py-3 text-sm text-[var(--stamp-deep)]">
              {serverFault ? (
                t(
                  'web.phone.serverError',
                  'The server hit an error ({status}), so calls and messages may not arrive. Its log says why.',
                  { status: serverFault.status },
                )
              ) : (
                <>
                  {t('web.phone.serverDown', 'No answer from the server. Start it with')} <span className="serial">npm run dev</span>.
                </>
              )}
            </p>
          )}
          {wireError && <p role="alert" className="rounded-2xl bg-[var(--stamp-wash)] px-4 py-3 text-sm text-[var(--stamp-deep)]">{wireError}</p>}

          {mode === 'incall' && step.record && (
            <section aria-labelledby="listening-label" className="certificate p-5">
              <h2 id="listening-label" className="headline flex items-center gap-2.5 text-2xl text-[var(--ink)]">
                <span aria-hidden="true" className="ember inline-block h-2.5 w-2.5 rounded-full bg-[var(--stamp)]" />
                {t('web.phone.listening', 'The call is listening')}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[var(--ink-6)]">
                {step.digits === 'number'
                  ? t('web.phone.listeningOr', 'Type the number on the keypad and press #, or say it.')
                  : t('web.phone.listeningSay', 'Say your answer, or type what you would say.')}
              </p>
              <button
                type="button"
                onClick={() => void (recording ? stopRecordingAndSpeak() : startRecording())}
                disabled={busy}
                aria-pressed={recording}
                className={`mt-3 ${recordBtnCls(recording)}`}
              >
                {recording ? (
                  <>
                    <span aria-hidden="true" className="ember inline-block h-2.5 w-2.5 rounded-full bg-[var(--paper-lift)]" />
                    {t('web.phone.recording', 'Recording. Tap to stop and send.')}
                  </>
                ) : (
                  <>
                    <Glyph name="speak" className="h-5 w-5" />
                    {t('web.phone.recordAnswer', 'Speak your answer')}
                  </>
                )}
              </button>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendSpoken();
                }}
              >
                <input
                  className={inputCls}
                  aria-label={t('web.phone.typeAnswer', 'Type what you would say')}
                  placeholder={t('web.phone.typeAnswer', 'Type what you would say')}
                  value={spoken}
                  onChange={(e) => setSpoken(e.target.value)}
                  disabled={busy || recording}
                />
                <button type="submit" className={btnGhostCls} disabled={busy || recording || !spoken.trim()}>
                  {t('web.phone.sendAnswer', 'Send')}
                </button>
              </form>
            </section>
          )}

          <section className="certificate p-5">
            <h2 className="headline mb-4 text-2xl text-[var(--ink)]">{t('web.phone.sim', 'The SIM')}</h2>
            <label className="smallcaps block text-[var(--ink-6)]" htmlFor="msisdn">
              Number
            </label>
            <input
              id="msisdn"
              className="serial mt-1.5 w-full rounded-xl border border-[var(--field-border)] bg-[var(--paper-lift)] px-3 py-2.5 text-base text-[var(--ink)] transition-[border-color] enabled:hover:border-[var(--ink-7)] focus:border-[var(--forest)] disabled:opacity-60"
              value={msisdn}
              onChange={(e) => setMsisdn(e.target.value.trim())}
              disabled={mode !== 'idle'}
            />
            <p className="mt-2 text-xs leading-relaxed text-[var(--ink-6)]">
              This number is the phone's identity, the same one the server knows it by. Register a new one over USSD, or
              type a number you registered earlier to pick that farmer back up.
            </p>
          </section>

          <section className="certificate p-5">
            <h2 id="transcript-label" className="headline mb-3 text-2xl text-[var(--ink)]">
              {t('web.phone.speakHeading', 'Speak a listing')}
            </h2>
            <p className="mb-3 text-xs leading-relaxed text-[var(--ink-6)]">
              {t(
                'web.phone.speakBody',
                'Call the voice line and say what you have: the crop, how many bags or baskets, and the quality. The speech model writes it down and turns it into a listing.',
              )}
            </p>
            <button
              type="button"
              onClick={() => void (recording ? stopRecordingAndSpeak() : startRecording())}
              disabled={mode !== 'idle' || busy}
              aria-pressed={recording && mode === 'idle'}
              className={recordBtnCls(recording && mode === 'idle')}
            >
              {recording && mode === 'idle' ? (
                <>
                  <span aria-hidden="true" className="ember inline-block h-2.5 w-2.5 rounded-full bg-[var(--paper-lift)]" />
                  {t('web.phone.recording', 'Recording. Tap to stop and send.')}
                </>
              ) : (
                <>
                  <Glyph name="speak" className="h-5 w-5" />
                  {t('web.phone.record', 'Record a listing')}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => void openListingLine({})}
              disabled={mode !== 'idle' || busy || recording}
              className={`mt-2 w-full ${btnGhostCls}`}
            >
              {t('web.phone.callLine', 'Call the line and follow the menu')}
            </button>
            {micError && <p role="alert" className="mt-2 rounded-2xl bg-[var(--stamp-wash)] px-4 py-3 text-sm text-[var(--stamp-deep)]">{micError}</p>}

            <details className="group mt-4">
              <summary className="-mx-2 flex min-h-11 items-center justify-between gap-2 rounded-xl px-2 text-sm font-medium text-[var(--ink-7)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--ink)] active:bg-[var(--paper-deep)]">
                No microphone? Type it instead
                <Glyph
                  name="chevron"
                  className="h-4 w-4 shrink-0 transition-[rotate] duration-[var(--dur-base)] group-open:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <div className="mt-3">
                <textarea
                  id="transcript"
                  name="transcript"
                  aria-labelledby="transcript-label"
                  className="w-full rounded-xl border border-[var(--field-border)] bg-[var(--paper-lift)] px-3 py-2.5 text-base text-[var(--ink)] transition-[border-color] enabled:hover:border-[var(--ink-7)] focus:border-[var(--forest)] disabled:opacity-60 sm:text-sm"
                  rows={3}
                  placeholder="I have ten bags of maize, grade B, ready now"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  disabled={mode !== 'idle'}
                />
                <p className="mt-2 text-xs leading-relaxed text-[var(--ink-6)]">
                  Typed text skips speech recognition and is used as the transcript, which helps when testing without a microphone.
                </p>
                <button
                  type="button"
                  onClick={() => void speakListing()}
                  disabled={mode !== 'idle' || !transcript.trim()}
                  className="mt-3 min-h-11 rounded-full border border-[var(--ink-5)] px-5 text-sm font-semibold text-[var(--ink)] transition-[background-color,scale] not-disabled:hover:bg-[var(--paper-deep)] not-disabled:active:scale-[0.97] not-disabled:active:bg-[var(--paper-deep)] disabled:opacity-40"
                >
                  Call &amp; speak (typed)
                </button>
              </div>
            </details>
          </section>

          <section className="certificate p-5">
            <div className="rule-double mb-3 flex items-baseline justify-between pb-1.5">
              <h2 className="headline text-2xl text-[var(--ink)]">{t('web.phone.messages', 'Messages')}</h2>
              <span className="serial text-[11px] text-[var(--ink-6)]">{smsQuery.data?.messages.length ?? 0}</span>
            </div>
            {smsQuery.data?.messages.length ? (
              <ul className="flex flex-col gap-2.5">
                {smsQuery.data.messages.map((m, i) => (
                  <li key={`${m.createdAt}-${i}`} className="rounded-[4px_16px_16px_16px] bg-[var(--paper-deep)] p-3.5">
                    <p className="text-sm leading-relaxed text-[var(--ink)]">{m.message}</p>
                    <p className="serial mt-1.5 text-[11px] text-[var(--ink-6)]">
                      {new Date(m.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                      {m.status}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl bg-[var(--paper-deep)] px-3 py-6 text-center text-sm text-[var(--ink-6)]">
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

/** A request the server (or the dev proxy in front of it) refused. The app's
 *  own errors are JSON; the proxy's "server is off" reply is not. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly fromServer: boolean,
  ) {
    super(`Request failed (${status})`);
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new HttpError(res.status, (res.headers.get('content-type') ?? '').includes('application/json'));
  return (await res.json()) as T;
}
