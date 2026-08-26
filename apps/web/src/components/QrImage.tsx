import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

// The QR prints in the instrument's own ink on its own paper (D-039 tokens
// --ink/--paper — the canvas API can't read CSS variables, so the literals
// carry the token values). 11.6:1 — scanners binarize far above their floor.
const QR_INK = '#14322b';
const QR_PAPER = '#efebdd';

export function QrImage({ url }: { url: string }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: QR_INK, light: QR_PAPER } })
      .then((s) => {
        if (alive) setSrc(s);
      })
      // Without this the hatch placeholder sits there looking like it is still
      // rendering, forever, plus an unhandled rejection in the console.
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [url]);
  if (failed) {
    return (
      <div className="hatch flex h-full w-full items-center justify-center p-2">
        <span className="smallcaps text-center text-[10px] leading-tight text-[var(--ink-6)]">QR unavailable</span>
      </div>
    );
  }
  if (!src) return <div className="hatch h-full w-full" />;
  return <img src={src} alt="Traceability QR code" className="h-full w-full" />;
}
