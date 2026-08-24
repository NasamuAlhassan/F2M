import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export function QrImage({ url }: { url: string }) {
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
