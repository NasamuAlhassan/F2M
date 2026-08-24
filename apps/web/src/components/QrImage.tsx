import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

// The QR prints in the instrument's own ink on its own paper (D-039 tokens
// --ink/--paper — the canvas API can't read CSS variables, so the literals
// carry the token values). 11.6:1 — scanners binarize far above their floor.
const QR_INK = '#14322b';
const QR_PAPER = '#efebdd';

export function QrImage({ url }: { url: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: QR_INK, light: QR_PAPER } }).then((s) => {
      if (alive) setSrc(s);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  if (!src) return <div className="hatch h-full w-full" />;
  return <img src={src} alt="Traceability QR code" className="h-full w-full" />;
}
