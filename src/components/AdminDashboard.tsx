/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { 
  FilePlus2, Database, Settings, ShieldCheck, Search, Trash2, Edit, Save, 
  X, RefreshCw, BadgeInfo, Image as ImageIcon, CheckCircle, KeyRound, Eye,
  FileDown, Plus, Download, Copy, Check, ArrowRight, Trash, QrCode, Sparkles,
  ExternalLink, AlertTriangle, Upload, ZoomIn
} from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Certificate, AttachedCertificate, AttestationItem } from '../types';
import { FALLBACK_CERTIFICATES } from '../fallbackData';
import { renderCertificateToCanvas, downloadCanvasAsPdf, downloadCanvasAsJpg } from '../utils/certificateRenderer';
import { saveCertificatePermanently, fetchAllCertificatesFromFirestore, lookupCertificateFromFirestore } from '../utils/firestoreHelper';
import { decodeQrCodeFromImage } from '../utils/qrDecoder';
import ApostilleMainBoard from './ApostilleMainBoard';

interface AdminDashboardProps {
  token: string;
  onLogout: () => void;
}

export default function AdminDashboard({ token, onLogout }: AdminDashboardProps) {
  // Navigation views
  const [activeTab, setActiveTab] = useState<'records' | 'create' | 'view-as' | 'search' | 'settings'>('records');

  // Admin Internal Search states
  const [adminSearchId, setAdminSearchId] = useState('');
  const [adminSearchResult, setAdminSearchResult] = useState<{ searched: boolean; cert: Certificate | null; message?: string }>({ searched: false, cert: null });
  const [adminSearchLoading, setAdminSearchLoading] = useState(false);

  // Backend states
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: '', text: '' });

  // Live QR Code preview state
  const [livePreviewQr, setLivePreviewQr] = useState<string>('');

  // Post-submit QR Code distribution screen state
  const [generatedProfile, setGeneratedProfile] = useState<Certificate | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // System settings
  const [settings, setSettings] = useState({
    defaultLogoUrl: '',
    globalSealUrl: '',
    globalSignatureUrl: '',
    customDomain: ''
  });

  // Certificate values
  const [certForm, setCertForm] = useState<Partial<Certificate>>({
    id: '',
    applicantName: '',
    fatherName: '',
    motherName: '',
    dob: '',
    certificateType: 'Educational Certificate',
    examinationName: '',
    rollNumber: '',
    registrationNumber: '',
    certificateNumber: '',
    boardName: 'Dhaka',
    country: 'Bangladesh',
    issueDate: new Date().toISOString().split('T')[0],
    officerName: 'Md. Siddiqur Rahman',
    officerDesignation: 'Assistant Secretary',
    signatureImageUrl: '',
    sealImageUrl: '',
    attachedCertificates: [],
    fullyAttestedDocumentUrl: ''
  });

  // Editor states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploadedQrDecodedInfo, setUploadedQrDecodedInfo] = useState<string | null>(null);

  // Live preview element
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // View-As (Public Verification Previewer) states
  const [viewAsId, setViewAsId] = useState('');
  const [viewAsCert, setViewAsCert] = useState<Certificate | null>(null);
  const [viewAsLoading, setViewAsLoading] = useState(false);
  const [viewAsError, setViewAsError] = useState('');
  const [viewAsLightboxImage, setViewAsLightboxImage] = useState<string | null>(null);
  const [viewAsCopied, setViewAsCopied] = useState(false);

  // Password fields
  const [passwordForm, setPasswordForm] = useState({ oldPassword: '', newPassword: '' });

  const getBaseVerificationUrl = () => {
    const metaEnv = (import.meta as any).env;
    const envBase = (metaEnv?.VITE_PUBLIC_BASE_URL || (typeof process !== 'undefined' && process.env?.PUBLIC_BASE_URL)) as string | undefined;
    if (envBase && envBase.trim() !== '') {
      let b = envBase.trim();
      if (!b.startsWith('http://') && !b.startsWith('https://')) b = 'https://' + b;
      if (b.endsWith('/')) b = b.slice(0, -1);
      return b;
    }

    if (settings.customDomain && settings.customDomain.trim() !== '') {
      let domain = settings.customDomain.trim();
      if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
        domain = 'https://' + domain;
      }
      if (domain.endsWith('/')) {
        domain = domain.slice(0, -1);
      }
      return domain;
    }
    return window.location.origin;
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

  // Load overall certificates & settings
  const fetchRecords = async () => {
    setLoading(true);
    const normalizeCertCountry = (c: any): Certificate => {
      if (!c) return c;
      return {
        ...c,
        country: (c.country && c.country !== 'United Kingdom' && c.country !== 'Target Country') ? c.country : 'Bangladesh'
      };
    };

    try {
      const q = searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : '';
      const res = await fetch(`/api/certificates${q}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const responseText = await res.text();
      let data: any = null;
      if (responseText && responseText.trim().startsWith('{')) {
        try { data = JSON.parse(responseText); } catch (e) { data = null; }
      }

      if (res.ok && data && data.success && Array.isArray(data.certificates)) {
        const normalized = data.certificates.map(normalizeCertCountry);
        setCertificates(normalized);
        localStorage.setItem('MoFA_Certificates', JSON.stringify(normalized));
        setLoading(false);
        return;
      }
    } catch (e) {
      console.log('Failed to fetch certificates from server, checking local store');
    }

    // Primary fallback: Lifetime permanent records directly from Cloud Firestore
    try {
      const fsCerts = await fetchAllCertificatesFromFirestore();
      if (fsCerts && fsCerts.length > 0) {
        const normalized = fsCerts.map(normalizeCertCountry);
        setCertificates(normalized);
        try { localStorage.setItem('MoFA_Certificates', JSON.stringify(normalized)); } catch (e) {}
        setLoading(false);
        return;
      }
    } catch (e) {
      console.warn('[AdminDashboard] Firestore direct records fetch notice:', e);
    }

    // Fallback load from localStorage or static fallback
    try {
      const localStored = localStorage.getItem('MoFA_Certificates');
      if (localStored) {
        const parsed = JSON.parse(localStored);
        if (Array.isArray(parsed)) {
          const filtered = parsed
            .filter(c => c.id && !c.id.startsWith('APO-TEST-') && c.id !== 'BD-AP-2026-95851')
            .map(normalizeCertCountry);
          setCertificates(filtered);
          localStorage.setItem('MoFA_Certificates', JSON.stringify(filtered));
          setLoading(false);
          return;
        }
      }
    } catch (e) {}

    setCertificates(FALLBACK_CERTIFICATES);
    setLoading(false);
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSettings(data.settings);
        // Apply default seal/signature templates to creation form if empty
        if (!certForm.signatureImageUrl && data.settings.globalSignatureUrl) {
          setCertForm(prev => ({ 
            ...prev, 
            signatureImageUrl: data.settings.globalSignatureUrl,
            sealImageUrl: data.settings.globalSealUrl
          }));
        }
      }
    } catch (e) {
      console.error('Failed to retrieve system configurations.', e);
    }
  };

  useEffect(() => {
    fetchRecords();
    fetchSettings();
  }, [searchTerm]);

  // Auto-generate live QR Code preview whenever tracking ID or manualQrUrl changes
  useEffect(() => {
    let isMounted = true;
    const targetId = certForm.id && certForm.id.trim() ? certForm.id.trim().toUpperCase() : 'TRK-001';
    const baseDomain = getBaseVerificationUrl();
    const url = (certForm.manualQrUrl && certForm.manualQrUrl.trim())
      ? certForm.manualQrUrl.trim()
      : `${baseDomain}/verify/${encodeURIComponent(targetId)}`;

    QRCode.toDataURL(url, { margin: 1, width: 300, color: { dark: '#000000', light: '#ffffff' } })
      .then(qr => {
        if (isMounted) setLivePreviewQr(qr);
      })
      .catch(() => {});

    return () => { isMounted = false; };
  }, [certForm.id, certForm.manualQrUrl, settings.customDomain]);

  // Handle Certificate Realtime Canvas Loading
  useEffect(() => {
    if (activeTab === 'create' && previewCanvasRef.current) {
      setPreviewLoading(true);
      const testCert: Certificate = {
        id: certForm.id || 'PREVIEW-TEMP',
        applicantName: (certForm.applicantName || 'FULL NAME OF APPLICANT').toUpperCase(),
        fatherName: (certForm.fatherName || 'FATHER NAME').toUpperCase(),
        motherName: (certForm.motherName || 'MOTHER NAME').toUpperCase(),
        dob: certForm.dob || '2000-01-01',
        certificateType: certForm.certificateType || 'Educational Certificate',
        examinationName: certForm.examinationName || undefined,
        rollNumber: certForm.rollNumber || undefined,
        registrationNumber: certForm.registrationNumber || undefined,
        certificateNumber: certForm.certificateNumber || 'CERT-NO-XXXXXX',
        boardName: certForm.boardName || undefined,
        country: certForm.country || 'Bangladesh',
        issueDate: certForm.issueDate || new Date().toISOString().split('T')[0],
        officerName: certForm.officerName || 'Md. Nazrul Islam',
        officerDesignation: certForm.officerDesignation || 'Assistant Secretary',
        signatureImageUrl: certForm.signatureImageUrl || settings.globalSignatureUrl,
        sealImageUrl: certForm.sealImageUrl || settings.globalSealUrl,
        createdDate: new Date().toISOString(),
        status: 'VERIFIED'
      };

      const baseDomain = getBaseVerificationUrl();
      const qrDataUrl = certForm.qrCodeDataUrl || livePreviewQr || '';

      const timer = setTimeout(async () => {
        try {
          if (previewCanvasRef.current) {
            const hostOnly = getHostnameOnly(baseDomain);
            await renderCertificateToCanvas(previewCanvasRef.current, testCert, qrDataUrl, hostOnly);
          }
        } catch (e) {
          console.error(e);
        } finally {
          setPreviewLoading(false);
        }
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [certForm, activeTab, settings, livePreviewQr]);

  const showStatus = (type: 'success' | 'error', text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg({ type: '', text: '' }), 4000);
  };

  const downloadCertificateImmediate = async (cert: Certificate) => {
    const baseDomain = getBaseVerificationUrl();
    const qrDataUrl = cert.qrCodeDataUrl || '';
    try {
      const hostOnly = getHostnameOnly(baseDomain);
      await downloadCanvasAsPdf(cert, qrDataUrl, hostOnly, `MoFA_e-Apostille_${cert.id}.pdf`);
    } catch (err) {
      console.error("Direct download failed", err);
    }
  };

  const handleLoadViewAs = async (idToLoad?: string, prefetched?: Certificate) => {
    const rawTarget = (idToLoad !== undefined ? idToLoad : viewAsId).trim();
    if (!rawTarget) return;

    if (prefetched) {
      setViewAsCert(prefetched);
      setViewAsId(prefetched.id);
      setViewAsError('');
      return;
    }

    // 1. Check local loaded state first for instant response
    const foundLocal = certificates.find(c => c.id.toUpperCase() === rawTarget.toUpperCase());
    if (foundLocal) {
      setViewAsCert(foundLocal);
      setViewAsId(foundLocal.id);
      setViewAsError('');
      return;
    }

    setViewAsLoading(true);
    setViewAsError('');

    // 2. Fetch from API endpoint
    try {
      const res = await fetch(`/api/certificates/${encodeURIComponent(rawTarget)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.certificate) {
          setViewAsCert(data.certificate);
          setViewAsId(data.certificate.id);
          setViewAsLoading(false);
          return;
        }
      }
    } catch (e) {}

    // 3. Fallback to direct Firestore
    try {
      const fsCert = await lookupCertificateFromFirestore(rawTarget);
      if (fsCert) {
        setViewAsCert(fsCert);
        setViewAsId(fsCert.id);
        setViewAsLoading(false);
        return;
      }
    } catch (e) {}

    // 4. Fallback to LocalStorage
    try {
      const localStored = localStorage.getItem('MoFA_Certificates');
      if (localStored) {
        const parsed = JSON.parse(localStored);
        const match = parsed.find((c: any) => c.id && c.id.toUpperCase() === rawTarget.toUpperCase());
        if (match) {
          setViewAsCert(match);
          setViewAsId(match.id);
          setViewAsLoading(false);
          return;
        }
      }
    } catch (e) {}

    setViewAsCert(null);
    setViewAsError(`"${rawTarget}" ট্র্যাকিং নম্বরের কোনো অ্যাপোস্টিল রেকর্ড পাওয়া যায়নি। অনুগ্রহ করে নম্বরটি সঠিকভাবে মিলিয়ে নিন।`);
    setViewAsLoading(false);
  };

  // -------------------------------------------------------------
  // DYNAMIC MULTI-CERTIFICATE & ATTESTATION HANDLERS (Supports 5, 10 or more)
  // -------------------------------------------------------------
  const DOCUMENT_OPTIONS = [
    'Honours Certificate',
    'Secondary School Certificate',
    'Higher Secondary Certificate',
    'Passport',
    'Other'
  ];

  // Official default MoFA attestation officer presets
  const DEFAULT_OFFICER_PRESETS = [
    {
      id: 'afrin',
      name: 'Afrin Haque',
      designation: 'Senior Assistant Secretary',
      type: 'Verify and found correct',
      shortDesc: 'Verify & found correct'
    },
    {
      id: 'siddiqur',
      name: 'Md. Siddiqur Rahman',
      designation: 'Assistant Secretary',
      type: 'Attested',
      shortDesc: 'Attested'
    },
    {
      id: 'shemul',
      name: 'Md. Shemul Ahmmed',
      designation: 'Consular Assistant',
      type: 'Verify and found correct',
      shortDesc: 'Verify & found correct (Passport)'
    }
  ];

  const getDefaultAttestationsForDocType = (docType: string): AttestationItem[] => {
    const today = new Date().toISOString().split('T')[0];
    const sigUrl = settings.globalSignatureUrl || '';

    if (docType === 'Passport') {
      return [
        {
          id: "ATT-" + Math.random().toString(36).substring(2, 7).toUpperCase(),
          type: 'Verify and found correct',
          officerName: 'Md. Shemul Ahmmed',
          officerDesignation: 'Consular Assistant',
          date: today,
          signatureImageUrl: sigUrl
        },
        {
          id: "ATT-" + Math.random().toString(36).substring(2, 7).toUpperCase(),
          type: 'Attested',
          officerName: 'Md. Siddiqur Rahman',
          officerDesignation: 'Assistant Secretary',
          date: today,
          signatureImageUrl: sigUrl
        }
      ];
    } else {
      return [
        {
          id: "ATT-" + Math.random().toString(36).substring(2, 7).toUpperCase(),
          type: 'Verify and found correct',
          officerName: 'Afrin Haque',
          officerDesignation: 'Senior Assistant Secretary',
          date: today,
          signatureImageUrl: sigUrl
        },
        {
          id: "ATT-" + Math.random().toString(36).substring(2, 7).toUpperCase(),
          type: 'Attested',
          officerName: 'Md. Siddiqur Rahman',
          officerDesignation: 'Assistant Secretary',
          date: today,
          signatureImageUrl: sigUrl
        }
      ];
    }
  };

  const addAttachedCertificate = (chosenType?: string) => {
    const currentCount = certForm.attachedCertificates?.length || 0;
    const defaultType = chosenType || (
      currentCount === 0 ? 'Honours Certificate' :
      currentCount === 1 ? 'Secondary School Certificate' :
      currentCount === 2 ? 'Higher Secondary Certificate' :
      currentCount === 3 ? 'Passport' : 'Other'
    );

    const newCert: AttachedCertificate = {
      id: defaultType === 'Other' ? `DOC-${currentCount + 1}` : defaultType,
      documentType: defaultType,
      certificateImageUrl: '',
      attestations: getDefaultAttestationsForDocType(defaultType)
    };
    setCertForm(prev => ({
      ...prev,
      attachedCertificates: [...(prev.attachedCertificates || []), newCert]
    }));
  };

  const updateCertificateDocType = (index: number, docType: string) => {
    setCertForm(prev => {
      const list = [...(prev.attachedCertificates || [])];
      if (list[index]) {
        const prevDocType = list[index].documentType;
        let attestations = list[index].attestations;

        // Auto-switch to Passport default (Md. Shemul Ahmmed) or Standard default (Afrin Haque) if switching types
        if (docType === 'Passport' && prevDocType !== 'Passport') {
          attestations = getDefaultAttestationsForDocType('Passport');
        } else if (docType !== 'Passport' && prevDocType === 'Passport') {
          attestations = getDefaultAttestationsForDocType(docType);
        }

        list[index] = {
          ...list[index],
          documentType: docType,
          id: docType === 'Other' ? (list[index].id && !DOCUMENT_OPTIONS.includes(list[index].id) ? list[index].id : `DOC-${index + 1}`) : docType,
          attestations
        };
      }
      return { ...prev, attachedCertificates: list };
    });
  };

  const resetCertificateAttestationsToDefault = (certIndex: number) => {
    setCertForm(prev => {
      const list = [...(prev.attachedCertificates || [])];
      if (list[certIndex]) {
        const docType = list[certIndex].documentType || 'Other';
        list[certIndex] = {
          ...list[certIndex],
          attestations: getDefaultAttestationsForDocType(docType)
        };
      }
      return { ...prev, attachedCertificates: list };
    });
  };

  const removeAttachedCertificate = (index: number) => {
    setCertForm(prev => ({
      ...prev,
      attachedCertificates: (prev.attachedCertificates || []).filter((_, i) => i !== index)
    }));
  };

  const updateAttachedCertificateImage = (index: number, imageBase64: string) => {
    setCertForm(prev => {
      const list = [...(prev.attachedCertificates || [])];
      if (list[index]) {
        list[index] = { ...list[index], certificateImageUrl: imageBase64 };
      }
      return { ...prev, attachedCertificates: list };
    });
  };

  const updateCertificateName = (index: number, name: string) => {
    setCertForm(prev => {
      const list = [...(prev.attachedCertificates || [])];
      if (list[index]) {
        list[index] = { ...list[index], id: name || list[index].id };
      }
      return { ...prev, attachedCertificates: list };
    });
  };

  const addAttestationToCertificate = (certIndex: number, presetId?: string) => {
    const targetDocType = certForm.attachedCertificates?.[certIndex]?.documentType;
    const isPassport = targetDocType === 'Passport';
    const today = new Date().toISOString().split('T')[0];

    let officerName = 'Md. Siddiqur Rahman';
    let officerDesignation = 'Assistant Secretary';
    let attType = 'Attested';

    if (presetId === 'afrin') {
      officerName = 'Afrin Haque';
      officerDesignation = 'Senior Assistant Secretary';
      attType = 'Verify and found correct';
    } else if (presetId === 'shemul' || (isPassport && !presetId)) {
      officerName = 'Md. Shemul Ahmmed';
      officerDesignation = 'Consular Assistant';
      attType = 'Verify and found correct';
    } else if (presetId === 'siddiqur') {
      officerName = 'Md. Siddiqur Rahman';
      officerDesignation = 'Assistant Secretary';
      attType = 'Attested';
    }

    const newAtt: AttestationItem = {
      id: "ATT-" + Math.random().toString(36).substring(2, 7).toUpperCase(),
      type: attType,
      officerName,
      officerDesignation,
      date: today,
      signatureImageUrl: settings.globalSignatureUrl || ''
    };
    setCertForm(prev => {
      const list = [...(prev.attachedCertificates || [])];
      if (list[certIndex]) {
        list[certIndex] = {
          ...list[certIndex],
          attestations: [...list[certIndex].attestations, newAtt]
        };
      }
      return { ...prev, attachedCertificates: list };
    });
  };

  const removeAttestationFromCertificate = (certIndex: number, attIndex: number) => {
    setCertForm(prev => {
      const list = [...(prev.attachedCertificates || [])];
      if (list[certIndex]) {
        list[certIndex] = {
          ...list[certIndex],
          attestations: list[certIndex].attestations.filter((_, i) => i !== attIndex)
        };
      }
      return { ...prev, attachedCertificates: list };
    });
  };

  const updateCertificateAttestation = (certIndex: number, attIndex: number, field: keyof AttestationItem, val: any) => {
    setCertForm(prev => {
      const list = [...(prev.attachedCertificates || [])];
      if (list[certIndex]) {
        const atts = [...list[certIndex].attestations];
        if (atts[attIndex]) {
          atts[attIndex] = { ...atts[attIndex], [field]: val };
        }
        list[certIndex] = { ...list[certIndex], attestations: atts };
      }
      return { ...prev, attachedCertificates: list };
    });
  };

  // Image compression helper to prevent oversized base64 strings and DB bloat
  const compressImage = (file: File, maxWidth = 1200, quality = 0.8): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
          } else {
            resolve(String(event.target?.result || ''));
          }
        };
        img.onerror = () => resolve(String(event.target?.result || ''));
        img.src = String(event.target?.result || '');
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
  };

  // Helper to generate a unique random tracking ID containing date (e.g. BD-AP-20260811-894102)
  const generateRandomTrackingId = (selectedDateStr?: string): string => {
    const existingUpper = certificates.map(c => c.id ? c.id.toUpperCase() : '');
    const dateVal = selectedDateStr || certForm.issueDate || new Date().toISOString().split('T')[0];
    const dateObj = new Date(dateVal);
    const validDate = isNaN(dateObj.getTime()) ? new Date() : dateObj;
    
    const yyyy = validDate.getFullYear();
    const mm = String(validDate.getMonth() + 1).padStart(2, '0');
    const dd = String(validDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;

    let candidate = '';
    let attempts = 0;
    do {
      const randomDigits = Math.floor(100000 + Math.random() * 900000); // 6-digit random number
      candidate = `BD-AP-${dateStr}-${randomDigits}`;
      attempts++;
    } while (existingUpper.includes(candidate.toUpperCase()) && attempts < 100);
    return candidate;
  };

  // Admin Search / Internal Verification Handler
  const handleAdminVerifySearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = adminSearchId.trim().toUpperCase();
    if (!trimmed) return;

    setAdminSearchLoading(true);
    setAdminSearchResult({ searched: false, cert: null });

    try {
      const res = await fetch(`/api/certificates/verify/${encodeURIComponent(trimmed)}`);
      const responseText = await res.text();
      let data: any = null;
      if (responseText && responseText.trim().startsWith('{')) {
        try { data = JSON.parse(responseText); } catch (err) { data = null; }
      }

      if (res.ok && data && data.success && data.certificate) {
        setAdminSearchResult({ searched: true, cert: data.certificate });
        setAdminSearchLoading(false);
        return;
      }
    } catch (err) {
      console.warn('Admin search API notice, checking local list:', err);
    }

    // Local lookup fallback from current loaded certificates list or LocalStorage
    let candidateList = certificates;
    try {
      const stored = localStorage.getItem('MoFA_Certificates');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) candidateList = parsed;
      }
    } catch (e) {}

    const found = candidateList.find(c => {
      const cId = c.id ? c.id.trim().toUpperCase() : '';
      return cId === trimmed;
    });

    if (found) {
      setAdminSearchResult({ searched: true, cert: found });
    } else {
      setAdminSearchResult({
        searched: true,
        cert: null,
        message: `ডাটাবেজে "${trimmed}" ট্র্যাকিং আইডির কোনো বৈধ রেকর্ড পাওয়া যায়নি। (INVALID / RECORD NOT FOUND)`
      });
    }
    setAdminSearchLoading(false);
  };

  // QR Code Image Upload Helper (Preserves sharp crisp QR pixels and attempts auto-decode)
  const handleQrImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = String(event.target?.result || '');
      if (!dataUrl) return;

      setCertForm(prev => ({
        ...prev,
        qrCodeDataUrl: dataUrl
      }));

      try {
        const decoded = await decodeQrCodeFromImage(file);
        if (decoded && (decoded.extractedUrl || decoded.rawText)) {
          const detectedVal = decoded.extractedUrl || decoded.rawText;
          setUploadedQrDecodedInfo(detectedVal);
          showStatus('success', `✓ কাস্টম QR ইমেজ আপলোড সফল! ডিকোডকৃত লিংক: ${detectedVal.substring(0, 45)}...`);
        } else {
          setUploadedQrDecodedInfo(null);
          showStatus('success', '✓ কাস্টম QR কোড ইমেজ সফলভাবে যুক্ত হয়েছে!');
        }
      } catch (decodeErr) {
        setUploadedQrDecodedInfo(null);
        showStatus('success', '✓ কাস্টম QR কোড ইমেজ সফলভাবে যুক্ত হয়েছে!');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const removeUploadedQrImage = () => {
    setCertForm(prev => ({
      ...prev,
      qrCodeDataUrl: ''
    }));
    setUploadedQrDecodedInfo(null);
    showStatus('success', '✓ কাস্টম QR ইমেজ মুছে ফেলা হয়েছে; স্বয়ংক্রিয় QR কোড পুনরায় কার্যকর।');
  };

  // Image Upload Helper for standalone values
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, targetField: 'signatureImageUrl' | 'sealImageUrl' | 'qrCodeDataUrl') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const compressed = await compressImage(file, 800, 0.85);
    if (compressed) {
      setCertForm(prev => ({
        ...prev,
        [targetField]: compressed
      }));
    }
  };

  // Form Submit Handler
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Required Field Validation
    if (!certForm.applicantName || !certForm.applicantName.trim()) {
      showStatus('error', 'Required field missing: Candidate Name (applicantName)');
      return;
    }

    setSubmitting(true);

    let verificationId = certForm.id ? certForm.id.trim().toUpperCase() : '';
    if (!verificationId) {
      verificationId = generateRandomTrackingId();
    }

    // Generate QR Code bound to exact direct verification URL or manual QR URL override
    let verificationUrl = '';
    if (certForm.manualQrUrl && certForm.manualQrUrl.trim()) {
      verificationUrl = certForm.manualQrUrl.trim();
    } else {
      const baseDomain = getBaseVerificationUrl();
      verificationUrl = `${baseDomain}/verify/${encodeURIComponent(verificationId)}`;
    }

    let generatedQrCode = '';
    // Priority 1: If user uploaded a custom QR code image, use it directly!
    if (certForm.qrCodeDataUrl && certForm.qrCodeDataUrl.trim().startsWith('data:image')) {
      generatedQrCode = certForm.qrCodeDataUrl.trim();
    } else {
      try {
        generatedQrCode = await QRCode.toDataURL(verificationUrl, {
          margin: 1,
          width: 300,
          color: { dark: '#000000', light: '#ffffff' }
        });
      } catch (qrErr) {
        console.error('Failed to auto-generate QR Code:', qrErr);
        generatedQrCode = certForm.qrCodeDataUrl || '';
      }
    }

    const finalCert: Certificate = {
      ...certForm,
      id: verificationId,
      applicantName: certForm.applicantName.trim().toUpperCase(),
      fatherName: (certForm.fatherName || '').trim().toUpperCase(),
      motherName: (certForm.motherName || '').trim().toUpperCase(),
      issueDate: certForm.issueDate || new Date().toISOString().split('T')[0],
      officerName: (certForm.officerName || 'Md. Nazrul Islam').trim(),
      officerDesignation: (certForm.officerDesignation || 'Assistant Secretary (Consular)').trim(),
      signatureImageUrl: certForm.signatureImageUrl || settings.globalSignatureUrl,
      sealImageUrl: certForm.sealImageUrl || settings.globalSealUrl,
      country: (certForm.country && certForm.country !== 'United Kingdom' ? certForm.country : 'Bangladesh'),
      boardName: certForm.boardName || 'Dhaka',
      certificateType: certForm.certificateType || 'Educational Certificate',
      qrCodeDataUrl: generatedQrCode,
      manualQrUrl: certForm.manualQrUrl || undefined,
      attachedCertificates: certForm.attachedCertificates || []
    };

    const updateStorageAndCloud = async (certToSave: Certificate) => {
      // 1. Permanent Cloud Firestore Save (Lifetime)
      try {
        await saveCertificatePermanently(certToSave);
      } catch (cloudErr) {
        console.warn('[AdminDashboard] Cloud Firestore permanent save notice:', cloudErr);
      }

      // 2. Local fallback sync
      try {
        const stored = localStorage.getItem('MoFA_Certificates');
        let currentList: any[] = stored ? JSON.parse(stored) : [];
        if (!Array.isArray(currentList)) currentList = [];
        const existingIdx = currentList.findIndex((c: any) => c.id.toUpperCase() === certToSave.id.toUpperCase());
        if (existingIdx >= 0) {
          currentList[existingIdx] = certToSave;
        } else {
          currentList.unshift(certToSave);
        }
        localStorage.setItem('MoFA_Certificates', JSON.stringify(currentList));
      } catch (e) {
        console.warn('LocalStorage save warning:', e);
      }
    };

    const resetCertForm = () => {
      setEditingId(null);
      setCertForm({
        id: generateRandomTrackingId(),
        applicantName: '',
        fatherName: '',
        motherName: '',
        dob: '',
        certificateType: 'Educational Certificate',
        examinationName: '',
        rollNumber: '',
        registrationNumber: '',
        certificateNumber: '',
        boardName: 'Dhaka',
        country: 'Bangladesh',
        issueDate: new Date().toISOString().split('T')[0],
        officerName: 'Md. Siddiqur Rahman',
        officerDesignation: 'Assistant Secretary',
        signatureImageUrl: settings.globalSignatureUrl,
        sealImageUrl: settings.globalSealUrl,
        qrCodeDataUrl: '',
        attachedCertificates: [],
        fullyAttestedDocumentUrl: ''
      });
    };

    try {
      const url = editingId ? `/api/certificates/${encodeURIComponent(editingId)}` : '/api/certificates';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(finalCert)
      });

      const responseText = await res.text();
      let data: any = null;
      if (responseText && responseText.trim().startsWith('{')) {
        try { data = JSON.parse(responseText); } catch (e) { data = null; }
      }

      if (res.ok && data && data.success) {
        const savedCert = data.certificate || finalCert;
        await updateStorageAndCloud(savedCert);
        showStatus('success', editingId ? '✓ Revised and saved certificate parameters successfully!' : '✓ Registered e-Apostille successfully!');
        setGeneratedProfile(savedCert);
        resetCertForm();
        fetchRecords();
        setSubmitting(false);
        return;
      } else if (res.status === 409) {
        showStatus('error', (data && data.message) ? data.message : `Certificate ID "${verificationId}" already exists.`);
        setSubmitting(false);
        return;
      }
    } catch (err: any) {
      console.warn('Backend API connection unavailable, defaulting to direct cloud storage save:', err);
    }

    // Direct permanent cloud save fallback
    await updateStorageAndCloud(finalCert);
    showStatus('success', editingId ? '✓ Revised and saved certificate parameters successfully!' : '✓ Registered e-Apostille successfully!');
    setGeneratedProfile(finalCert);
    resetCertForm();
    fetchRecords();
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(`Are you sure you want to delete e-Apostille Profile "${id}"? This action is permanent.`)) {
      return;
    }

    try {
      localStorage.setItem('MoFA_Certificates', JSON.stringify(
        certificates.filter(c => c.id.toUpperCase() !== id.trim().toUpperCase())
      ));
      const res = await fetch(`/api/certificates/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        showStatus('success', 'e-Apostille deleted successfully.');
      }
    } catch (e) {
      showStatus('success', 'e-Apostille removed from browser storage.');
    } finally {
      fetchRecords();
    }
  };

  const handleUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        showStatus('success', 'System settings updated successfully!');
      } else {
        showStatus('error', 'Configuration save failure.');
      }
    } catch (e) {
      showStatus('error', 'Network failure updating settings.');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/settings/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(passwordForm)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showStatus('success', 'Admin Password changed successfully!');
        setPasswordForm({ oldPassword: '', newPassword: '' });
      } else {
        showStatus('error', data.message || 'Incorrect old password.');
      }
    } catch (e) {
      showStatus('error', 'Network issue changing password.');
    }
  };

  const copyVerificationLink = (id: string) => {
    const url = `${getBaseVerificationUrl()}/verify/${id}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in font-sans">
      
      {/* Header controls */}
      <div className="border-b border-gray-200 pb-5 mb-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-black text-gray-950 tracking-tight flex items-center gap-2">
              <ShieldCheck className="w-7 h-7 text-[#006a4e]" />
              অনলাইন সত্যায়ন ও ভেরিফিকেশন কনসোল
            </h2>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black tracking-wider uppercase bg-emerald-100 text-[#006a4e] border border-emerald-300 shadow-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Cloud Life: ALWAYS ON
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">ক্যান্ডিডেটের সত্যায়িত সার্টিফিকেটের রেকর্ডসমূহ এবং পাবলিক ডেটা ট্র্যাকিং ম্যানেজমেন্ট সিস্টেম।</p>
        </div>

        {/* Status Messages */}
        {statusMsg.text && (
          <div className={`px-4 py-2 text-xs font-bold rounded-xl shadow border transition-all ${
            statusMsg.type === 'success' 
              ? 'bg-emerald-50 border-emerald-200 text-[#006a4e]' 
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            {statusMsg.text}
          </div>
        )}

        {/* Tab Selection */}
        <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200 w-full md:w-auto flex-wrap gap-1">
          <button
            onClick={() => { setActiveTab('records'); setGeneratedProfile(null); }}
            className={`flex-1 md:flex-none uppercase text-[10px] tracking-wider font-bold px-3.5 py-2.5 rounded-lg transition-all ${
              activeTab === 'records' 
                ? 'bg-white text-[#006a4e] shadow-sm' 
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <span className="flex items-center gap-1.5 justify-center">
              <Database className="w-3.5 h-3.5" />
              সকল রেকর্ড (Ledger)
            </span>
          </button>
          
          <button
            onClick={() => { setActiveTab('create'); setGeneratedProfile(null); }}
            className={`flex-1 md:flex-none uppercase text-[10px] tracking-wider font-bold px-3.5 py-2.5 rounded-lg transition-all ${
              activeTab === 'create' 
                ? 'bg-white text-[#006a4e] shadow-sm' 
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <span className="flex items-center gap-1.5 justify-center">
              <FilePlus2 className="w-3.5 h-3.5" />
              নতুন সত্যায়ন তৈরি (Create)
            </span>
          </button>

          <button
            onClick={() => { setActiveTab('view-as'); setGeneratedProfile(null); }}
            className={`flex-1 md:flex-none uppercase text-[10px] tracking-wider font-bold px-3.5 py-2.5 rounded-lg transition-all ${
              activeTab === 'view-as' 
                ? 'bg-white text-[#006a4e] shadow-sm' 
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <span className="flex items-center gap-1.5 justify-center">
              <Eye className="w-3.5 h-3.5" />
              ভিউ অ্যাজ (View As)
            </span>
          </button>

          <button
            onClick={() => { setActiveTab('search'); setGeneratedProfile(null); }}
            className={`flex-1 md:flex-none uppercase text-[10px] tracking-wider font-bold px-3.5 py-2.5 rounded-lg transition-all ${
              activeTab === 'search' 
                ? 'bg-white text-[#006a4e] shadow-sm' 
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <span className="flex items-center gap-1.5 justify-center">
              <Search className="w-3.5 h-3.5" />
              ট্র্যাকিং আইডি সার্চ (Verify Check)
            </span>
          </button>

          <button
            onClick={() => { setActiveTab('settings'); setGeneratedProfile(null); }}
            className={`flex-1 md:flex-none uppercase text-[10px] tracking-wider font-bold px-3.5 py-2.5 rounded-lg transition-all ${
              activeTab === 'settings' 
                ? 'bg-white text-[#006a4e] shadow-sm' 
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <span className="flex items-center gap-1.5 justify-center">
              <Settings className="w-3.5 h-3.5" />
              সিস্টেম সেটিংস (Settings)
            </span>
          </button>
        </div>
      </div>

      {/* DELIVERABLE SUCCESS & DETAILED QR DOWNLOAD PAGE */}
      {generatedProfile && (
        <div className="max-w-2xl mx-auto bg-white border border-emerald-200 rounded-3xl p-8 shadow-xl text-center space-y-6 animate-fade-in my-4">
          <div className="w-16 h-16 bg-emerald-100 border border-emerald-200 text-[#006a4e] rounded-full flex items-center justify-center mx-auto shadow-inner">
            <CheckCircle className="w-10 h-10" />
          </div>
          
          <div>
            <h3 className="text-xl font-extrabold text-emerald-950">অনলাইন সত্যায়িত সম্পন্ন এবং কিউআর কোড জেনারেট হয়েছে!</h3>
            <p className="text-xs text-gray-500 mt-1 font-bold uppercase tracking-wide">Online Attestation Complete & Unique QR Code Generated</p>
          </div>

          {/* Record Summary Box */}
          <div className="bg-slate-50 rounded-2xl p-6 border border-gray-200 space-y-4 text-left">
            <div className="flex flex-col items-center justify-center space-y-1 text-center pb-3 border-b border-gray-200">
              <span className="text-[10px] text-gray-400 font-bold block uppercase">UNIQUE SECURITY TRACKING ID</span>
              <span className="text-xl font-mono font-black text-emerald-800 tracking-wider bg-emerald-50 px-5 py-1.5 rounded-full border border-emerald-200 inline-block uppercase shadow-sm">
                {generatedProfile.id}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
              <div>
                <span className="text-gray-400 font-bold block">ক্যান্ডিডেটের নাম:</span>
                <span className="font-black text-gray-900">{generatedProfile.applicantName}</span>
              </div>
              <div>
                <span className="text-gray-400 font-bold block">প্রদানের তারিখ:</span>
                <span className="font-bold text-gray-800 font-mono">{generatedProfile.issueDate}</span>
              </div>
              <div>
                <span className="text-gray-400 font-bold block">সত্যায়ন কর্মকর্তা:</span>
                <span className="font-bold text-gray-800">{generatedProfile.officerName} ({generatedProfile.officerDesignation})</span>
              </div>
              <div>
                <span className="text-gray-400 font-bold block">সংযুক্ত সনদপত্র:</span>
                <span className="font-bold text-emerald-700">{generatedProfile.attachedCertificates?.length || 0} টি ফাইল</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => {
                const target = generatedProfile;
                setGeneratedProfile(null);
                handleLoadViewAs(target.id, target);
                setActiveTab('view-as');
              }}
              className="flex-1 bg-[#0f2c59] hover:bg-[#0b2144] text-white font-extrabold text-xs uppercase tracking-wider py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-md transition"
            >
              <Eye className="w-4 h-4" />
              ভিউ অ্যাজ (View As) চেক করুন
            </button>

            <button
              onClick={() => downloadCertificateImmediate(generatedProfile)}
              className="flex-1 bg-[#006a4e] hover:bg-[#004e39] text-white font-extrabold text-xs uppercase tracking-wider py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-md transition"
            >
              <FileDown className="w-4 h-4" />
              রিপোর্ট PDF ডাউনলোড
            </button>

            <button
              onClick={() => {
                setEditingId(generatedProfile.id);
                setCertForm(generatedProfile);
                setGeneratedProfile(null);
                setActiveTab('create');
              }}
              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs uppercase tracking-wider py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-md transition"
            >
              <Edit className="w-4 h-4" />
              রেকর্ড সম্পাদনা করুন
            </button>
          </div>

          <div className="pt-2">
            <button
              onClick={() => { setGeneratedProfile(null); setActiveTab('records'); }}
              className="text-[#006a4e] hover:text-[#004e39] font-black text-xs uppercase tracking-wider underline flex items-center gap-1 mx-auto transition cursor-pointer"
            >
              সকল রেকর্ড তালিকায় ফিরে যান (View All Records)
            </button>
          </div>

          <div className="mt-8 border-t border-emerald-100 pt-6 text-left">
            <h4 className="text-xs font-black text-gray-500 uppercase tracking-wider mb-3 text-center">
              A4 APOSTILLE MAIN BOARD DOCUMENT PREVIEW (WITH QR CODE)
            </h4>
            <ApostilleMainBoard 
              certificate={generatedProfile} 
              baseDomain={getBaseVerificationUrl()} 
              readOnly={true} 
            />
          </div>
        </div>
      )}

      {/* 1. RECORDS DIRECTORY VIEW */}
      {!generatedProfile && activeTab === 'records' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-stretch sm:items-center bg-white p-4 border border-gray-200 rounded-2xl shadow-sm">
            <div className="relative flex-1 max-w-sm">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                placeholder="নাম বা আইডি দিয়ে খুঁজুন (Search ID, Applicant, Board...)"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 text-xs rounded-xl border border-gray-200 focus:border-[#006a4e] outline-none font-semibold text-gray-800"
              />
            </div>
            
            <div className="text-xs font-black text-gray-500 flex items-center gap-1.5 pl-1">
              মোট সত্যায়িত প্রোফাইল: <span className="bg-[#006a4e]/10 text-[#006a4e] px-2.5 py-1 rounded-full">{certificates.length}</span>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            {loading ? (
              <div className="py-20 text-center flex flex-col items-center justify-center text-gray-500">
                <RefreshCw className="w-8 h-8 animate-spin text-[#006a4e] mb-2" />
                <span className="text-xs font-bold">সার্ভার লেজার স্ক্যান করা হচ্ছে...</span>
              </div>
            ) : certificates.length === 0 ? (
              <div className="py-20 text-center text-gray-400 text-xs font-bold">
                কোনো রেকর্ড খুঁজে পাওয়া যায়নি।
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#f8fafc] text-gray-650 font-black border-b border-gray-150 uppercase tracking-wider text-[9px]">
                    <tr>
                      <th className="p-4">ট্র্যাকিং আইডি</th>
                      <th className="p-4">ক্যান্ডিডেটের নাম ও বিবরণ</th>
                      <th className="p-4">সার্টিফিকেটের ধরণ</th>
                      <th className="p-4">দেশের নাম</th>
                      <th className="p-4">ইস্যুর তারিখ</th>
                      <th className="p-4">সংযুক্ত পেজ</th>
                      <th className="p-4 text-right">ম্যানেজমেন্ট অপশন</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
                    {certificates.map((cert) => (
                      <tr key={cert.id} className="hover:bg-gray-50/50">
                        <td className="p-4 font-mono font-bold text-[#006a4e]">{cert.id}</td>
                        <td className="p-4">
                          <div>
                            <span className="block font-black text-gray-950 text-xs">{cert.applicantName}</span>
                            {cert.fatherName && <span className="block text-[10px] text-gray-400">পিতা: {cert.fatherName}</span>}
                          </div>
                        </td>
                        <td className="p-4">
                          <div>
                            <span className="text-[10px] bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded font-black">{cert.certificateType}</span>
                            {cert.boardName && <span className="block text-[10px] text-gray-400 mt-0.5">{cert.boardName}</span>}
                          </div>
                        </td>
                        <td className="p-4 font-bold">{cert.country}</td>
                        <td className="p-4 font-mono text-gray-500">{cert.issueDate}</td>
                        <td className="p-4">
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full font-bold">
                              {cert.attachedCertificates?.length || 0} Pages (ফাইল)
                            </span>
                            <span className="text-[9.5px] px-2 py-0.5 bg-emerald-50 text-emerald-800 rounded-full font-bold border border-emerald-200">
                              ✓ QR কানেক্টেড
                            </span>
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2.5">
                            <button
                              onClick={() => {
                                handleLoadViewAs(cert.id, cert);
                                setActiveTab('view-as');
                              }}
                              title="View As Public Verification"
                              className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-[#0f2c59] text-[10px] font-black border border-blue-200 rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                            >
                              <Eye className="w-3 h-3 text-blue-700" />
                              <span>ভিউ অ্যাজ</span>
                            </button>

                            <button
                              onClick={() => downloadCertificateImmediate(cert)}
                              title="Download PDF Report"
                              className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-[#006a4e] text-[10px] font-black border border-emerald-250 rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                            >
                              <FileDown className="w-3 h-3" />
                              <span>রিপোর্ট PDF</span>
                            </button>
                            
                            <button
                              onClick={() => {
                                setEditingId(cert.id);
                                setCertForm(cert);
                                setActiveTab('create');
                              }}
                              title="Edit record"
                              className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[10.5px] font-black rounded-lg flex items-center gap-1 cursor-pointer transition-all"
                            >
                              <Edit className="w-3 h-3 text-amber-700" />
                              <span>সম্পাদনা</span>
                            </button>

                            <button
                              onClick={() => handleDelete(cert.id)}
                              title="Revoke profile"
                              className="p-1.5 text-red-650 hover:bg-red-50 hover:text-red-800 rounded-lg transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. REGISTER NEW E-APOSTILLE VIEW */}
      {!generatedProfile && activeTab === 'create' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Create Form Panel */}
          <form onSubmit={handleCreateSubmit} className="lg:col-span-7 bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-6">
            
            {editingId && (
              <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl flex items-center justify-between text-xs text-amber-800 font-bold mb-2">
                <span>⚠️ সম্পাদনা মোড (Editing e-Apostille): <span className="font-mono text-amber-950 px-2 py-0.5 bg-amber-100 rounded border border-amber-200">{editingId}</span></span>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setCertForm({
                      id: '',
                      applicantName: '',
                      fatherName: '',
                      motherName: '',
                      dob: '',
                      certificateType: 'Educational Certificate',
                      examinationName: '',
                      rollNumber: '',
                      registrationNumber: '',
                      certificateNumber: '',
                      boardName: 'Dhaka',
                      country: 'Bangladesh',
                      issueDate: new Date().toISOString().split('T')[0],
                      officerName: 'Md. Siddiqur Rahman',
                      officerDesignation: 'Assistant Secretary',
                      signatureImageUrl: settings.globalSignatureUrl,
                      sealImageUrl: settings.globalSealUrl,
                      attachedCertificates: [],
                      fullyAttestedDocumentUrl: ''
                    });
                  }}
                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-lg transition text-[10px] cursor-pointer"
                >
                  ক্লিয়ার করুন বা নতুন তৈরি করুন
                </button>
              </div>
            )}

            <div className="border-b pb-3">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <FilePlus2 className="w-4.5 h-4.5 text-[#006a4e]" />
                {editingId ? 'সংশোধন ও সত্যায়ন বিবরণ সংরক্ষণ করুন' : 'নতুন অনলাইন সত্যায়ন রেজিস্ট্রেশন করুন'}
              </h3>
            </div>

            {/* FORM MULTI-SECTION STEPPER */}
            <div className="space-y-6">
              
              {/* SECTION A: ID & FILE */}
              <div className="bg-slate-50 p-5 rounded-2xl border border-gray-200 space-y-4">
                <h4 className="text-[11px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-800 text-[9px] font-black flex items-center justify-center">১</span>
                  বেসিক ট্র্যাকিং কোড ও প্রদানের তারিখ (Base Setup)
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[10px] font-bold text-gray-500">ভেরিফিকেশন ট্র্যাকিং আইডি * (Date-Based Unique Tracking ID)</label>
                      <button
                        type="button"
                        onClick={() => setCertForm(prev => ({ ...prev, id: generateRandomTrackingId(prev.issueDate) }))}
                        className="text-[10px] font-bold text-[#006a4e] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Sparkles className="w-3 h-3" />
                        নতুন র্যান্ডম আইডি জেনারেট
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="e.g. BD-AP-20260811-894102"
                      value={certForm.id || ''}
                      onChange={(e) => setCertForm(prev => ({ ...prev, id: e.target.value.toUpperCase() }))}
                      className="w-full px-3 py-2 text-xs border border-gray-200 bg-white rounded-xl outline-none font-mono focus:border-[#006a4e] font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1">সত্যায়নের তারিখ (Sign Date) *</label>
                    <input
                      type="date"
                      required
                      value={certForm.issueDate || ''}
                      onChange={(e) => {
                        const newDate = e.target.value;
                        setCertForm(prev => ({
                          ...prev,
                          issueDate: newDate,
                          id: editingId ? prev.id : generateRandomTrackingId(newDate)
                        }));
                      }}
                      className="w-full px-3 py-2 text-xs border border-gray-200 bg-white rounded-xl outline-none focus:border-[#006a4e] font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1">১. দেশের নাম (Country) *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Bangladesh"
                      value={certForm.country || 'Bangladesh'}
                      onChange={(e) => setCertForm(prev => ({ ...prev, country: e.target.value }))}
                      className="w-full px-3 py-2 text-xs border border-gray-200 bg-white rounded-xl outline-none focus:border-[#006a4e] font-bold text-slate-800"
                    />
                  </div>
                </div>
              </div>

              {/* SECTION B: WET STAMP MANUAL DETAILS */}
              <div className="bg-slate-50 p-5 rounded-2xl border border-gray-200 space-y-4">
                <h4 className="text-[11px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-800 text-[9px] font-black flex items-center justify-center">২</span>
                  সীলমোহরের ম্যানুয়াল বিবরণী (Wet Stamp details)
                </h4>

                <div className="space-y-3.5">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1">ক্যান্ডিডেটের নাম (Candidate Name) [ইংরেজিতে]*</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. MOHAMMAD ABDUL WAZED"
                      value={certForm.applicantName || ''}
                      onChange={(e) => setCertForm(prev => ({ ...prev, applicantName: e.target.value.toUpperCase() }))}
                      className="w-full px-3 py-2 text-xs border border-gray-200 bg-white rounded-xl outline-none focus:border-[#006a4e] font-black text-slate-800"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1">পিতার নাম / অভিভাবক *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. MD. GAFUR MIA"
                        value={certForm.fatherName || ''}
                        onChange={(e) => setCertForm(prev => ({ ...prev, fatherName: e.target.value.toUpperCase() }))}
                        className="w-full px-3 py-2 text-xs border border-gray-200 bg-white rounded-xl outline-none focus:border-[#006a4e] font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1">মাতার नाम *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. MST. LILY BEGUM"
                        value={certForm.motherName || ''}
                        onChange={(e) => setCertForm(prev => ({ ...prev, motherName: e.target.value.toUpperCase() }))}
                        className="w-full px-3 py-2 text-xs border border-gray-200 bg-white rounded-xl outline-none focus:border-[#006a4e] font-bold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1">স্বাক্ষরকারী কর্মকর্তার নাম (Officer Name) *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Md. Siddiqur Rahman"
                        value={certForm.officerName || ''}
                        onChange={(e) => setCertForm(prev => ({ ...prev, officerName: e.target.value }))}
                        className="w-full px-3 py-2 text-xs border border-gray-200 bg-white rounded-xl outline-none focus:border-[#006a4e] font-bold"
                      />
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        <button
                          type="button"
                          onClick={() => setCertForm(prev => ({ ...prev, officerName: 'Md. Siddiqur Rahman', officerDesignation: 'Assistant Secretary' }))}
                          className="text-[8.5px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 cursor-pointer"
                        >
                          Md. Siddiqur Rahman
                        </button>
                        <button
                          type="button"
                          onClick={() => setCertForm(prev => ({ ...prev, officerName: 'Afrin Haque', officerDesignation: 'Senior Assistant Secretary' }))}
                          className="text-[8.5px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 cursor-pointer"
                        >
                          Afrin Haque
                        </button>
                        <button
                          type="button"
                          onClick={() => setCertForm(prev => ({ ...prev, officerName: 'Md. Shemul Ahmmed', officerDesignation: 'Consular Assistant' }))}
                          className="text-[8.5px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 cursor-pointer"
                        >
                          Md. Shemul Ahmmed
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1">কর্মকর্তার পদবী (Official capacity) *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Assistant Secretary"
                        value={certForm.officerDesignation || ''}
                        onChange={(e) => setCertForm(prev => ({ ...prev, officerDesignation: e.target.value }))}
                        className="w-full px-3 py-2 text-xs border border-gray-200 bg-white rounded-xl outline-none focus:border-[#006a4e] font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1">শিক্ষা প্রতিষ্ঠান / সংস্থাপনের নাম (Institution/Board) *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Board of Intermediate and Secondary Education, Dhaka"
                        value={certForm.boardName || ''}
                        onChange={(e) => setCertForm(prev => ({ ...prev, boardName: e.target.value }))}
                        className="w-full px-3 py-2 text-xs border border-gray-200 bg-white rounded-xl outline-none focus:border-[#006a4e] font-bold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-gray-100">
                    <div>
                      <label className="block text-[10px] font-black text-[#006a4e] mb-1">৯. সীলমোহর ইমেজ আপলোড (Seal/Stamp PNG)</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleImageUpload(e, 'sealImageUrl')}
                        className="w-full text-xs text-gray-500 bg-white border border-gray-150 rounded-lg p-0.5"
                      />
                      {certForm.sealImageUrl && (
                        <div className="h-12 w-12 bg-slate-50 border p-0.5 mt-1.5 rounded flex items-center justify-center">
                          <img src={certForm.sealImageUrl} alt="Seal preview" className="h-full object-contain" />
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-[#006a4e] mb-1">১০. কর্মকর্তার স্বাক্ষর ইমেজ আপলোড (Officer Signature PNG)</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleImageUpload(e, 'signatureImageUrl')}
                        className="w-full text-xs text-gray-500 bg-white border border-gray-150 rounded-lg p-0.5"
                      />
                      {certForm.signatureImageUrl && (
                        <div className="h-8 max-w-[120px] bg-slate-50 border p-0.5 mt-1.5 rounded flex items-center justify-center">
                          <img src={certForm.signatureImageUrl} alt="Signature preview" className="h-full object-contain" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Auto vs Manual QR Code Section */}
                  <div className="pt-4 border-t border-gray-100 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10.5px] font-black text-[#006a4e] uppercase tracking-wider flex items-center gap-1.5">
                        <QrCode className="w-4 h-4 text-[#006a4e]" />
                        ১১. ভেরিফিকেশন QR কোড ও লিংক কনফিগারেশন (QR Code Settings)
                      </label>
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                        certForm.qrCodeDataUrl 
                          ? 'bg-purple-100 text-purple-900 border border-purple-200' 
                          : certForm.manualQrUrl?.trim() 
                            ? 'bg-amber-100 text-amber-900 border border-amber-200' 
                            : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {certForm.qrCodeDataUrl ? '✓ কাস্টম আপলোডকৃত QR ইমেজ সক্রিয়' : (certForm.manualQrUrl?.trim() ? 'কাস্টম ম্যানুয়াল লিংক সক্রিয়' : 'অটো লিংক সক্রিয়')}
                      </span>
                    </div>

                    <div className="p-3.5 bg-slate-50 border border-gray-200 rounded-xl space-y-4">
                      {/* 1. Custom QR Code Image Upload Option (বাইরে থেকে তৈরি QR কোড ইমেজ আপলোড) */}
                      <div className="bg-white p-3 rounded-xl border border-gray-200/80 shadow-xs space-y-2.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-black text-slate-800 flex items-center gap-1.5">
                            <Upload className="w-3.5 h-3.5 text-[#006a4e]" />
                            কাস্টম QR কোড ইমেজ আপলোড (Upload Custom QR Code Image - PNG/JPG/SVG)
                          </label>
                          {certForm.qrCodeDataUrl && (
                            <span className="text-[9px] font-black px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md">
                              ইমেজ কার্যকর আছে
                            </span>
                          )}
                        </div>

                        <p className="text-[9.5px] text-gray-500 leading-relaxed">
                          💡 অটো জেনারেটেড QR কোডে কোনো সমস্যা হলে বাইরে (যেকোনো পাবলিক QR কনভার্টার) থেকে তৈরি করা QR কোডের ছবি এখানে আপলোড করুন। আপলোড করলে সনদের কিউআর বক্সে সরাসরি এই ইমেজটি প্রিন্ট হবে।
                        </p>

                        {!certForm.qrCodeDataUrl ? (
                          <div className="relative border-2 border-dashed border-emerald-300 hover:border-[#006a4e] bg-emerald-50/30 hover:bg-emerald-50/60 transition-all rounded-xl p-3.5 text-center cursor-pointer group">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleQrImageUpload}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                            <div className="flex flex-col items-center justify-center gap-1.5">
                              <div className="w-8 h-8 rounded-full bg-emerald-100 text-[#006a4e] flex items-center justify-center group-hover:scale-110 transition-transform">
                                <Upload className="w-4 h-4" />
                              </div>
                              <span className="text-xs font-bold text-[#006a4e]">
                                ক্লিক করে QR কোড ইমেজ ফাইল নির্বাচন করুন
                              </span>
                              <span className="text-[9px] text-gray-400">
                                PNG, JPG, JPEG, SVG বা WebP ফাইল সমর্থনযোগ্য
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3 flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="w-16 h-16 bg-white p-1 rounded-lg border border-emerald-300 shadow-xs flex-shrink-0 flex items-center justify-center">
                                <img
                                  src={certForm.qrCodeDataUrl}
                                  alt="Custom QR Preview"
                                  className="w-full h-full object-contain"
                                />
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5">
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                                  <span className="text-xs font-black text-emerald-900">
                                    কাস্টম QR ইমেজ সফলভাবে যুক্ত হয়েছে
                                  </span>
                                </div>
                                <p className="text-[10px] text-emerald-800">
                                  সনদ ও প্রিন্ট প্রিভিউতে আপনার এই আপলোডকৃত QR কোডটি সরাসরি প্রতিস্থাপিত হয়েছে।
                                </p>
                                {uploadedQrDecodedInfo && (
                                  <div className="text-[9.5px] font-mono text-slate-700 bg-white/80 px-2 py-0.5 rounded border border-emerald-200 truncate max-w-md">
                                    <span className="font-bold text-emerald-800">স্ক্যানকৃত লিংক/ডেটা:</span> {uploadedQrDecodedInfo}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col gap-1.5 flex-shrink-0">
                              <label className="px-2.5 py-1 text-[10px] font-bold bg-white text-emerald-800 border border-emerald-300 hover:bg-emerald-100 rounded-lg cursor-pointer text-center">
                                পরিবর্তন করুন
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={handleQrImageUpload}
                                  className="hidden"
                                />
                              </label>
                              <button
                                type="button"
                                onClick={removeUploadedQrImage}
                                className="px-2.5 py-1 text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 rounded-lg cursor-pointer flex items-center gap-1 justify-center"
                              >
                                <X className="w-3 h-3" />
                                <span>রিমুভ করুন</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 2. Manual URL Override */}
                      <div>
                        <label className="block text-[9.5px] font-bold text-gray-600 uppercase mb-1">
                          ম্যানুয়াল QR কোড ভেরিফিকেশন লিংক (Manual QR Link Override - ঐচ্ছিক):
                        </label>
                        <input
                          type="url"
                          placeholder="e.g. https://e-apostile-mygov-bangladesh.vercel.app/verify/BD-AP-20260910-786784"
                          value={certForm.manualQrUrl || ''}
                          onChange={(e) => setCertForm(prev => ({ ...prev, manualQrUrl: e.target.value }))}
                          className="w-full px-3 py-2 text-xs border border-gray-200 bg-white rounded-lg focus:border-[#006a4e] outline-none font-mono text-slate-800"
                        />
                        <p className="text-[9.5px] text-gray-500 mt-1">
                          💡 অটো QR কোড কাজ না করলে অথবা কাস্টম কোনো ডোমেইন/লিংক এনকোড করতে চাইলে উপরে লিংক দিন। ফাঁকা রাখলে সরাসরি লিঙ্ক <code>{getBaseVerificationUrl()}/verify/{certForm.id || 'TRACKING-ID'}</code> ব্যবহার হবে। {certForm.qrCodeDataUrl && <strong className="text-purple-800">(বর্তমানে কাস্টম আপলোডকৃত ইমেজ অগ্রাধিকার পাচ্ছে)</strong>}
                        </p>
                      </div>

                      {/* 3. Live Preview of Active QR Code */}
                      <div className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-gray-200 text-xs gap-3">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-700">
                              অ্যাক্টিভ QR কোড অবস্থা:
                            </span>
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded ${
                              certForm.qrCodeDataUrl 
                                ? 'bg-purple-100 text-purple-900' 
                                : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {certForm.qrCodeDataUrl ? 'কাস্টম ইমেজ ব্যবহৃত হচ্ছে' : 'সিস্টেম জেনারেটেড কিউআর'}
                            </span>
                          </div>
                          <div className="truncate text-[10px] font-mono text-slate-600">
                            <span className="font-bold text-slate-800">টার্গেট লিংক:</span>{' '}
                            {certForm.manualQrUrl?.trim() || `${getBaseVerificationUrl()}/verify/${certForm.id || 'TRACKING-ID'}`}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="w-11 h-11 border border-gray-300 rounded bg-white p-0.5 shadow-2xs flex items-center justify-center">
                            <img
                              src={certForm.qrCodeDataUrl || livePreviewQr || ''}
                              alt="Active QR"
                              className="w-full h-full object-contain"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION C: DYNAMIC MULTI-CERTIFICATE ACCORDION (এক এক করে ৫-১০টি বা ততোধিক সার্টিফিকেট যোগ করার অপশন) */}
              <div className="bg-[#006a4e]/5 p-5 rounded-2xl border border-[#006a4e]/10 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="text-[11.5px] font-black text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-[#006a4e] text-white text-[10px] font-black flex items-center justify-center">৩</span>
                    সংযুক্ত ক্যান্ডিডেট সার্টিফিকেটসমূহ ({certForm.attachedCertificates?.length || 0}টি ডকুমেন্ট যুক্ত আছে)
                  </h4>
                  
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => addAttachedCertificate('Honours Certificate')}
                      className="px-2 py-1 bg-white text-emerald-800 text-[9.5px] font-bold rounded-lg border border-emerald-300 hover:bg-emerald-50 cursor-pointer"
                    >
                      + Honours
                    </button>
                    <button
                      type="button"
                      onClick={() => addAttachedCertificate('Secondary School Certificate')}
                      className="px-2 py-1 bg-white text-emerald-800 text-[9.5px] font-bold rounded-lg border border-emerald-300 hover:bg-emerald-50 cursor-pointer"
                    >
                      + SSC
                    </button>
                    <button
                      type="button"
                      onClick={() => addAttachedCertificate('Higher Secondary Certificate')}
                      className="px-2 py-1 bg-white text-emerald-800 text-[9.5px] font-bold rounded-lg border border-emerald-300 hover:bg-emerald-50 cursor-pointer"
                    >
                      + HSC
                    </button>
                    <button
                      type="button"
                      onClick={() => addAttachedCertificate('Passport')}
                      className="px-2 py-1 bg-white text-emerald-800 text-[9.5px] font-bold rounded-lg border border-emerald-300 hover:bg-emerald-50 cursor-pointer"
                    >
                      + Passport
                    </button>
                    <button
                      type="button"
                      onClick={() => addAttachedCertificate()}
                      className="px-3 py-1.5 bg-[#006a4e] text-white text-[10.5px] font-extrabold rounded-xl hover:bg-[#004e39] transition-all cursor-pointer shadow-sm flex items-center gap-1 border border-emerald-600 active:scale-95"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      ডকুমেন্ট যোগ করুন
                    </button>
                  </div>
                </div>

                {(!certForm.attachedCertificates || certForm.attachedCertificates.length === 0) ? (
                  <div className="text-center py-10 border border-dashed border-gray-200 bg-white rounded-2xl text-[11px] text-gray-400 font-bold space-y-2">
                    <ImageIcon className="w-8 h-8 text-slate-350 mx-auto animate-pulse" />
                    <p>কোনো মূল সার্টিফিকেট ফাইল এখনও সংযুক্ত করা হয়নি (৫-১০টি পর্যন্ত যেকোনো ডকুমেন্ট যোগ করতে পারেন)।</p>
                    <button
                      type="button"
                      onClick={() => addAttachedCertificate()}
                      className="text-[#006a4e] hover:underline font-extrabold text-[11px] block mx-auto pt-1 cursor-pointer"
                    >
                      💡 ক্লিক করে প্রথম সার্টিফিকেট যোগ করুন
                    </button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {certForm.attachedCertificates.map((certItem, certIndex) => (
                      <div key={certItem.id || certIndex} className="bg-white p-4.5 border border-gray-200 rounded-2xl relative space-y-4 shadow-sm">
                        
                        <button
                          type="button"
                          onClick={() => removeAttachedCertificate(certIndex)}
                          className="absolute top-3 right-3 text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                          title="সার্টিফিকেট ও সত্যায়ন মুছুন"
                        >
                          <Trash className="w-4 h-4" />
                        </button>

                        <div className="text-[11.5px] font-black text-emerald-800 uppercase tracking-widest flex items-center gap-2">
                          <span className="px-2.5 py-0.5 bg-emerald-100 rounded-full text-[10px] font-extrabold">ফাইল #{certIndex + 1}</span>
                          <span className="font-mono text-slate-400 text-[10.5px]">ID: {certItem.id}</span>
                        </div>

                        {/* File details input row */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                          <div>
                            <label className="block text-[9.5px] font-bold text-gray-500 uppercase">১. ডকুমেন্টের ধরণ (Document Type) *</label>
                            <select
                              value={certItem.documentType || (DOCUMENT_OPTIONS.includes(certItem.id) ? certItem.id : 'Other')}
                              onChange={(e) => updateCertificateDocType(certIndex, e.target.value)}
                              className="w-full px-3 py-2 text-xs border border-gray-200 bg-[#f8fafc] rounded-lg focus:border-[#006a4e] outline-none font-bold text-slate-800"
                            >
                              <option value="Honours Certificate">Honours Certificate</option>
                              <option value="Secondary School Certificate">Secondary School Certificate (SSC)</option>
                              <option value="Higher Secondary Certificate">Higher Secondary Certificate (HSC)</option>
                              <option value="Passport">Passport</option>
                              <option value="Other">Other / কাস্টম ডকুমেন্টের নাম</option>
                            </select>

                            {(!certItem.documentType || certItem.documentType === 'Other') && (
                              <input
                                type="text"
                                required
                                placeholder="কাস্টম ডকুমেন্টের নাম লিখুন (e.g. Master's Degree / Birth Certificate)"
                                value={certItem.id || ''}
                                onChange={(e) => updateCertificateName(certIndex, e.target.value)}
                                className="mt-2 w-full px-3 py-1.5 text-xs border border-gray-200 bg-white rounded-lg focus:border-[#006a4e] outline-none font-semibold text-slate-800"
                              />
                            )}
                          </div>

                          <div>
                            <label className="block text-[9.5px] font-bold text-gray-500 uppercase">২. সার্টিফিকেটের স্ক্যান কপি আপলোড *</label>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const compressed = await compressImage(file, 800, 0.65);
                                if (compressed) {
                                  updateAttachedCertificateImage(certIndex, compressed);
                                }
                              }}
                              className="w-full text-xs text-gray-500 bg-white border border-gray-150 rounded-lg p-0.5"
                            />
                            <span className="text-[9px] text-gray-400 mt-1 block">💡 ইমেজ স্বয়ংক্রিয়ভাবে অপটিমাইজ হবে (৫-১০টি ডকুমেন্ট অনায়াসে যোগ করা যাবে)।</span>
                          </div>
                        </div>

                        {/* Scanned Copy image view container */}
                        {certItem.certificateImageUrl && (
                          <div className="h-32 w-full max-w-sm rounded-xl overflow-hidden bg-slate-50 border border-gray-200 mx-auto flex items-center justify-center p-2 relative shadow-inner">
                            <img 
                              src={certItem.certificateImageUrl} 
                              alt="Scan Certificate Preview" 
                              className="h-full object-contain"
                              referrerPolicy="no-referrer"
                            />
                            <button
                              type="button"
                              onClick={() => updateAttachedCertificateImage(certIndex, '')}
                              className="absolute top-1 right-1 bg-black/80 text-white p-1 rounded-full text-[9px] hover:bg-black font-bold"
                            >
                              ✕
                            </button>
                          </div>
                        )}

                        {/* NESTED ATTESTER SIGNATURES BLOCKS (কর্মকর্তাদের সত্যায়ন তালিকা) */}
                        <div className="border-t border-gray-100 pt-3 space-y-3.5">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <span className="text-[10px] font-black text-purple-800 uppercase tracking-wider bg-purple-50 px-2.5 py-0.5 rounded border border-purple-200">
                              ✍️ এই সার্টিফিকেটের সত্যায়নকারী কর্মকর্তাদের তথ্য (Attestation Signatures Log)
                            </span>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={() => resetCertificateAttestationsToDefault(certIndex)}
                                title="অফিসিয়াল ডিফল্ট কর্মকর্তা লোড করুন"
                                className="text-[9.5px] font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-lg border border-gray-200 flex items-center gap-1 cursor-pointer transition"
                              >
                                🔄 ডিফল্ট কর্মকর্তা লোড
                              </button>
                              <button
                                type="button"
                                onClick={() => addAttestationToCertificate(certIndex)}
                                className="text-[9.5px] font-black text-purple-700 bg-purple-50 hover:bg-purple-100 px-2.5 py-1 rounded-lg border border-purple-200 flex items-center gap-0.5 cursor-pointer active:scale-95 transition"
                              >
                                ➕ কর্মকর্তা যোগ করুন
                              </button>
                            </div>
                          </div>

                          <div className="space-y-3 pl-2 sm:pl-4 border-l-2 border-purple-200">
                            {certItem.attestations.map((attAction, attIndex) => (
                              <div key={attAction.id || attIndex} className="bg-purple-500/5 p-3 rounded-xl relative space-y-3 border border-purple-200/40">
                                
                                <button
                                  type="button"
                                  onClick={() => removeAttestationFromCertificate(certIndex, attIndex)}
                                  className="absolute top-2.5 right-2 text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded-lg text-xs"
                                >
                                  ✕
                                </button>

                                <div className="flex items-center justify-between flex-wrap gap-1 pr-6">
                                  <span className="text-[9.5px] font-bold text-purple-700 uppercase">কর্মকর্তা #{attIndex + 1} সত্যায়ন বিবরণ</span>
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        updateCertificateAttestation(certIndex, attIndex, 'officerName', 'Afrin Haque');
                                        updateCertificateAttestation(certIndex, attIndex, 'officerDesignation', 'Senior Assistant Secretary');
                                        updateCertificateAttestation(certIndex, attIndex, 'type', 'Verify and found correct');
                                      }}
                                      className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded border cursor-pointer transition ${
                                        attAction.officerName === 'Afrin Haque' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-emerald-800 border-emerald-200 hover:bg-emerald-50'
                                      }`}
                                    >
                                      Afrin Haque
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        updateCertificateAttestation(certIndex, attIndex, 'officerName', 'Md. Siddiqur Rahman');
                                        updateCertificateAttestation(certIndex, attIndex, 'officerDesignation', 'Assistant Secretary');
                                        updateCertificateAttestation(certIndex, attIndex, 'type', 'Attested');
                                      }}
                                      className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded border cursor-pointer transition ${
                                        attAction.officerName === 'Md. Siddiqur Rahman' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-800 border-blue-200 hover:bg-blue-50'
                                      }`}
                                    >
                                      Md. Siddiqur Rahman
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        updateCertificateAttestation(certIndex, attIndex, 'officerName', 'Md. Shemul Ahmmed');
                                        updateCertificateAttestation(certIndex, attIndex, 'officerDesignation', 'Consular Assistant');
                                        updateCertificateAttestation(certIndex, attIndex, 'type', 'Verify and found correct');
                                      }}
                                      className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded border cursor-pointer transition ${
                                        attAction.officerName === 'Md. Shemul Ahmmed' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-amber-800 border-amber-200 hover:bg-amber-50'
                                      }`}
                                    >
                                      Md. Shemul Ahmmed (Passport)
                                    </button>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                                  <div>
                                    <label className="block text-[8.5px] font-bold text-gray-400">নাম (Officer Name) *</label>
                                    <input
                                      type="text"
                                      required
                                      value={attAction.officerName || ''}
                                      onChange={(e) => updateCertificateAttestation(certIndex, attIndex, 'officerName', e.target.value)}
                                      className="w-full px-2 py-1 text-xs border border-gray-200 bg-white rounded outline-none font-bold text-slate-800"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[8.5px] font-bold text-gray-400">পদবী (Designation) *</label>
                                    <input
                                      type="text"
                                      required
                                      value={attAction.officerDesignation || ''}
                                      onChange={(e) => updateCertificateAttestation(certIndex, attIndex, 'officerDesignation', e.target.value)}
                                      className="w-full px-2 py-1 text-xs border border-gray-200 bg-white rounded outline-none font-semibold"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[8.5px] font-bold text-gray-400">সত্যায়নের তারিখ (Attestation Date) *</label>
                                    <input
                                      type="date"
                                      required
                                      value={attAction.date || ''}
                                      onChange={(e) => updateCertificateAttestation(certIndex, attIndex, 'date', e.target.value)}
                                      className="w-full px-2 py-1 text-xs border border-gray-200 bg-white rounded outline-none"
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                  <div>
                                    <label className="block text-[8.5px] font-bold text-gray-400">সীলমোহরে প্রদর্শিত টেক্সট (Seal badge text) *</label>
                                    <select
                                      value={attAction.type || 'Verify and found correct'}
                                      onChange={(e) => updateCertificateAttestation(certIndex, attIndex, 'type', e.target.value)}
                                      className="w-full px-2 py-1 text-xs border border-gray-200 bg-white rounded outline-none font-bold"
                                    >
                                      <option value="Verify and found correct">Verify and found correct (যাচাইকৃত)</option>
                                      <option value="Attested">Attested (সত্যায়িত)</option>
                                      <option value="Verified and found correct">Verified and found correct</option>
                                    </select>
                                  </div>

                                  <div>
                                    <label className="block text-[8.5px] font-bold text-gray-400">কর্মকর্তার স্বাক্ষর ইমেজ (PNG) *</label>
                                    <input
                                      type="file"
                                      accept="image/*"
                                      onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        const compressed = await compressImage(file, 600, 0.85);
                                        if (compressed) {
                                          updateCertificateAttestation(certIndex, attIndex, 'signatureImageUrl', compressed);
                                        }
                                      }}
                                      className="w-full text-xs text-gray-400 p-0.5 bg-white border rounded"
                                    />
                                    {attAction.signatureImageUrl && (
                                      <div className="h-8 max-w-[100px] bg-slate-50 border p-0.5 mt-1 rounded flex items-center justify-center">
                                        <img src={attAction.signatureImageUrl} alt="Sig preview" className="h-full object-contain" referrerPolicy="no-referrer" />
                                      </div>
                                    )}
                                  </div>
                                </div>

                              </div>
                            ))}
                          </div>
                        </div>

                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            <div className="pt-4 border-t border-gray-200">
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-[#006a4e] hover:bg-[#005c43] text-white py-3 px-4 rounded-2xl font-black uppercase text-xs tracking-wider active:scale-95 transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer shadow-md disabled:bg-emerald-300"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>সংরক্ষণ করা হচ্ছে...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>{editingId ? 'সংশোধন ও মূল পেপার সংরক্ষণ করুন (Save Profile)' : 'অনলাইন সত্যায়ন সম্পন্ন ও কিউআর কোড জেনারেট করুন (Submit Records)'}</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* REAL TIME PREVIEW PANEL */}
          <div className="lg:col-span-5 flex flex-col items-center bg-gray-50 p-2 sm:p-4 border border-gray-200 rounded-2xl shadow-inner relative sticky top-6">
            <span className="absolute top-4 left-4 bg-gray-900 border border-emerald-500 text-emerald-400 text-[10px] font-black px-2 py-0.5 rounded shadow z-20">
              A4 Apostille Main Board Preview
            </span>

            {previewLoading && (
              <div className="absolute inset-0 bg-white/85 flex flex-col items-center justify-center z-30 rounded-2xl">
                <RefreshCw className="w-8 h-8 text-[#006a4e] animate-spin mb-1" />
                <span className="text-[10px] text-gray-500 font-bold">ড্রাফট লাইভ রেন্ডার হচ্ছে...</span>
              </div>
            )}

            <div className="w-full pt-8">
              <ApostilleMainBoard 
                certificate={{
                  id: certForm.id || 'PREVIEW-TEMP',
                  applicantName: (certForm.applicantName || 'FULL NAME OF APPLICANT').toUpperCase(),
                  fatherName: (certForm.fatherName || 'FATHER NAME').toUpperCase(),
                  motherName: (certForm.motherName || 'MOTHER NAME').toUpperCase(),
                  dob: certForm.dob || '2000-01-01',
                  certificateType: certForm.certificateType || 'Educational Certificate',
                  examinationName: certForm.examinationName || undefined,
                  rollNumber: certForm.rollNumber || undefined,
                  registrationNumber: certForm.registrationNumber || undefined,
                  certificateNumber: certForm.certificateNumber || 'CERT-NO-XXXXXX',
                  boardName: certForm.boardName || undefined,
                  country: certForm.country || 'Bangladesh',
                  issueDate: certForm.issueDate || new Date().toISOString().split('T')[0],
                  officerName: certForm.officerName || 'Md. Nazrul Islam',
                  officerDesignation: certForm.officerDesignation || 'Assistant Secretary',
                  signatureImageUrl: certForm.signatureImageUrl || settings.globalSignatureUrl,
                  sealImageUrl: certForm.sealImageUrl || settings.globalSealUrl,
                  qrCodeDataUrl: certForm.qrCodeDataUrl || '',
                  createdDate: new Date().toISOString(),
                  status: 'VERIFIED'
                }} 
                baseDomain={getBaseVerificationUrl()} 
                readOnly={true} 
              />
            </div>

            <canvas
              ref={previewCanvasRef}
              className="hidden"
            />

            <div className="mt-3 text-[10px] font-bold text-gray-400 text-center uppercase tracking-wide">
              Data on the main official certificate updates in real-time.
            </div>
          </div>

        </div>
      )}

      {/* 3. VIEW AS / PUBLIC PREVIEW VIEWER */}
      {!generatedProfile && activeTab === 'view-as' && (
        <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
          {/* Top Search / Lookup Card */}
          <div className="bg-white border border-gray-200 rounded-3xl p-6 sm:p-8 shadow-xs space-y-5">
            <div className="border-b border-gray-100 pb-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-lg font-black text-[#0f2c59] flex items-center gap-2">
                  <Eye className="w-5 h-5 text-[#006a4e]" />
                  পাবলিক ভেরিফিকেশন ভিউয়ার (View As - Public Preview)
                </h3>
                <span className="text-[10px] font-black uppercase px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full">
                  🛡️ অ্যাডমিন লাইভ প্রিভিউ মোড
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                অ্যাপোস্টিল নম্বর বা ট্র্যাকিং আইডি দিয়ে যেকোনো সনদ এবং এর সাথে সংযুক্ত সকল সার্টিফিকেট (Enclosed Documents) পাবলিক ভেরিফিকেশন পেজে ঠিক কেমন দেখাবে তা অ্যাডমিন প্যানেল থেকেই সরাসরি পরীক্ষা করুন।
              </p>
            </div>

            {/* Search input form */}
            <form onSubmit={(e) => { e.preventDefault(); handleLoadViewAs(); }} className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="অ্যাপোস্টিল নম্বর লিখুন (e.g. BD-AP-20260911-XXXXXX)"
                    value={viewAsId}
                    onChange={(e) => setViewAsId(e.target.value.toUpperCase())}
                    className="w-full px-4 py-3 text-sm font-mono font-bold uppercase border border-gray-200 bg-gray-50/50 rounded-2xl outline-none focus:border-[#006a4e] focus:bg-white focus:ring-1 focus:ring-[#006a4e] transition-all text-slate-800"
                  />
                  {viewAsId && (
                    <button
                      type="button"
                      onClick={() => { setViewAsId(''); setViewAsCert(null); setViewAsError(''); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={viewAsLoading || !viewAsId.trim()}
                  className="bg-[#006a4e] hover:bg-[#004e39] disabled:opacity-50 text-white font-extrabold text-xs uppercase tracking-wider px-6 py-3 rounded-2xl transition-all shadow-xs cursor-pointer flex items-center justify-center gap-2 flex-shrink-0"
                >
                  {viewAsLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                  চেক করুন (View As)
                </button>
              </div>

              {/* Quick Select from Recent Records */}
              {certificates.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap pt-1 text-xs">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                    সাম্প্রতিক রেকর্ডসমূহ:
                  </span>
                  {certificates.slice(0, 6).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleLoadViewAs(c.id, c)}
                      className={`text-[10.5px] font-mono font-bold px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                        viewAsCert?.id === c.id
                          ? 'bg-[#006a4e] text-white border-[#006a4e] shadow-2xs'
                          : 'bg-gray-50 hover:bg-gray-100 text-slate-700 border-gray-200'
                      }`}
                    >
                      {c.id} ({c.applicantName?.split(' ')[0] || 'Record'})
                    </button>
                  ))}
                </div>
              )}
            </form>

            {/* Error state */}
            {viewAsError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl p-4 text-xs font-bold flex items-center gap-2 animate-fade-in">
                <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                <span>{viewAsError}</span>
              </div>
            )}
          </div>

          {/* When a certificate is loaded */}
          {viewAsCert ? (
            <div className="space-y-6 animate-fade-in">
              {/* Summary Toolbar */}
              <div className="bg-white border border-emerald-200 rounded-3xl p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black font-mono text-[#006a4e] bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                        {viewAsCert.id}
                      </span>
                      <span className="text-xs font-black text-slate-800">
                        {viewAsCert.applicantName}
                      </span>
                      <span className="text-[10px] font-extrabold px-2 py-0.5 bg-purple-100 text-purple-900 border border-purple-200 rounded-full">
                        {viewAsCert.attachedCertificates?.length || 0} টি সার্টিফিকেট সংযুক্ত
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      ইস্যুর তারিখ: <span className="font-bold text-slate-700">{viewAsCert.issueDate}</span> | ধরন: <span className="font-bold text-slate-700">{viewAsCert.certificateType}</span> | দেশ: <span className="font-bold text-slate-700">{viewAsCert.country}</span>
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(viewAsCert.id);
                        setCertForm(viewAsCert);
                        setActiveTab('create');
                      }}
                      className="px-3 py-2 text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      রেকর্ডটি এডিট করুন
                    </button>

                    <button
                      type="button"
                      onClick={() => downloadCertificateImmediate(viewAsCert)}
                      className="px-3 py-2 text-xs font-bold bg-[#006a4e] hover:bg-[#004e39] text-white rounded-xl flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      PDF ডাউনলোড
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const publicUrl = `${getBaseVerificationUrl()}/?id=${encodeURIComponent(viewAsCert.id)}`;
                        navigator.clipboard.writeText(publicUrl);
                        setViewAsCopied(true);
                        setTimeout(() => setViewAsCopied(false), 2000);
                      }}
                      className="px-3 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      {viewAsCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {viewAsCopied ? 'কপি হয়েছে' : 'লিংক কপি'}
                    </button>

                    <a
                      href={`${getBaseVerificationUrl()}/?id=${encodeURIComponent(viewAsCert.id)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 text-xs font-bold bg-white hover:bg-gray-50 text-slate-700 border border-gray-300 rounded-xl flex items-center gap-1.5 transition-all"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      পাবলিক ভিউ
                    </a>
                  </div>
                </div>

                {/* Quick Check notice */}
                <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-2xl p-3 flex items-center gap-2.5 text-xs text-emerald-900">
                  <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>
                    নিচে হুবহু পাবলিক ভেরিফিকেশন পেজের মতো মূল অ্যাপোস্টিল সনদ এবং সংযুক্ত <strong>{viewAsCert.attachedCertificates?.length || 0}টি সার্টিফিকেট</strong> একসাথে প্রদর্শিত হচ্ছে।
                  </span>
                </div>
              </div>

              {/* 1. Official Apostille Sheet Board */}
              <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-7 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                    <span>📜</span> ১. মূল অ্যাপোস্টিল সনদ (Official e-Apostille Sheet)
                  </h4>
                  <span className="text-[10px] font-bold text-gray-400 font-mono">
                    Page 1 / A4 Dimension
                  </span>
                </div>

                <div className="flex justify-center bg-slate-50/60 p-3 sm:p-6 rounded-2xl border border-gray-100 overflow-x-auto">
                  <ApostilleMainBoard certificate={viewAsCert} baseDomain={getBaseVerificationUrl()} />
                </div>
              </div>

              {/* 2. All Attached Enclosure Certificates */}
              <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-7 shadow-xs space-y-6">
                <div className="border-b border-gray-100 pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h4 className="text-base font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                      <span>📁</span> ২. সংযুক্ত মূল সনদপত্রসমূহ ({viewAsCert.attachedCertificates?.length || 0}টি ডকুমেন্ট)
                    </h4>
                    <span className="text-[10px] font-black px-2.5 py-1 bg-purple-50 text-purple-800 border border-purple-200 rounded-full uppercase tracking-wider">
                      Attestation Chain Summary
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    ক্যান্ডিডেটের মূল সার্টিফিকেটগুলোর স্ক্যান কপি এবং কার কার সিল ও সত্যায়ন রয়েছে তা নিচে প্রদর্শিত হচ্ছে:
                  </p>
                </div>

                {(!viewAsCert.attachedCertificates || viewAsCert.attachedCertificates.length === 0) ? (
                  <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-6 text-center space-y-2">
                    <AlertTriangle className="w-8 h-8 text-amber-600 mx-auto" />
                    <h5 className="text-sm font-bold text-amber-900">কোনো অতিরিক্ত সার্টিফিকেট সংযুক্ত করা নেই</h5>
                    <p className="text-xs text-amber-700 max-w-md mx-auto">
                      এই অ্যাপোস্টিলে শুধুমাত্র মূল অ্যাপোস্টিল পেপারটি সংরক্ষিত রয়েছে। আপনি চাইলে "রেকর্ডটি এডিট করুন" বোতামে ক্লিক করে নতুন সার্টিফিকেট ফাইল ও সত্যায়নকারী স্বাক্ষর যোগ করতে পারবেন।
                    </p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {viewAsCert.attachedCertificates.map((certItem, index) => (
                      <div
                        key={certItem.id || index}
                        className="bg-slate-50/50 border border-gray-200 rounded-2xl p-4 sm:p-6 shadow-2xs space-y-5 text-slate-800 transition-all hover:border-gray-300"
                      >
                        {/* Title Bar */}
                        <div className="flex items-center justify-between border-b border-gray-200/80 pb-3 flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-[#006a4e] uppercase bg-[#006a4e]/10 px-3 py-1 rounded-full border border-[#006a4e]/20">
                              ATTACHMENT RECORD #{index + 1}
                            </span>
                            <span className="text-xs sm:text-sm font-black text-slate-900 bg-white px-3 py-1 rounded-lg border border-slate-200 shadow-2xs">
                              📜 {certItem.documentType || certItem.id || `Document #${index + 1}`}
                            </span>
                          </div>

                          <span className="text-[10px] font-bold text-gray-400">
                            পেজ #{index + 2} (PDF Enclosure)
                          </span>
                        </div>

                        {/* Certificate Scanned Image */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">
                              স্ক্যানকৃত মূল ডকুমেন্টের কপি (Scanned Copy):
                            </span>
                            {certItem.certificateImageUrl && (
                              <button
                                type="button"
                                onClick={() => setViewAsLightboxImage(certItem.certificateImageUrl)}
                                className="text-[10px] font-bold text-[#006a4e] hover:underline flex items-center gap-1 cursor-pointer"
                              >
                                <ZoomIn className="w-3 h-3" /> বড় করে দেখুন (Enlarge)
                              </button>
                            )}
                          </div>

                          {certItem.certificateImageUrl ? (
                            <div
                              onClick={() => setViewAsLightboxImage(certItem.certificateImageUrl)}
                              className="relative border border-gray-200 rounded-xl overflow-hidden bg-white h-72 sm:h-96 w-full flex items-center justify-center group cursor-zoom-in shadow-inner"
                            >
                              <img
                                src={certItem.certificateImageUrl}
                                alt={`Attachment ${index + 1}`}
                                className="max-h-full max-w-full object-contain filter transition-all group-hover:brightness-95"
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 flex items-center justify-center transition-all">
                                <span className="opacity-0 group-hover:opacity-100 bg-black/80 text-white rounded-lg text-[10px] font-bold px-3 py-1.5 uppercase tracking-wide flex items-center gap-1.5 shadow-md">
                                  <ZoomIn className="w-3.5 h-3.5" /> ক্লিক করে ফুল সাইজ দেখুন
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="h-32 bg-gray-100 rounded-xl border border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-400">
                              কোনো ইমেজ ফাইল পাওয়া যায়নি
                            </div>
                          )}
                        </div>

                        {/* Attestation Log for this certificate */}
                        {certItem.attestations && certItem.attestations.length > 0 && (
                          <div className="space-y-3 pt-3 border-t border-gray-200">
                            <h5 className="text-[10px] font-black text-gray-500 uppercase tracking-wider">
                              সত্যায়ন কর্মকর্তা এবং স্বাক্ষর বিবরণী (Attestation Log):
                            </h5>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {certItem.attestations.map((attAction, attIdx) => (
                                <div
                                  key={attAction.id || attIdx}
                                  className="bg-white p-3.5 rounded-xl border border-gray-200 space-y-2 shadow-2xs"
                                >
                                  <div className="flex items-center justify-between text-[9px] font-black text-gray-400 uppercase">
                                    <div className="flex items-center gap-1.5">
                                      <span>সত্যায়নকারী #{attIdx + 1}</span>
                                      <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold ${
                                        (attAction.type || '').toLowerCase().includes('verify') 
                                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                          : 'bg-blue-50 text-blue-700 border border-blue-200'
                                      }`}>
                                        {attAction.type || 'Attested'}
                                      </span>
                                    </div>
                                    <span>{attAction.date}</span>
                                  </div>

                                  <div className="flex items-center gap-3">
                                    {(attAction.signatureImageUrl || (attAction as any).signatureUrl) && (
                                      <div className="w-20 h-10 bg-gray-50 p-1 border border-gray-200 rounded flex items-center justify-center flex-shrink-0">
                                        <img
                                          src={attAction.signatureImageUrl || (attAction as any).signatureUrl}
                                          alt="Officer Signature"
                                          className="max-h-full max-w-full object-contain"
                                          referrerPolicy="no-referrer"
                                        />
                                      </div>
                                    )}
                                    {(attAction.sealImageUrl || (attAction as any).sealUrl) && (
                                      <div className="w-10 h-10 bg-gray-50 p-1 border border-gray-200 rounded flex items-center justify-center flex-shrink-0">
                                        <img
                                          src={attAction.sealImageUrl || (attAction as any).sealUrl}
                                          alt="Officer Seal"
                                          className="max-h-full max-w-full object-contain"
                                          referrerPolicy="no-referrer"
                                        />
                                      </div>
                                    )}
                                    <div className="min-w-0 text-xs">
                                      <p className="font-bold text-slate-800 truncate">
                                        {attAction.officerName || 'Official'}
                                      </p>
                                      <p className="text-[10px] text-gray-500 truncate">
                                        {attAction.officerDesignation || 'Attesting Officer'}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border border-gray-200 rounded-3xl p-12 text-center space-y-3">
              <div className="w-12 h-12 bg-white rounded-full border border-gray-200 flex items-center justify-center mx-auto text-gray-400 shadow-2xs">
                <Eye className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-700">কোনো রেকর্ড লোড করা হয়নি</h4>
              <p className="text-xs text-gray-500 max-w-md mx-auto">
                উপরে আপনার অ্যাপোস্টিল ট্র্যাকিং নম্বরটি প্রবেশ করিয়ে "চেক করুন (View As)" বাটনে ক্লিক করুন অথবা সাম্প্রতিক তালিকা থেকে যেকোনো রেকর্ড নির্বাচন করুন।
              </p>
            </div>
          )}

          {/* Lightbox Modal for Enclosure Image */}
          {viewAsLightboxImage && (
            <div
              className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
              onClick={() => setViewAsLightboxImage(null)}
            >
              <div
                className="relative max-w-4xl max-h-[90vh] bg-white rounded-2xl p-2 shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between p-2 border-b border-gray-200">
                  <span className="text-xs font-bold text-slate-700">ডকুমেন্ট ভিউয়ার (Full Size Scanned Document)</span>
                  <button
                    type="button"
                    onClick={() => setViewAsLightboxImage(null)}
                    className="p-1 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-800 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-2 overflow-auto max-h-[80vh] flex items-center justify-center bg-gray-50">
                  <img
                    src={viewAsLightboxImage}
                    alt="Enlarged Document"
                    className="max-h-full max-w-full object-contain rounded"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {!generatedProfile && activeTab === 'search' && (
        <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
          <div className="bg-white border border-gray-200 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
            <div className="border-b border-gray-100 pb-4">
              <h3 className="text-lg font-extrabold text-[#0f2c59] flex items-center gap-2">
                <Search className="w-5 h-5 text-[#006a4e]" />
                অভ্যন্তরীণ ট্র্যাকিং আইডি সার্চ (Admin Internal Verification Check)
              </h3>
              <p className="text-xs text-gray-400 mt-1">
                CMS ডাটাবেজ থেকে নির্দিষ্ট ট্র্যাকিং আইডির রেকর্ড সরাসরি ভেরিফাই করুন।
              </p>
            </div>

            <form onSubmit={handleAdminVerifySearch} className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="উদাহরণ: BD-AP-20260811-894102"
                  value={adminSearchId}
                  onChange={(e) => setAdminSearchId(e.target.value.toUpperCase())}
                  className="w-full px-4 py-3 text-sm font-mono font-bold uppercase border border-gray-200 rounded-2xl outline-none focus:border-[#006a4e] focus:ring-1 focus:ring-[#006a4e] transition-all bg-gray-50/50"
                />
              </div>
              <button
                type="submit"
                disabled={adminSearchLoading || !adminSearchId.trim()}
                className="bg-[#006a4e] hover:bg-[#004e39] disabled:opacity-50 text-white font-extrabold text-xs uppercase px-6 py-3 rounded-2xl transition-all shadow cursor-pointer flex items-center justify-center gap-2"
              >
                {adminSearchLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                যাচাই করুন (Verify)
              </button>
            </form>

            {/* SEARCH RESULT STATUS */}
            {adminSearchResult.searched && (
              <div className="pt-4 border-t border-gray-100">
                {adminSearchResult.cert ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 space-y-4 animate-fade-in">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-emerald-100 text-[#006a4e] flex items-center justify-center font-bold">
                        <CheckCircle className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="text-base font-extrabold text-emerald-950 uppercase">✓ VALID RECORD (বৈধ রেকর্ড)</h4>
                        <p className="text-xs text-emerald-700 font-bold">CMS Database-এ রেকর্ডটি সফলভাবে পাওয়া গেছে।</p>
                      </div>
                    </div>

                    {/* Record Summary Table */}
                    <div className="bg-white border border-emerald-100 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-sans">
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Tracking ID</span>
                        <span className="font-mono font-black text-emerald-800 text-sm">{adminSearchResult.cert.id}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Candidate Name</span>
                        <span className="font-extrabold text-gray-900">{adminSearchResult.cert.applicantName}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Father / Mother Name</span>
                        <span className="font-bold text-gray-800">{adminSearchResult.cert.fatherName} / {adminSearchResult.cert.motherName}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Issue Date</span>
                        <span className="font-bold font-mono text-gray-800">{adminSearchResult.cert.issueDate}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Certificate Type</span>
                        <span className="font-bold text-gray-800">{adminSearchResult.cert.certificateType}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Status</span>
                        <span className="inline-block px-2.5 py-0.5 bg-emerald-100 text-[#006a4e] text-[10px] font-extrabold rounded-full border border-emerald-200 uppercase">
                          {adminSearchResult.cert.status || 'VERIFIED'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                      <a
                        href={`${getBaseVerificationUrl()}/?id=${encodeURIComponent(adminSearchResult.cert.id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-[#006a4e] hover:bg-[#00523d] text-white text-xs font-extrabold px-4 py-2.5 rounded-xl transition-all flex items-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        পাবলিক ভেরিফিকেশন ভিউ দেখুন (Open Public Link)
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="bg-red-50 border border-red-200 rounded-2xl p-6 flex items-center gap-4 animate-fade-in">
                    <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-base font-extrabold text-red-800 uppercase">✕ INVALID / RECORD NOT FOUND</h4>
                      <p className="text-xs text-red-600 font-bold mt-0.5">
                        {adminSearchResult.message || 'ডাটাবেজে এই ট্র্যাকিং আইডির কোনো রেকর্ড পাওয়া যায়নি।'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. SYSTEM SETTINGS PANEL */}
      {!generatedProfile && activeTab === 'settings' && (
        <div className="space-y-8 animate-fade-in max-w-4xl mx-auto">
          {/* Settings Section */}
          <div className="bg-white border border-gray-200 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
            <div className="border-b border-gray-100 pb-4">
              <h3 className="text-lg font-extrabold text-[#0f2c59] flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#006a4e]" />
                সিস্টেম সেটিংস (Global System Configurations)
              </h3>
              <p className="text-xs text-gray-400 mt-1">পাবলিক কিউআর কোড জেনারেশন ডোমেইন এবং সার্টিফিকেট টেমপ্লেট কাস্টমাইজ করুন।</p>
            </div>

            <form onSubmit={handleUpdateSettings} className="space-y-6">
              {/* Custom Domain Section */}
              <div className="space-y-2">
                <label className="block text-xs font-black text-gray-500 uppercase tracking-wider">
                  কাস্টম ডোমেইন (Custom Connected Domain Name)
                </label>
                <input
                  type="text"
                  placeholder="e.g., apostillebd.com or mofa-servicedirectory.gov.bd"
                  value={settings.customDomain}
                  onChange={(e) => setSettings({ ...settings, customDomain: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-200 rounded-2xl outline-none font-mono text-sm focus:border-[#006a4e] focus:ring-1 focus:ring-[#006a4e] transition-all bg-gray-50/50"
                />
                <p className="text-[10px] text-gray-400 leading-normal">
                  * <strong>গুরুত্বপূর্ণ:</strong> আপনি এখানে আপনার নতুন ডোমেইন নাম সেট করলে, ভবিষ্যতে প্রতিটি সার্টিফিকেটের QR কোড এবং ভেরিফিকেশন লিঙ্ক স্বয়ংক্রিয়ভাবে আপনার নতুন ডোমেইনের নামে তৈরি হবে। যেমন: <code>https://apostillebd.com/verify/&lt;ID&gt;</code>। ফাঁকা রাখলে বর্তমান সার্ভার ডোমেইনটি ব্যবহৃত হবে।
                </p>
              </div>

              {/* Logo / Seal / Signature Template Upload Inputs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="block text-xs font-black text-gray-500 uppercase tracking-wider">
                    ডিফল্ট লোগো ইউআরএল (Default Government Logo URL)
                  </label>
                  <input
                    type="text"
                    value={settings.defaultLogoUrl}
                    onChange={(e) => setSettings({ ...settings, defaultLogoUrl: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none text-xs focus:border-[#006a4e] transition-all bg-gray-50/50"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-black text-gray-500 uppercase tracking-wider">
                    অফিসিয়াল অ্যাপোস্টিল সীল/স্ট্যাম্প ফাইল আপলোড (Official Apostille Seal - PNG/JPG/WEBP)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const compressed = await compressImage(file, 600, 0.85);
                      if (compressed) {
                        setSettings(prev => ({ ...prev, globalSealUrl: compressed }));
                      }
                    }}
                    className="w-full text-xs text-gray-500 bg-white border border-gray-200 rounded-xl p-1.5 focus:border-[#006a4e]"
                  />
                  {settings.globalSealUrl ? (
                    <div className="flex items-center gap-3 p-2 bg-emerald-50 border border-emerald-200 rounded-xl mt-2">
                      <div className="w-14 h-14 bg-white border rounded-lg p-1 flex items-center justify-center">
                        <img src={settings.globalSealUrl} alt="Seal Preview" className="max-h-full max-w-full object-contain" />
                      </div>
                      <div className="flex-1">
                        <p className="text-[11px] font-bold text-emerald-900">অফিসিয়াল সীল আপলোড করা আছে</p>
                        <p className="text-[9.5px] text-emerald-700">Official seal active</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSettings(prev => ({ ...prev, globalSealUrl: '' }))}
                        className="text-xs font-extrabold text-red-600 hover:text-red-800 bg-white px-2.5 py-1 rounded-lg border border-red-200"
                      >
                        রিমুভ করুন
                      </button>
                    </div>
                  ) : (
                    <p className="text-[10px] text-gray-400 italic">কোনো সীল সেট করা নেই। (No seal assigned)</p>
                  )}
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="block text-xs font-black text-gray-500 uppercase tracking-wider">
                    গ্লোবাল কর্মকর্তার স্বাক্ষর ফাইল আপলোড (Global Officer Signature Image - PNG/JPG/WEBP)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const compressed = await compressImage(file, 600, 0.85);
                      if (compressed) {
                        setSettings(prev => ({ ...prev, globalSignatureUrl: compressed }));
                      }
                    }}
                    className="w-full text-xs text-gray-500 bg-white border border-gray-200 rounded-xl p-1.5 focus:border-[#006a4e]"
                  />
                  {settings.globalSignatureUrl ? (
                    <div className="flex items-center gap-3 p-2 bg-emerald-50 border border-emerald-200 rounded-xl mt-2">
                      <div className="h-10 w-28 bg-white border rounded-lg p-1 flex items-center justify-center">
                        <img src={settings.globalSignatureUrl} alt="Signature Preview" className="max-h-full max-w-full object-contain" />
                      </div>
                      <div className="flex-1">
                        <p className="text-[11px] font-bold text-emerald-900">স্বাক্ষর আপলোড করা আছে</p>
                        <p className="text-[9.5px] text-emerald-700">Signature image active</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSettings(prev => ({ ...prev, globalSignatureUrl: '' }))}
                        className="text-xs font-extrabold text-red-600 hover:text-red-800 bg-white px-2.5 py-1 rounded-lg border border-red-200"
                      >
                        রিমুভ করুন
                      </button>
                    </div>
                  ) : (
                    <p className="text-[10px] text-gray-400 italic">কোনো স্বাক্ষর ফাইল আপলোড করা নেই।</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="bg-[#006a4e] hover:bg-[#004e39] text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer shadow"
                >
                  <Save className="w-4 h-4" />
                  সেটিংস সংরক্ষণ করুন (Save Global Settings)
                </button>
              </div>
            </form>
          </div>

          {/* Change Password Section */}
          <div className="bg-white border border-gray-200 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
            <div className="border-b border-gray-100 pb-4">
              <h3 className="text-lg font-extrabold text-[#0f2c59] flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-[#006a4e]" />
                অ্যাডমিন পাসওয়ার্ড পরিবর্তন (Change Password)
              </h3>
              <p className="text-xs text-gray-400 mt-1">ভেরিফিকেশন পোর্টালের অ্যাডমিন প্যানেলে লগইন করার পাসওয়ার্ড পরিবর্তন করুন।</p>
            </div>

            <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
              <div className="space-y-1.5">
                <label className="block text-xs font-black text-gray-500 uppercase tracking-wider">বর্তমান পাসওয়ার্ড (Old Password)</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={passwordForm.oldPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none text-xs focus:border-[#006a4e] transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-black text-gray-500 uppercase tracking-wider">নতুন পাসওয়ার্ড (New Password)</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none text-xs focus:border-[#006a4e] transition-all"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="bg-slate-800 hover:bg-slate-900 text-white px-6 py-2.5 rounded-xl font-bold text-xs uppercase transition-all flex items-center gap-1.5 cursor-pointer shadow"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  পাসওয়ার্ড আপডেট করুন (Update Password)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
