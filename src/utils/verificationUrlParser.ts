/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extracts verification record ID or Tracking Number from any URL structure:
 * - Direct path: /verify/BD-AP-20260910-786784 or /verify/BD-AP-20260910-786784/
 * - Short path: /BD-AP-20260910-786784
 * - Query parameter: ?id=BD-AP-20260910-786784 or ?verify=... or ?token=...
 * - Hash fragment: #/verify/BD-AP-20260910-786784 or #BD-AP-20260910-786784
 * Works completely statelessly without relying on cookies, sessions, or referrer.
 */
export function extractVerificationIdFromUrl(url?: string): string {
  if (typeof window === 'undefined' && !url) return '';

  let pathname = '';
  let search = '';
  let hash = '';

  if (url) {
    try {
      const parsed = new URL(url, 'https://mygov.bd');
      pathname = parsed.pathname;
      search = parsed.search;
      hash = parsed.hash;
    } catch (e) {
      pathname = url;
    }
  } else {
    pathname = window.location.pathname || '';
    search = window.location.search || '';
    hash = window.location.hash || '';
  }

  // 1. Direct query parameters check (?id=... | ?verify=... | ?token=... | ?certNo=... | ?trackingNumber=...)
  try {
    const searchParams = new URLSearchParams(search);
    const qId = searchParams.get('id') ||
                searchParams.get('verify') ||
                searchParams.get('token') ||
                searchParams.get('trackingNumber') ||
                searchParams.get('certNo') ||
                searchParams.get('roll') ||
                searchParams.get('rollNumber');
    if (qId && qId.trim()) {
      return decodeURIComponent(qId.trim()).replace(/\/+$/, '');
    }
  } catch (e) {}

  // 2. Clean URL path inspection (e.g. /verify/BD-AP-20260910-786784)
  try {
    if (pathname.toLowerCase().includes('/verify/')) {
      const parts = pathname.split(/\/verify\//i);
      if (parts[1]) {
        // Strip any subpaths, query markers or hashes that might have gotten attached
        const candidate = parts[1].split('/')[0].split('?')[0].split('#')[0].trim();
        if (candidate) {
          return decodeURIComponent(candidate).replace(/\/+$/, '');
        }
      }
    }

    // Direct root path e.g. /BD-AP-20260910-786784
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      const lastSeg = decodeURIComponent(segments[segments.length - 1].trim()).replace(/\/+$/, '');
      const reserved = ['api', 'assets', 'admin', 'login', 'dashboard', 'verify', 'public', 'auth', 'register', 'index.html', 'favicon.ico'];
      if (lastSeg && !reserved.includes(lastSeg.toLowerCase())) {
        if (lastSeg.toUpperCase().startsWith('BD-AP-') || lastSeg.toUpperCase().startsWith('APO-') || lastSeg.length >= 6) {
          return lastSeg;
        }
      }
    }
  } catch (e) {}

  // 3. Hash routing fallback (e.g. #/verify/BD-AP-20260910-786784 or #BD-AP-20260910-786784)
  try {
    if (hash) {
      if (hash.toLowerCase().includes('verify/')) {
        const parts = hash.split(/verify\//i);
        if (parts[1]) {
          const candidate = parts[1].split('/')[0].split('?')[0].split('#')[0].trim();
          if (candidate) {
            return decodeURIComponent(candidate).replace(/\/+$/, '');
          }
        }
      }

      const cleanHash = hash.replace(/^#\/?/, '').split('?')[0].split('/')[0].trim();
      const reserved = ['verify', 'admin', 'login', 'dashboard', 'api'];
      if (cleanHash && !reserved.includes(cleanHash.toLowerCase()) && cleanHash.length >= 6) {
        return decodeURIComponent(cleanHash).replace(/\/+$/, '');
      }
    }
  } catch (e) {}

  return '';
}
