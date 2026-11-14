/**
 * Re-encode a recorded clip as 16 kHz mono 16-bit PCM WAV, in the browser.
 *
 * MediaRecorder produces WebM/Opus on every current browser, and the language
 * Space (D-045) reads audio with libsndfile, which cannot open WebM. WAV is
 * what every speech provider accepts (the local ffmpeg path, HF Whisper and
 * the Space), and 16 kHz mono is what the recognisers resample to anyway, so
 * a 90 s call stays under 3 MB.
 *
 * Returns the original blob untouched if the browser cannot decode it — the
 * server-side providers that handle WebM (the local ffmpeg service) still work.
 */
const TARGET_RATE = 16_000;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function blobToWav(blob: Blob): Promise<{ blob: Blob; converted: boolean }> {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return { blob, converted: false };
    const ctx = new Ctor();
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    void ctx.close();

    // Render through an OfflineAudioContext at the target rate: it resamples
    // and mixes every channel down to mono in one step.
    const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
    const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return { blob: encodeWav(rendered.getChannelData(0), TARGET_RATE), converted: true };
  } catch {
    return { blob, converted: false };
  }
}
