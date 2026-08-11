/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';
import { Certificate } from '../types';
import { renderCertificateToCanvas } from '../utils/certificateRenderer';

interface ApostilleMainBoardProps {
  certificate: Certificate;
  baseDomain: string;
  readOnly?: boolean;
}

export default function ApostilleMainBoard({ certificate, baseDomain }: ApostilleMainBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loading, setLoading] = useState(true);

  const getHostnameOnly = (urlStr: string): string => {
    try {
      let cleaned = urlStr;
      if (cleaned.startsWith('http://')) cleaned = cleaned.substring(7);
      if (cleaned.startsWith('https://')) cleaned = cleaned.substring(8);
      cleaned = cleaned.split('/')[0];
      cleaned = cleaned.split(':')[0];
      return cleaned;
    } catch (e) {
      return urlStr;
    }
  };

  const getEnvBase = () => {
    const metaEnv = (import.meta as any).env;
    const envBase = (metaEnv?.VITE_PUBLIC_BASE_URL || (typeof process !== 'undefined' && process.env?.PUBLIC_BASE_URL)) as string | undefined;
    if (envBase && envBase.trim() !== '') {
      let b = envBase.trim();
      if (!b.startsWith('http://') && !b.startsWith('https://')) b = 'https://' + b;
      if (b.endsWith('/')) b = b.slice(0, -1);
      return b;
    }
    return '';
  };

  const currentBase = getEnvBase() || baseDomain || (typeof window !== 'undefined' ? window.location.origin : '');
  const hostOnly = getHostnameOnly(currentBase);
  const qrCodeDataUrl = certificate.qrCodeDataUrl || '';

  useEffect(() => {
    let isMounted = true;
    if (canvasRef.current) {
      setLoading(true);
      renderCertificateToCanvas(canvasRef.current, certificate, qrCodeDataUrl, hostOnly)
        .then(() => {
          if (isMounted) setLoading(false);
        })
        .catch((err) => {
          console.error("Failed to render canvas in ApostilleMainBoard", err);
          if (isMounted) setLoading(false);
        });
    }
    return () => { isMounted = false; };
  }, [certificate, baseDomain, qrCodeDataUrl, hostOnly]);

  return (
    <div id="full-stamp-page-view" className="w-full flex justify-center items-center my-2 select-none">
      {/* Canonical A4 aspect ratio 210:297 card with responsive scaling for mobile/desktop */}
      <div className="w-full max-w-[650px] aspect-[210/297] bg-white shadow-xl border border-gray-300 rounded-sm overflow-hidden relative flex items-center justify-center">
        {loading && (
          <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center z-10">
            <span className="text-xs text-slate-500 font-bold animate-pulse">
              Generating A4 Document Preview...
            </span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="w-full h-full object-contain block bg-white"
        />
      </div>
    </div>
  );
}

