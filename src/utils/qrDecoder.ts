/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import jsQR from 'jsqr';

export interface DecodedQrResult {
  rawText: string;
  trackingId?: string;
  rollNumber?: string;
  registrationNumber?: string;
  extractedUrl?: string;
}

/**
 * Parses decoded QR code content to extract tracking IDs, rolls, or verification URLs
 */
export function parseQrContent(rawText: string): DecodedQrResult {
  const trimmed = (rawText || '').trim();
  const result: DecodedQrResult = { rawText: trimmed };

  // 1. Try URL Parsing
  try {
    let urlObj: URL | null = null;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      urlObj = new URL(trimmed);
    } else if (trimmed.includes('?id=') || trimmed.includes('/verify/')) {
      urlObj = new URL('https://placeholder.local/' + trimmed.replace(/^\/+/, ''));
    }

    if (urlObj) {
      result.extractedUrl = trimmed;
      const params = urlObj.searchParams;
      const idParam = params.get('id') || params.get('verify') || params.get('token') || params.get('trackingNumber') || params.get('certNo');
      const rollParam = params.get('roll') || params.get('rollNumber');
      const regParam = params.get('reg') || params.get('registrationNumber');

      if (idParam) result.trackingId = decodeURIComponent(idParam).trim();
      if (rollParam) result.rollNumber = decodeURIComponent(rollParam).trim();
      if (regParam) result.registrationNumber = decodeURIComponent(regParam).trim();

      // Check path segment if no id in search params (e.g. /verify/BD-AP-2026-12345)
      if (!result.trackingId && urlObj.pathname.includes('/verify/')) {
        const parts = urlObj.pathname.split('/verify/');
        if (parts[1]) {
          const seg = parts[1].split('/')[0].trim();
          if (seg) result.trackingId = decodeURIComponent(seg);
        }
      }
    }
  } catch (e) {
    // Non-URL text
  }

  // 2. Direct Tracking ID match (e.g. BD-AP-2026... or APO-...)
  if (!result.trackingId) {
    const idPattern = /(BD-AP-[A-Z0-9_-]+|APO-[A-Z0-9_-]+|TRK-[A-Z0-9_-]+)/i;
    const match = trimmed.match(idPattern);
    if (match) {
      result.trackingId = match[1].toUpperCase();
    } else if (trimmed.length > 3 && !trimmed.includes(' ') && !trimmed.includes('\n')) {
      // Single token ID
      result.trackingId = trimmed.toUpperCase();
    }
  }

  return result;
}

/**
 * Decodes a QR code from an image File or Data URL / Image URL using jsQR
 */
export async function decodeQrCodeFromImage(fileOrUrl: File | string): Promise<DecodedQrResult | null> {
  let imageUrl = '';
  let shouldRevoke = false;

  if (typeof fileOrUrl === 'string') {
    imageUrl = fileOrUrl;
  } else if (typeof window !== 'undefined' && fileOrUrl && (fileOrUrl as any) instanceof Blob) {
    imageUrl = URL.createObjectURL(fileOrUrl);
    shouldRevoke = true;
  } else {
    return null;
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = (err) => reject(err);
      el.src = imageUrl;
    });

    // Multiple scan passes with different image processing for best detection accuracy
    const passes = [
      { scale: 1, filter: 'normal' },
      { scale: 0.75, filter: 'normal' },
      { scale: 1, filter: 'contrast' },
      { scale: 0.5, filter: 'normal' },
      { scale: 1.5, filter: 'normal' }
    ];

    for (const pass of passes) {
      const canvas = document.createElement('canvas');
      let targetWidth = Math.round(img.width * pass.scale);
      let targetHeight = Math.round(img.height * pass.scale);

      // Clamp max dimensions to prevent memory issues
      const maxDim = 1200;
      if (targetWidth > maxDim || targetHeight > maxDim) {
        const ratio = Math.min(maxDim / targetWidth, maxDim / targetHeight);
        targetWidth = Math.round(targetWidth * ratio);
        targetHeight = Math.round(targetHeight * ratio);
      }

      canvas.width = Math.max(targetWidth, 10);
      canvas.height = Math.max(targetHeight, 10);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) continue;

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      if (pass.filter === 'contrast') {
        // High contrast binarization pass
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          const val = avg > 128 ? 255 : 0;
          data[i] = val;
          data[i + 1] = val;
          data[i + 2] = val;
        }
      }

      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      });

      if (code && code.data && code.data.trim()) {
        return parseQrContent(code.data);
      }
    }

    return null;
  } catch (err) {
    console.warn('[QRDecoder] Decode error:', err);
    return null;
  } finally {
    if (shouldRevoke && imageUrl) {
      URL.revokeObjectURL(imageUrl);
    }
  }
}
