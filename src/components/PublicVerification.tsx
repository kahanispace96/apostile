/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Search, BadgeCheck, FileDown, Image, Sparkles, RefreshCw, AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, ZoomIn, FileText, CheckCircle, MapPin, Calendar, Award, ArrowDownCircle, Download } from 'lucide-react';
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
        if (Array.isArray(parsed)) return parsed;
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
    const trimmedId = idToSearch.trim().toUpperCase();
    if (!trimmedId) return;

    setLoading(true);
    setErrorMsg('');
    setCertificate(null);
    setSearched(true);
    setSearchId(trimmedId);

    try {
      const response = await fetch(`/api/certificates/verify/${encodeURIComponent(trimmedId)}`);
      const responseText = await response.text();
      
      if (responseText && responseText.trim().startsWith('{')) {
        const data = JSON.parse(responseText);
        if (response.ok && data.success && data.certificate) {
          setCertificate(data.certificate);
          setCustomDomain(data.customDomain || '');
          setLoading(false);
          return;
        } else {
          // Explicit API response that record was NOT found
          setErrorMsg(data.message || `No matching verification record was found for Token / ID "${trimmedId}".`);
          setCertificate(null);
          setLoading(false);
          return;
        }
      }
    } catch (err) {
      console.log('API fetch failed, checking browser storage');
    }

    // Secondary local store search (MoFA_Certificates) - search local storage only if offline
    const localCerts = getLocalCertificates();
    const cleanSearch = trimmedId.replace(/[^A-Z0-9]/g, '');

    const match = localCerts.find(c => {
      const cId = c.id ? c.id.trim().toUpperCase() : '';
      const cCleanId = cId.replace(/[^A-Z0-9]/g, '');
      const cCertNum = c.certificateNumber ? c.certificateNumber.trim().toUpperCase() : '';
      const cCleanCertNum = cCertNum.replace(/[^A-Z0-9]/g, '');

      return cId === trimmedId ||
             (cleanSearch.length > 3 && cCleanId === cleanSearch) ||
             (cCertNum && cCertNum === trimmedId) ||
             (cleanSearch.length > 3 && cCleanCertNum === cleanSearch);
    });

    if (match) {
      setCertificate(match);
      setCustomDomain('');
    } else {
      setErrorMsg(`No matching verification record was found for Token / ID "${trimmedId}".`);
      setCertificate(null);
    }
    setLoading(false);
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

  // Run initial search ONLY if ID is specifically passed in URL or QR scan
  useEffect(() => {
    if (initialId) {
      handleVerify(initialId);
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
        
        {/* WELCOME PORTAL HOME SCREEN: Renders only if no QR code scan / URL target is loaded */}
        {!searched && (
          <div className="space-y-6 text-center py-10 sm:py-16 animate-fade-in flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-[#006a4e] mb-4 shadow-sm">
              <BadgeCheck className="w-8 h-8" />
            </div>
            <div className="space-y-2.5 max-w-md">
              <h1 className="text-[19px] sm:text-[23px] font-black text-[#0f2c59] tracking-tight leading-snug">
                অ্যাপোস্টিল ডিজিটাল পোর্টালে স্বাগতম
              </h1>
              <p className="text-[10px] sm:text-[11px] text-[#006a4e] font-black uppercase tracking-widest leading-relaxed">
                E-APOSTILLE VERIFICATION SYSTEM, MINISTRY OF FOREIGN AFFAIRS
              </p>
              <div className="w-12 h-0.5 bg-[#006a4e]/20 mx-auto my-3"></div>
              <p className="text-xs text-gray-400 font-bold leading-normal">
                দয়া করে আপনার সনده মুদ্রিত কিউআর (QR) কোডটি স্ক্যান করে ভেরিফাই করুন।
              </p>
              <p className="text-[10px] text-gray-400 italic">
                Please scan the QR code printed on your document to verify its authenticity.
              </p>
            </div>
          </div>
        )}

      </div>

      {/* REAL-TIME SPINNER MODAL ON SEARCH (MATCHING VIDEO TEXT) */}
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
        <div className="px-4 sm:px-5 space-y-10 max-w-4xl mx-auto">
          
          {/* INVALID STATE */}
          {!certificate && errorMsg && (
            <div className="bg-red-50 border border-red-200 rounded-3xl p-6 flex flex-col sm:flex-row items-center gap-5 shadow-sm max-w-2xl mx-auto animate-fade-in">
              <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <div className="text-center sm:text-left">
                <h3 className="text-lg font-black text-red-800 uppercase tracking-tight">✗ Verification Record Not Found</h3>
                <p className="text-xs text-red-600 font-bold mt-1 leading-normal">{errorMsg}</p>
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
                            📜 {certItem.id || `Certificate ${index + 1}`}
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
                  ✕ Close Preview
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
