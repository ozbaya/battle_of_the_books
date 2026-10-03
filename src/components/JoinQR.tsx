'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export function JoinQR({ url, size = 180 }: { url: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: size, margin: 1 }).then((d) => {
      if (!cancelled) setDataUrl(d);
    });
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  if (!dataUrl) {
    return <div style={{ width: size, height: size }} className="animate-pulse rounded-lg bg-black/10" />;
  }

  // eslint-disable-next-line @next/next/no-img-element -- data: URI, not an optimizable remote image
  return <img src={dataUrl} alt={`QR code to join at ${url}`} width={size} height={size} className="rounded-lg bg-white p-2" />;
}
