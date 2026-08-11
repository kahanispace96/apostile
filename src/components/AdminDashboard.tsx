/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { 
  FilePlus2, Database, Settings, ShieldCheck, Search, Trash2, Edit, Save, 
  X, RefreshCw, BadgeInfo, Image as ImageIcon, CheckCircle, KeyRound, Eye,
  FileDown, Plus, Download, Copy, Check, ArrowRight, Trash, QrCode, Sparkles
} from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Certificate, AttachedCertificate, AttestationItem } from '../types';
import { FALLBACK_CERTIFICATES } from '../fallbackData';
import { renderCertificateToCanvas, downloadCanvasAsPdf, downloadCanvasAsJpg } from '../utils/certificateRenderer';
import ApostilleMainBoard from './ApostilleMainBoard';

interface AdminDashboardProps {
  token: string;
  onLogout: () => void;
}

export default function AdminDashboard({ token, onLogout }: AdminDashboardProps) {
  // Navigation views
  const [activeTab, setActiveTab] = useState<'records' | 'create' | 'settings'>('records');

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
    country: 'United Kingdom',
    issueDate: new Date().toISOString().split('T')[0],
    officerName: 'Md. Nazrul Islam',
    officerDesignation: 'Assistant Secretary (Consular)',
    signatureImageUrl: '',
    sealImageUrl: '',
    attachedCertificates: [],
    fullyAttestedDocumentUrl: ''
  });

  // Editor states
  const [editingId, setEditingId] = useState<string | null>(null);

  // Live preview element
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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
        setCertificates(data.certificates);
        localStorage.setItem('MoFA_Certificates', JSON.stringify(data.certificates));
        setLoading(false);
        return;
      }
    } catch (e) {
      console.log('Failed to fetch certificates from server, checking local store');
    }

    // Fallback load from localStorage or static fallback
    try {
      const localStored = localStorage.getItem('MoFA_Certificates');
      if (localStored) {
        const parsed = JSON.parse(localStored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setCertificates(parsed);
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

  // Auto-generate live QR Code preview whenever tracking ID changes
  useEffect(() => {
    let isMounted = true;
    const targetId = certForm.id && certForm.id.trim() ? certForm.id.trim().toUpperCase() : 'TRK-001';
    const baseDomain = getBaseVerificationUrl();
    const rollQuery = certForm.rollNumber && certForm.rollNumber.trim() ? `&roll=${encodeURIComponent(certForm.rollNumber.trim())}` : '';
    const regQuery = certForm.registrationNumber && certForm.registrationNumber.trim() ? `&reg=${encodeURIComponent(certForm.registrationNumber.trim())}` : '';
    const url = `${baseDomain}/?id=${encodeURIComponent(targetId)}${rollQuery}${regQuery}`;

    QRCode.toDataURL(url, { margin: 1, width: 300, color: { dark: '#000000', light: '#ffffff' } })
      .then(qr => {
        if (isMounted) setLivePreviewQr(qr);
      })
      .catch(() => {});

    return () => { isMounted = false; };
  }, [certForm.id, certForm.rollNumber, certForm.registrationNumber, settings.customDomain]);

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
        country: certForm.country || 'Target Country',
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

  // -------------------------------------------------------------
  // DYNAMIC MULTI-CERTIFICATE & ATTESTATION HANDLERS
  // -------------------------------------------------------------
  const addAttachedCertificate = () => {
    const newCert: AttachedCertificate = {
      id: "CERT-" + Math.random().toString(36).substring(2, 7).toUpperCase(),
      certificateImageUrl: '',
      attestations: [
        {
          id: "ATT-" + Math.random().toString(36).substring(2, 7).toUpperCase(),
          type: 'Attested',
          officerName: 'Sarena Parvin Shawon',
          officerDesignation: 'Assistant Controller of Examinations',
          date: new Date().toISOString().split('T')[0],
          signatureImageUrl: settings.globalSignatureUrl || ''
        }
      ]
    };
    setCertForm(prev => ({
      ...prev,
      attachedCertificates: [...(prev.attachedCertificates || []), newCert]
    }));
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

  const addAttestationToCertificate = (certIndex: number) => {
    const newAtt: AttestationItem = {
      id: "ATT-" + Math.random().toString(36).substring(2, 7).toUpperCase(),
      type: 'Attested',
      officerName: 'Md. Golam Mostafa',
      officerDesignation: 'Deputy Controller of Examinations',
      date: new Date().toISOString().split('T')[0],
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
      let count = certificates.length + 1;
      let candidate = `TRK-${String(count).padStart(3, '0')}`;
      while (certificates.some(c => c.id.toUpperCase() === candidate.toUpperCase())) {
        count++;
        candidate = `TRK-${String(count).padStart(3, '0')}`;
      }
      verificationId = candidate;
    }

    // Auto-generate QR Code bound to exact verification URL
    const rollQuery = certForm.rollNumber && certForm.rollNumber.trim() ? `&roll=${encodeURIComponent(certForm.rollNumber.trim())}` : '';
    const regQuery = certForm.registrationNumber && certForm.registrationNumber.trim() ? `&reg=${encodeURIComponent(certForm.registrationNumber.trim())}` : '';
    const verificationUrl = `${getBaseVerificationUrl()}/?id=${encodeURIComponent(verificationId)}${rollQuery}${regQuery}`;
    let generatedQrCode = certForm.qrCodeDataUrl || '';
    if (!generatedQrCode) {
      try {
        generatedQrCode = await QRCode.toDataURL(verificationUrl, {
          margin: 1,
          width: 300,
          color: { dark: '#000000', light: '#ffffff' }
        });
      } catch (qrErr) {
        console.error('Failed to auto-generate QR Code:', qrErr);
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
      country: certForm.country || 'United Kingdom',
      boardName: certForm.boardName || 'Dhaka',
      certificateType: certForm.certificateType || 'Educational Certificate',
      qrCodeDataUrl: generatedQrCode,
      attachedCertificates: certForm.attachedCertificates || []
    };

    const updateLocalStorage = (certToSave: Certificate) => {
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

      // Sync to Firestore DB
      try {
        if (db) {
          setDoc(doc(db, 'students', certToSave.id), certToSave, { merge: true }).catch(err => console.warn('Firestore student save notice:', err));
          setDoc(doc(db, 'certificates', certToSave.id), certToSave, { merge: true }).catch(err => console.warn('Firestore cert save notice:', err));
        }
      } catch (e) {
        console.warn('Firestore sync error:', e);
      }
    };

    const resetCertForm = () => {
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
        country: 'United Kingdom',
        issueDate: new Date().toISOString().split('T')[0],
        officerName: 'Md. Nazrul Islam',
        officerDesignation: 'Assistant Secretary (Consular)',
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
        updateLocalStorage(savedCert);
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
      console.warn('Backend API connection unavailable, defaulting to local storage save:', err);
    }

    // Client/Offline fallback save
    updateLocalStorage(finalCert);
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
          <h2 className="text-2xl font-black text-gray-950 tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-[#006a4e]" />
            অনলাইন সত্যায়ন ও ভেরিফিকেশন কনসোল
          </h2>
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
        <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200 w-full md:w-auto">
          <button
            onClick={() => { setActiveTab('records'); setGeneratedProfile(null); }}
            className={`flex-1 md:flex-none uppercase text-[10px] tracking-wider font-bold px-4 py-2.5 rounded-lg transition-all ${
              activeTab === 'records' 
                ? 'bg-white text-[#006a4e] shadow-sm' 
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <span className="flex items-center gap-1.5 justify-center">
              <Database className="w-3.5 h-3.5" />
              সকল রেকর্ড (Records Ledger)
            </span>
          </button>
          
          <button
            onClick={() => { setActiveTab('create'); setGeneratedProfile(null); }}
            className={`flex-1 md:flex-none uppercase text-[10px] tracking-wider font-bold px-4 py-2.5 rounded-lg transition-all ${
              activeTab === 'create' 
                ? 'bg-white text-[#006a4e] shadow-sm' 
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <span className="flex items-center gap-1.5 justify-center">
              <FilePlus2 className="w-3.5 h-3.5" />
              নতুন সত্যায়ন তৈরি (Create Attestation)
            </span>
          </button>

          <button
            onClick={() => { setActiveTab('settings'); setGeneratedProfile(null); }}
            className={`flex-1 md:flex-none uppercase text-[10px] tracking-wider font-bold px-4 py-2.5 rounded-lg transition-all ${
              activeTab === 'settings' 
                ? 'bg-white text-[#006a4e] shadow-sm' 
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <span className="flex items-center gap-1.5 justify-center">
              <Settings className="w-3.5 h-3.5" />
              সিস্টেম সেটিংস (System Settings)
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
                      country: 'United Kingdom',
                      issueDate: new Date().toISOString().split('T')[0],
                      officerName: 'Md. Nazrul Islam',
                      officerDesignation: 'Assistant Secretary (Consular)',
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1">ভেরিফিকেশন ট্র্যাকিং আইডি * (Custom ID or Blank to Auto-generate)</label>
                    <input
                      type="text"
                      placeholder="e.g. BD-AP-2026-89410"
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
                      onChange={(e) => setCertForm(prev => ({ ...prev, issueDate: e.target.value }))}
                      className="w-full px-3 py-2 text-xs border border-gray-200 bg-white rounded-xl outline-none focus:border-[#006a4e] font-bold"
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
                        placeholder="e.g. Md. Nazrul Islam"
                        value={certForm.officerName || ''}
                        onChange={(e) => setCertForm(prev => ({ ...prev, officerName: e.target.value }))}
                        className="w-full px-3 py-2 text-xs border border-gray-200 bg-white rounded-xl outline-none focus:border-[#006a4e] font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1">কর্মকর্তার পদবী (Official capacity) *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Assistant Controller of Examinations"
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

                  {/* External QR Code Upload Section */}
                  <div className="pt-4 border-t border-gray-100">
                    <label className="block text-[11px] font-black text-purple-900 mb-1 flex items-center gap-1.5">
                      <QrCode className="w-4 h-4 text-purple-700" />
                      <span>১১. QR কোড ইমেজ আপলোড (Upload External QR Code Image PNG/JPG)</span>
                    </label>
                    <p className="text-[10.5px] text-gray-500 mb-2">
                      পাবলিক ভেরিফিকেশন লিংক কপি করে External QR Code Generator দিয়ে তৈরি করা QR কোডের ছবিটি এখানে আপলোড করুন।
                    </p>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, 'qrCodeDataUrl')}
                      className="w-full text-xs text-gray-600 bg-white border border-purple-200 rounded-xl p-1.5 focus:border-purple-600 outline-none"
                    />
                    {certForm.qrCodeDataUrl ? (
                      <div className="mt-2.5 p-3 bg-purple-50 border border-purple-200 rounded-xl flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <img src={certForm.qrCodeDataUrl} alt="Uploaded QR Code" className="w-14 h-14 bg-white border border-purple-200 p-1 rounded-lg object-contain shadow-sm" />
                          <div>
                            <span className="text-xs font-extrabold text-purple-900 block">✓ QR কোড সফলভাবে আপলোড করা হয়েছে</span>
                            <span className="text-[10px] text-purple-700">A4 ডকুমেন্টের ডানপাশের নিচের নির্দিষ্ট জায়গায় এটি বসবে</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCertForm(prev => ({ ...prev, qrCodeDataUrl: '' }))}
                          className="text-xs text-red-600 hover:text-red-800 font-extrabold px-2.5 py-1 bg-white border border-red-200 rounded-lg shadow-sm cursor-pointer"
                        >
                          রিমুভ করুন
                        </button>
                      </div>
                    ) : (
                      <div className="mt-2 text-[10.5px] text-amber-800 font-semibold bg-amber-50 p-2.5 rounded-xl border border-amber-200 flex items-center gap-1.5">
                        <span>⚠️ এখন পর্যন্ত QR কোড আপলোড করা হয়নি। সেভ করার পর লিংক কপি করে QR কোড তৈরি করে এখানে আপলোড করতে পারেন।</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* SECTION C: DYNAMIC MULTI-CERTIFICATE ACCORDION (এক এক করে সার্টিফিকেট যোগ করার অপশন) */}
              <div className="bg-[#006a4e]/5 p-5 rounded-2xl border border-[#006a4e]/10 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11.5px] font-black text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-[#006a4e] text-white text-[10px] font-black flex items-center justify-center">৩</span>
                    সংযুক্ত ক্যান্ডিডেট সার্টিফিকেটসমূহ ও সত্যায়ন বিবরণী
                  </h4>
                  <button
                    type="button"
                    onClick={addAttachedCertificate}
                    className="px-3 py-1.5 bg-[#006a4e] text-white text-[10.5px] font-extrabold rounded-xl hover:bg-[#004e39] transition-all cursor-pointer shadow-sm flex items-center gap-1 border border-emerald-600 active:scale-95"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    সার্টিফিকেট যোগ করুন
                  </button>
                </div>

                {(!certForm.attachedCertificates || certForm.attachedCertificates.length === 0) ? (
                  <div className="text-center py-10 border border-dashed border-gray-200 bg-white rounded-2xl text-[11px] text-gray-400 font-bold space-y-2">
                    <ImageIcon className="w-8 h-8 text-slate-350 mx-auto animate-pulse" />
                    <p>কোনো মূল সার্টিফিকেট ফাইল এখনও সংযুক্ত করা হয়নি।</p>
                    <button
                      type="button"
                      onClick={addAttachedCertificate}
                      className="text-[#006a4e] hover:underline font-extrabold text-[11px] block mx-auto pt-1"
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
                            <label className="block text-[9.5px] font-bold text-gray-400 uppercase">১. ডকুমেন্টের নাম (e.g., SSC Transcript / Certificate) *</label>
                            <input
                              type="text"
                              required
                              placeholder="e.g. S.S.C Educational Certificate"
                              value={certItem.id || ''}
                              onChange={(e) => updateCertificateName(certIndex, e.target.value)}
                              className="w-full px-3 py-1.5 text-xs border border-gray-200 bg-[#f8fafc] rounded-lg focus:border-[#006a4e] outline-none font-bold"
                            />
                          </div>

                          <div>
                            <label className="block text-[9.5px] font-bold text-gray-400 uppercase">২. সার্টিফিকেটের স্ক্যান কপি আপলোড *</label>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const compressed = await compressImage(file, 1200, 0.8);
                                if (compressed) {
                                  updateAttachedCertificateImage(certIndex, compressed);
                                }
                              }}
                              className="w-full text-xs text-gray-500 bg-white border border-gray-150 rounded-lg p-0.5"
                            />
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
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black text-purple-800 uppercase tracking-wider bg-purple-50 px-2.5 py-0.5 rounded border border-purple-200">
                              ✍️ এই সার্টিফিকেটের সত্যায়নকারী কর্মকর্তাদের তথ্য (Attestation Signatures Log)
                            </span>
                            <button
                              type="button"
                              onClick={() => addAttestationToCertificate(certIndex)}
                              className="text-[9.5px] font-black text-purple-700 bg-purple-50 hover:bg-purple-100 px-2.5 py-1 rounded-lg border border-purple-200 flex items-center gap-0.5 cursor-pointer active:scale-95"
                            >
                              ➕ কর্মকর্তা যোগ করুন
                            </button>
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

                                <span className="text-[9.5px] font-bold text-purple-700 uppercase">কর্মকর্তা #{attIndex + 1} সত্যায়ন বিবরণ</span>

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
                                      value={attAction.type || 'Attested'}
                                      onChange={(e) => updateCertificateAttestation(certIndex, attIndex, 'type', e.target.value)}
                                      className="w-full px-2 py-1 text-xs border border-gray-200 bg-white rounded outline-none font-bold"
                                    >
                                      <option value="Attested">Attested (সত্যায়িত)</option>
                                      <option value="Verified and found correct">Verified and found correct (যাচাইকৃত)</option>
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
                  country: certForm.country || 'Target Country',
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

      {/* 3. SYSTEM SETTINGS PANEL */}
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
