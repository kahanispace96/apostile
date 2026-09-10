/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Search, BadgeCheck, FileDown, Image, Sparkles, RefreshCw, AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, ZoomIn, FileText, CheckCircle, MapPin, Calendar, Award, ArrowDownCircle, Download, ArrowLeft } from 'lucide-react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Certificate } from '../types';
import { FALLBACK_CERTIFICATES } from '../fallbackData';
import { renderCertificateToCanvas, downloadCanvasAsPdf, downloadCanvasAsJpg } from '../utils/certificateRenderer';
import ApostilleMainBoard from './ApostilleMainBoard';

interface PublicVerificationProps {
  initialId?: string;
  onClearInitialId?: () => void;
  onNavigate?: (view: 'verify' | 'admin-login' | 'admin-dashboard') => void;
}

export default function PublicVerification({ initialId, onClearInitialId, onNavigate }: PublicVerificationProps) {
  const [searchId, setSearchId] = useState(initialId || '');
  const [loading, setLoading] = useState(false);
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [searched, setSearched] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'reader' | 'official'>('official');
  const [publicCerts, setPublicCerts] = useState<{id: string, applicantName: string}[]>([]);
  const [customDomain, setCustomDomain] = useState('');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Helper to load local storage certificates
  const getLocalCertificates = (): Certificate[] => {
    try {
      const stored = localStorage.getItem('MoFA_Certificates');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed.filter(c => c.id && !c.id.startsWith('APO-TEST-') && c.id !== 'BD-AP-2026-95851');
        }
      }
    } catch (e) {}
    return [];
  };

  // Fetch registered certificate database profiles for quick simulation select
  useEffect(() => {
    fetch('/api/public/certificates')
      .then(res => res.text())
      .then(text => {
        if (text && text.trim().startsWith('{')) {
          const data = JSON.parse(text);
          if (data.success && Array.isArray(data.certificates)) {
            setPublicCerts(data.certificates);
            return;
          }
        }
        // Combined local + fallback list
        const localList = getLocalCertificates();
        const combined = [...localList, ...FALLBACK_CERTIFICATES];
        const uniqueMap = new Map();
        combined.forEach(c => uniqueMap.set(c.id.toUpperCase(), { id: c.id, applicantName: c.applicantName }));
        setPublicCerts(Array.from(uniqueMap.values()));
      })
      .catch((e) => {
        const localList = getLocalCertificates();
        const combined = [...localList, ...FALLBACK_CERTIFICATES];
        const uniqueMap = new Map();
        combined.forEach(c => uniqueMap.set(c.id.toUpperCase(), { id: c.id, applicantName: c.applicantName }));
        setPublicCerts(Array.from(uniqueMap.values()));
      });
  }, [certificate]);

  // Trigger verification check
  const handleVerify = async (idToSearch: string) => {
    let rawInput = idToSearch ? idToSearch.trim() : '';
    if (rawInput.endsWith('/')) rawInput = rawInput.slice(0, -1);
    const trimmedId = rawInput.toUpperCase();
    if (!trimmedId) return;

    setLoading(true);
    setErrorMsg('');
    setCertificate(null);
    setSearched(true);
    setSearchId(trimmedId);

    const searchParams = new URLSearchParams(window.location.search);
    const qRoll = searchParams.get('roll') || searchParams.get('rollNumber');
    const qReg = searchParams.get('reg') || searchParams.get('registrationNumber');

    // Parallel multi-channel verification for sub-second responses
    const lookupPromises: Promise<{ cert: Certificate; domain?: string } | null>[] = [];

    // Promise 1: Direct Firestore client lookup (instant ~100ms)
    if (db) {
      lookupPromises.push((async () => {
        try {
          const loadEnclosuresIfAny = async (c: Certificate): Promise<Certificate> => {
            try {
              const encDoc = await getDoc(doc(db, 'certificate_enclosures', c.id));
              if (encDoc.exists() && encDoc.data()?.attachedCertificates) {
                return { ...c, attachedCertificates: encDoc.data().attachedCertificates };
              }
            } catch (e) {}
            return c;
          };

          // Direct document lookup by uppercase ID
          const certRef = doc(db, 'certificates', trimmedId);
          const certSnap = await getDoc(certRef);
          if (certSnap.exists()) {
            const cert = await loadEnclosuresIfAny(certSnap.data() as Certificate);
            return { cert };
          }

          const studRef = doc(db, 'students', trimmedId);
          const studSnap = await getDoc(studRef);
          if (studSnap.exists()) {
            const cert = await loadEnclosuresIfAny(studSnap.data() as Certificate);
            return { cert };
          }

          // Direct document lookup by raw case ID if different
          if (rawInput !== trimmedId) {
            const rawCertRef = doc(db, 'certificates', rawInput);
            const rawCertSnap = await getDoc(rawCertRef);
            if (rawCertSnap.exists()) {
              const cert = await loadEnclosuresIfAny(rawCertSnap.data() as Certificate);
              return { cert };
            }
          }

          // Collection queries
          const qCerts = query(collection(db, 'certificates'), where('id', '==', trimmedId));
          const qSnap = await getDocs(qCerts);
          if (!qSnap.empty) {
            const cert = await loadEnclosuresIfAny(qSnap.docs[0].data() as Certificate);
            return { cert };
          }

          if (qRoll) {
            const qR = query(collection(db, 'students'), where('rollNumber', '==', qRoll));
            const qRSnap = await getDocs(qR);
            if (!qRSnap.empty) {
              const cert = await loadEnclosuresIfAny(qRSnap.docs[0].data() as Certificate);
              return { cert };
            }
          }
        } catch (e) {
          console.warn('[PublicVerification] Client Firestore read notice:', e);
        }
        return null;
      })());
    }

    // Promise 2: Server API endpoint lookup
    lookupPromises.push((async () => {
      try {
        let apiEndpoint = `/api/certificates/verify/${encodeURIComponent(trimmedId)}`;
        if (qRoll) {
          apiEndpoint += `?roll=${encodeURIComponent(qRoll)}${qReg ? `&reg=${encodeURIComponent(qReg)}` : ''}`;
        }
        const res = await fetch(apiEndpoint);
        if (res.ok) {
          const text = await res.text();
          if (text && text.trim().startsWith('{')) {
            const data = JSON.parse(text);
            if (data && data.success && data.certificate) {
              return { cert: data.certificate as Certificate, domain: data.customDomain || '' };
            }
          }
        }
      } catch (e) {
        console.warn('[PublicVerification] Server API lookup notice:', e);
      }
      return null;
    })());

    // Resolve as soon as ANY method returns a valid record
    const results = await Promise.all(lookupPromises);
    const validResult = results.find(r => r !== null && r.cert !== null);

    if (validResult) {
      setCertificate(validResult.cert);
      if (validResult.domain) setCustomDomain(validResult.domain);
      setErrorMsg('');
      setLoading(false);
      return;
    }

    // Fallback: Check browser LocalStorage & in-memory candidates
    const localCerts = getLocalCertificates();
    const combinedCandidates = [...localCerts, ...FALLBACK_CERTIFICATES];
    const cleanSearch = trimmedId.replace(/[^A-Z0-9]/g, '');

    const match = combinedCandidates.find(c => {
      const cId = c.id ? c.id.trim().toUpperCase() : '';
      const cCleanId = cId.replace(/[^A-Z0-9]/g, '');
      const cCertNum = c.certificateNumber ? c.certificateNumber.trim().toUpperCase() : '';
      const cCleanCertNum = cCertNum.replace(/[^A-Z0-9]/g, '');
      const cRoll = c.rollNumber ? String(c.rollNumber).trim() : '';
      const cReg = c.registrationNumber ? String(c.registrationNumber).trim() : '';

      if (qRoll && qReg && cRoll === qRoll && cReg === qReg) return true;
      if (qRoll && cRoll === qRoll) return true;

      return cId === trimmedId ||
             (cleanSearch.length > 3 && cCleanId === cleanSearch) ||
             (cCertNum && cCertNum === trimmedId) ||
             (cleanSearch.length > 3 && cCleanCertNum === cleanSearch);
    });

    if (match) {
      setCertificate({ ...match });
      setErrorMsg('');
    } else {
      setErrorMsg(`Record Not Found for Verification ID / Token "${trimmedId}".`);
      setCertificate(null);
    }
    setLoading(false);
  };

  const handleResetSearch = () => {
    setCertificate(null);
    setSearched(false);
    setErrorMsg('');
    setSearchId('');
    if (onClearInitialId) onClearInitialId();
    if (typeof window !== 'undefined' && window.history?.pushState) {
      window.history.pushState({}, '', window.location.pathname);
    }
  };

  const getBaseVerificationUrl = () => {
    const metaEnv = (import.meta as any).env;
    const envBase = (metaEnv?.VITE_PUBLIC_BASE_URL || (typeof process !== 'undefined' && process.env?.PUBLIC_BASE_URL)) as string | undefined;
    if (envBase && envBase.trim() !== '') {
      let b = envBase.trim();
      if (!b.startsWith('http://') && !b.startsWith('https://')) b = 'https://' + b;
      if (b.endsWith('/')) b = b.slice(0, -1);
      return b;
    }

    if (customDomain && customDomain.trim() !== '') {
      let domain = customDomain.trim();
      if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
        domain = 'https://' + domain;
      }
      if (domain.endsWith('/')) {
        domain = domain.slice(0, -1);
      }
      return domain;
    }
    // Handle GitHub Pages subpath inclusion
    let base = window.location.origin;
    if (window.location.hostname.endsWith('.github.io')) {
      const pathSegments = window.location.pathname.split('/');
      if (pathSegments.length > 1 && pathSegments[1]) {
        base += '/' + pathSegments[1];
      }
    }
    return base;
  };

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

  // Run initial search if ID or URL query parameters exist on page load
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const qId = searchParams.get('id') || searchParams.get('verify') || searchParams.get('token') || searchParams.get('trackingNumber') || searchParams.get('certNo');
    const qRoll = searchParams.get('roll') || searchParams.get('rollNumber');

    const targetToSearch = initialId || qId || qRoll;

    if (targetToSearch) {
      handleVerify(targetToSearch);
    } else {
      setCertificate(null);
      setSearched(false);
    }
  }, [initialId]);

  // Redraw the canvas in background for high-fidelity offline downloads
  useEffect(() => {
    if (certificate && canvasRef.current) {
      setCanvasLoading(true);
      
      const baseDomain = getBaseVerificationUrl();
      const qrDataUrl = certificate.qrCodeDataUrl || '';

      const timer = setTimeout(async () => {
        try {
          if (canvasRef.current) {
            const hostOnly = getHostnameOnly(baseDomain);
            await renderCertificateToCanvas(canvasRef.current, certificate, qrDataUrl, hostOnly);
          }
        } catch (e) {
          console.error("Canvas drawing failed", e);
        } finally {
          setCanvasLoading(false);
        }
      }, 400);

      return () => clearTimeout(timer);
    }
  }, [certificate, customDomain]);

  const handleDownloadPdf = async () => {
    if (!certificate) return;
    const baseDomain = getBaseVerificationUrl();
    const hostOnly = getHostnameOnly(baseDomain);
    const qrDataUrl = certificate.qrCodeDataUrl || '';
    await downloadCanvasAsPdf(certificate, qrDataUrl, hostOnly, `MoFA_e-Apostille_${certificate.id}.pdf`);
  };

  const handleDownloadJpg = () => {
    if (!canvasRef.current || !certificate) return;
    downloadCanvasAsJpg(canvasRef.current, `MoFA_e-Apostille_${certificate.id}.jpg`);
  };

  return (
    <div className={`mx-auto bg-white min-h-screen animate-fade-in font-sans selection:bg-[#006a4e] selection:text-white pb-14 text-slate-800 pt-0 ${searched && certificate ? 'max-w-3xl' : 'max-w-xl'}`}>
           {/* Clean Left-Aligned Header Logo with Modest Padding */}
      <div className="w-full bg-white border-b border-gray-100 py-3.5 sm:py-4 px-4 sm:px-6 flex items-center justify-between select-none">
        <div className="flex items-center gap-3 select-none">
          <img 
            src="https://upload.wikimedia.org/wikipedia/commons/8/84/Government_Seal_of_Bangladesh.svg"
            alt="myGov Logo"
            className="h-12 sm:h-16 w-auto flex-shrink-0 object-contain select-none block drop-shadow-sm"
            referrerPolicy="no-referrer"
          />
          <div className="flex flex-col justify-center leading-tight">
            <span className="text-2xl sm:text-3xl font-black tracking-tight font-sans">
              <span className="text-[#eb1c24]">my</span>
              <span className="text-[#008751]">Gov</span>
            </span>
            <span className="text-xs sm:text-sm font-bold text-slate-900 tracking-tight whitespace-nowrap">
              এক ঠিকানায় সরকারি সেবা
            </span>
          </div>
        </div>
      </div>

      <div className="px-5 sm:px-6 -mt-2 sm:-mt-3 pb-6 relative z-10">
        
        {/* WELCOME PORTAL HOME SCREEN: Standard Search Form */}
        {!searched && (
          <div className="space-y-6 text-center py-6 sm:py-10 animate-fade-in flex flex-col items-center justify-center">
            <div className="w-full max-w-lg mx-auto bg-white border border-gray-200 rounded-3xl p-6 sm:p-8 shadow-sm space-y-5 text-left">
              <div className="text-center space-y-1.5 pb-2">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-50 text-[#006a4e] mb-1 border border-emerald-100 shadow-xs">
                  <BadgeCheck className="w-6 h-6" />
                </div>
                <h1 className="text-lg sm:text-xl font-black text-[#0f2c59]">
                  অনলাইন সেবা সত্যায়ন ও যাচাইকরণ পোর্টাল
                </h1>
                <p className="text-xs text-gray-500 font-medium">
                  পররাষ্ট্র মন্ত্রণালয় (MoFA) কর্তৃক সত্যায়িত ই-অ্যাপোস্টিলে সনদ ও ট্র্যাকিং নম্বর যাচাই করুন
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (searchId.trim()) handleVerify(searchId.trim());
                }}
                className="space-y-3"
              >
                <div className="space-y-1">
                  <label className="text-[11px] font-black text-slate-700 uppercase tracking-wide">
                    ট্র্যাকিং নম্বর বা সনদ আইডি (Tracking ID / Certificate ID)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="যেমন: BD-AP-2026-958760 বা 010090"
                      value={searchId}
                      onChange={(e) => setSearchId(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono font-bold text-slate-800 outline-none focus:border-[#006a4e] focus:bg-white transition"
                    />
                    <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5 pointer-events-none" />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!searchId.trim() || loading}
                  className="w-full py-3 bg-[#006a4e] hover:bg-[#005c43] text-white text-sm font-black rounded-xl cursor-pointer transition shadow-xs disabled:opacity-50 active:scale-[0.99] flex items-center justify-center gap-2"
                >
                  <Search className="w-4 h-4" />
                  <span>যাচাই করুন</span>
                </button>
              </form>

              {/* Sample / Quick Select list if records exist */}
              {publicCerts && publicCerts.length > 0 && (
                <div className="pt-3 border-t border-gray-100 space-y-2">
                  <p className="text-[10.5px] font-bold text-gray-400">
                    সাম্প্রতিক নিবন্ধিত সনদ (নমুনা নির্বাচন):
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                    {publicCerts.slice(0, 6).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSearchId(item.id);
                          handleVerify(item.id);
                        }}
                        className="px-2.5 py-1 bg-gray-50 hover:bg-emerald-50 text-slate-700 hover:text-[#006a4e] border border-gray-200 hover:border-emerald-200 rounded-lg text-[10.5px] font-mono font-bold transition cursor-pointer"
                      >
                        {item.id} {item.applicantName ? `(${item.applicantName})` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* REAL-TIME SPINNER MODAL ON SEARCH */}
      {loading && (
        <div className="fixed inset-0 z-50 bg-[#0c1524e1] backdrop-blur-sm flex flex-col items-center justify-center animate-fade-in p-4">
          <div className="bg-white p-8 rounded-3xl border border-gray-100 flex flex-col items-center justify-center shadow-2xl max-w-xs text-center space-y-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-full border-4 border-gray-100 border-t-[#006a4e] animate-spin"></div>
              <CheckCircle2 className="w-6 h-6 text-[#006a4e] absolute inset-0 m-auto animate-pulse" />
            </div>
            <div>
              <h4 className="text-lg font-black text-[#0f2c59] tracking-tight">যাচাই করা হচ্ছে...</h4>
              <p className="text-xs text-gray-500 font-bold leading-normal mt-1">আপনার তথ্য নিরাপদে যাচাই করা হচ্ছে</p>
            </div>
          </div>
        </div>
      )}

      {/* VERIFIED RESULTS CONTAINER */}
      {searched && !loading && (
        <div className="px-4 sm:px-5 space-y-8 max-w-4xl mx-auto">
          
          {/* Top Return Button */}
          <div className="no-print flex items-center justify-between pb-2 border-b border-gray-200">
            <button
              type="button"
              onClick={handleResetSearch}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-[#006a4e] bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg border border-emerald-200 cursor-pointer transition shadow-2xs"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>পুনরায় অনুসন্ধান করুন</span>
            </button>
            {certificate && (
              <span className="text-[10.5px] font-bold text-gray-400">
                ভেরিফাইড আইডি: <span className="font-mono text-emerald-800 font-extrabold">{certificate.id}</span>
              </span>
            )}
          </div>

          {/* INVALID STATE */}
          {!certificate && errorMsg && (
            <div className="space-y-6">
              <div className="bg-red-50 border border-red-200 rounded-3xl p-6 flex flex-col sm:flex-row items-center gap-5 shadow-sm max-w-2xl mx-auto animate-fade-in">
                <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-8 h-8" />
                </div>
                <div className="text-center sm:text-left flex-1">
                  <h3 className="text-lg font-black text-red-800 uppercase tracking-tight">Verification Record Not Found</h3>
                  <p className="text-xs text-red-600 font-bold mt-1 leading-normal">{errorMsg}</p>
                </div>
              </div>

              {/* Easy re-search on error */}
              <div className="max-w-lg mx-auto bg-white border border-gray-200 rounded-3xl p-6 text-center space-y-4 shadow-sm">
                <p className="text-xs font-black text-slate-700">অন্য কোনো ট্র্যাকিং নম্বর দিয়ে পুনরায় অনুসন্ধান করুন:</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (searchId.trim()) handleVerify(searchId.trim());
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    placeholder="যেমন: BD-AP-2026-958760 বা 010090"
                    value={searchId}
                    onChange={(e) => setSearchId(e.target.value)}
                    className="flex-1 px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono font-bold text-slate-800 outline-none focus:border-[#006a4e]"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2.5 bg-[#006a4e] text-white text-xs font-black rounded-xl cursor-pointer hover:bg-[#005c43]"
                  >
                    যাচাই করুন
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* VERIFIED HIGH-FIDELITY HTML/CSS LAYOUT */}
          {certificate && (
            <div className="space-y-6 animate-fade-in">
              
              {/* A4 Apostille Main Board Preview (Always visible at the top as requested) */}
              <div className="space-y-3">
                
                <ApostilleMainBoard 
                  certificate={certificate} 
                  baseDomain={getBaseVerificationUrl()} 
                  readOnly={true} 
                />

                {/* Single bottom download button as requested by user */}
                <div className="no-print pt-6 pb-2 text-center max-w-sm mx-auto">
                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    className="w-full bg-[#006a4e] hover:bg-[#005c43] text-white font-extrabold text-xs sm:text-base py-3.5 px-6 rounded-2xl transition-all shadow-md active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 border border-[#005c43]"
                  >
                    <Download className="w-4 h-4 flex-shrink-0" />
                    অ্যপোস্টিল ডাউনলোড করুন
                  </button>
                </div>

              </div>

              {/* SYSTEM PERSISTED ENCLOSURE DOCUMENTS (ke ke sottyaito korse) LAYOUT */}
              {certificate.attachedCertificates && certificate.attachedCertificates.length > 0 && (
                <div className="space-y-6 mt-8 max-w-xl mx-auto">
                  
                  <div className="text-center border-b border-gray-200 pb-2.5 mt-4">
                    <h3 className="text-base font-extrabold text-gray-900 uppercase tracking-tight">
                      সংযুক্ত মূল সনদপত্র এবং সত্যায়ন তথ্য
                    </h3>
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide">
                      Attestation Chain Summary and Official Records
                    </p>
                  </div>

                  <div className="space-y-8">
                    {certificate.attachedCertificates.map((certItem, index) => (
                      <div key={certItem.id} className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-6 text-slate-800">
                        
                        {/* Title bar of document */}
                        <div className="flex border-b border-gray-200 pb-2.5 mb-2 items-center justify-between flex-wrap gap-2">
                          <span className="text-[10px] font-black text-[#006a4e] uppercase bg-[#006a4e]/10 px-3 py-1 rounded-full border border-[#006a4e]/20">
                            ATTACHMENT RECORD #{index + 1}
                          </span>
                          <span className="text-xs sm:text-sm font-extrabold text-slate-900 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">
                            {certItem.id || `Certificate ${index + 1}`}
                          </span>
                        </div>

                        <div className="space-y-6">
                          
                          {/* Centered Attached Original Copy */}
                          <div className="flex flex-col items-center">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2 self-start">Original Scanned Copy:</span>
                            
                            <div 
                              onClick={() => { if (certItem.certificateImageUrl) setLightboxImage(certItem.certificateImageUrl); }}
                              className="relative border border-gray-150 rounded-xl overflow-hidden bg-gray-50 h-64 sm:h-80 w-full max-w-md flex items-center justify-center group cursor-zoom-in shadow-inner"
                            >
                              <img 
                                src={certItem.certificateImageUrl} 
                                alt={`Certificate scan ${index + 1}`}
                                className="max-h-full max-w-full object-contain filter transition-all group-hover:brightness-95"
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 flex items-center justify-center transition-all bg-opacity-10">
                                <span className="opacity-0 group-hover:opacity-100 bg-black/90 text-white rounded-lg text-[9px] font-black px-3 py-1.5 uppercase tracking-wide flex items-center gap-1 shadow-md">
                                  <ZoomIn className="w-3.5 h-3.5" /> Enlarge Document copy
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Attester physical signatures stacked sequentially */}
                          {certItem.attestations && certItem.attestations.length > 0 && (
                            <div className="space-y-5 pt-4 border-t border-gray-155">
                              <h4 className="text-[9.5px] font-extrabold text-gray-400 uppercase tracking-wider text-center">
                                সত্যায়ন কর্মকর্তা এবং স্বাক্ষর বিবরণী (Attestation Log)
                              </h4>

                              <div className="space-y-6 flex flex-col items-center">
                                {certItem.attestations.map((attAction) => (
                                  <div 
                                    key={attAction.id} 
                                    className="w-full max-w-md flex flex-col items-center text-center p-4 bg-gray-50 border border-gray-200 rounded-2xl relative select-none shadow-sm"
                                  >
                                    {/* Continuous handwritten / cursive attestation headline */}
                                    <div className="font-['Dancing_Script',cursive] text-2xl text-[#006a4e] border-b border-dashed border-gray-300/80 pb-1 w-full normal-case tracking-wide font-bold leading-tight text-center">
                                      &quot;{attAction.type || 'Verified and found correct'}&quot;
                                    </div>

                                    {/* Signature photo in center with transparent mix-blend */}
                                    {attAction.signatureImageUrl ? (
                                      <div className="h-12 my-2.5 flex items-center justify-center max-w-[150px]">
                                        <img 
                                          src={attAction.signatureImageUrl} 
                                          alt="Attestation Ink Signature" 
                                          className="h-full object-contain filter mix-blend-multiply"
                                          referrerPolicy="no-referrer"
                                        />
                                      </div>
                                    ) : (
                                      <div className="h-8 my-2 flex items-center justify-center opacity-40 italic text-[10px] text-gray-500">
                                        (Digitally Signed)
                                      </div>
                                    )}

                                    {/* Officer Parameters in seal ink color */}
                                    <div className="space-y-0.5 leading-tight text-center">
                                      <p className="text-[12px] font-black uppercase tracking-tight text-[#006a4e]">{attAction.officerName}</p>
                                      <p className="text-[10.5px] font-bold leading-tight px-2 max-w-xs text-[#006a4e]/90">{attAction.officerDesignation}</p>
                                      <p className="text-[10px] font-medium text-[#006a4e] font-mono tracking-wider mt-1.5">
                                        Date: {attAction.date}
                                      </p>
                                    </div>

                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                        </div>

                      </div>
                    ))}
                  </div>

                </div>
              )}

              {/* HIDDEN BACKGROUND CANVAS NODE FOR SYSTEM PREPARATION */}
              <canvas 
                ref={canvasRef} 
                className="hidden pointer-events-none absolute opacity-0"
              />

            </div>
          )}

          {/* LIGHTBOX POPUP */}
          {lightboxImage && (
            <div 
              onClick={() => setLightboxImage(null)}
              className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 cursor-zoom-out animate-fade-in"
            >
              <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center justify-center">
                <button 
                  onClick={() => setLightboxImage(null)}
                  className="absolute -top-12 right-0 bg-[#006a4e] text-white px-4 py-2 font-black uppercase text-xs rounded-xl cursor-pointer hover:bg-[#004e39] transition-colors"
                  title="Close Preview"
                >
                  Close Preview
                </button>
                <img 
                  src={lightboxImage} 
                  alt="Full Enlarge View" 
                  className="max-w-full max-h-[80vh] object-contain rounded-xl border border-gray-800 shadow-2xl bg-white"
                  referrerPolicy="no-referrer"
                />
                <p className="text-gray-400 text-xs mt-3 leading-loose select-none font-bold text-center">
                  Verified e-Apostille Document Node. Tap anywhere of background to dismiss.
                </p>
              </div>
            </div>
          )}

        </div>
      )}

    </div>
  );
}
