/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AttestationItem {
  id: string;
  type: 'Verified and found correct' | 'Attested';
  officerName: string;
  officerDesignation: string;
  date: string;
  signatureImageUrl: string;
}

export interface AttachedCertificate {
  id: string;
  certificateImageUrl: string; // Base64 of the uploaded certificate image
  attestations: AttestationItem[];
}

export interface Certificate {
  id: string; // The Unique Verification ID, e.g. BD-AP-2026-89410
  applicantName: string;
  fatherName: string;
  motherName: string;
  dob: string;
  certificateType: string; // e.g. Educational Certificate, Birth Certificate, etc.
  examinationName?: string;
  rollNumber?: string;
  registrationNumber?: string;
  certificateNumber: string;
  boardName?: string;
  country: string;
  issueDate: string;
  qrCodeDataUrl?: string; // QR code representation
  officerName: string; // e.g. MD. RASHID ABID
  officerDesignation: string; // e.g. Assistant Secretary, Ministry of Foreign Affairs
  signatureImageUrl?: string; // Main Apostille officer base64 signature
  sealImageUrl?: string; // Main Apostille circular seal image
  createdDate: string;
  status: 'VERIFIED' | 'REVOKED' | 'EXPIRED';
  attachedCertificates?: AttachedCertificate[]; // Dynamic uploaded certificates & attestation chains
  fullyAttestedDocumentUrl?: string; // Scanned PDF/Image file copy of fully attested physical paper
}

export interface AdminSession {
  token: string;
  username: string;
  expiresAt: number;
}

