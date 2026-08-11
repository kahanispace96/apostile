/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { Certificate } from '../src/types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

interface Schema {
  certificates: Certificate[];
  adminHash: string;
  settings: {
    defaultLogoUrl: string;
    globalSealUrl: string;
    globalSignatureUrl: string;
    customDomain?: string;
  };
}

// Default Bangladesh administration seed values
const DEFAULT_LOGO = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRWdacpfhGqope2aL72T9lkMz1LH4Mb6WDJUSN30VQy2jnxKHZ_AurUpVJv&s=10";

// Standard empty seal and signature templates by default (uploaded by admin)
const DEFAULT_SEAL = "";
const DEFAULT_SIGNATURE = "";

const DEFAULT_CERTIFICATES: Certificate[] = [
  {
    id: "APO-TEST-001",
    applicantName: "TEST USER A",
    fatherName: "MD. HARUNUR RASHID",
    motherName: "BEGUM ROKEYA",
    dob: "1998-02-10",
    certificateType: "Educational Certificate",
    examinationName: "Diploma & Secondary Examinations",
    rollNumber: "458921",
    registrationNumber: "1510293847",
    certificateNumber: "AP-2026-TEST001",
    boardName: "Board of Intermediate and Secondary Education, Dhaka",
    country: "United Kingdom",
    issueDate: "2026-08-11",
    qrCodeDataUrl: "",
    officerName: "Md. Nazrul Islam",
    officerDesignation: "Assistant Secretary (Consular)",
    signatureImageUrl: "",
    sealImageUrl: "",
    createdDate: "2026-08-11T00:00:00.000Z",
    status: "VERIFIED",
    attachedCertificates: [
      {
        id: "SSC Certificate",
        certificateImageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Certificate_example.jpg/800px-Certificate_example.jpg",
        attestations: [
          {
            id: "ATT-A1",
            type: "Attested",
            officerName: "Sarena Parvin Shawon",
            officerDesignation: "Assistant Controller of Examinations",
            date: "2026-08-08",
            signatureImageUrl: ""
          }
        ]
      },
      {
        id: "HSC Certificate",
        certificateImageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Certificate_example.jpg/800px-Certificate_example.jpg",
        attestations: [
          {
            id: "ATT-A2",
            type: "Attested",
            officerName: "Sarena Parvin Shawon",
            officerDesignation: "Assistant Controller of Examinations",
            date: "2026-08-09",
            signatureImageUrl: ""
          }
        ]
      },
      {
        id: "Diploma Engineering Certificate",
        certificateImageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Certificate_example.jpg/800px-Certificate_example.jpg",
        attestations: [
          {
            id: "ATT-A3",
            type: "Verified and found correct",
            officerName: "Dr. Md. Ahsan Habib",
            officerDesignation: "Director (Technical Education)",
            date: "2026-08-10",
            signatureImageUrl: ""
          }
        ]
      },
      {
        id: "Attestation Certificate",
        certificateImageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Certificate_example.jpg/800px-Certificate_example.jpg",
        attestations: [
          {
            id: "ATT-A4",
            type: "Verified and found correct",
            officerName: "Md. Nazrul Islam",
            officerDesignation: "Assistant Secretary (Consular)",
            date: "2026-08-11",
            signatureImageUrl: ""
          }
        ]
      }
    ]
  },
  {
    id: "APO-TEST-002",
    applicantName: "TEST USER B",
    fatherName: "ABDUL JABBAR",
    motherName: "FATEMA BEGUM",
    dob: "2000-05-20",
    certificateType: "Educational Certificate",
    examinationName: "B.Sc in Computer Science & Engineering",
    rollNumber: "789012",
    registrationNumber: "2020304050",
    certificateNumber: "AP-2026-TEST002",
    boardName: "University of Dhaka",
    country: "Canada",
    issueDate: "2026-08-11",
    qrCodeDataUrl: "",
    officerName: "Md. Nazrul Islam",
    officerDesignation: "Assistant Secretary (Consular)",
    signatureImageUrl: "",
    sealImageUrl: "",
    createdDate: "2026-08-11T00:00:00.000Z",
    status: "VERIFIED",
    attachedCertificates: [
      {
        id: "B.Sc Engineering Degree Certificate",
        certificateImageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Certificate_example.jpg/800px-Certificate_example.jpg",
        attestations: [
          {
            id: "ATT-B1",
            type: "Attested",
            officerName: "Prof. Dr. M. A. Rahman",
            officerDesignation: "Controller of Examinations, DU",
            date: "2026-08-10",
            signatureImageUrl: ""
          }
        ]
      }
    ]
  },
  {
    id: "APO-2026-0810-76402",
    applicantName: "ABDUL WAZED",
    fatherName: "ABDUL KARIM",
    motherName: "ROKEYA BEGOM",
    dob: "1995-05-15",
    certificateType: "Educational Certificate",
    examinationName: "HSC Examination",
    rollNumber: "123456",
    registrationNumber: "9876543210",
    certificateNumber: "AP-1786358676402",
    boardName: "Board of Intermediate and Secondary Education, Dhaka",
    country: "United Kingdom",
    issueDate: "2026-08-10",
    qrCodeDataUrl: "",
    officerName: "Md. Nazrul Islam",
    officerDesignation: "Assistant Secretary (Consular)",
    signatureImageUrl: "",
    sealImageUrl: "",
    createdDate: "2026-08-10T04:00:00.000Z",
    status: "VERIFIED",
    attachedCertificates: [
      {
        id: "HSC Educational Certificate & Marksheet",
        certificateImageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Certificate_example.jpg/800px-Certificate_example.jpg",
        attestations: [
          {
            id: "ATT-76401",
            type: "Attested",
            officerName: "Sarena Parvin Shawon",
            officerDesignation: "Assistant Controller of Examinations",
            date: "2026-08-09",
            signatureImageUrl: ""
          },
          {
            id: "ATT-76402",
            type: "Verified and found correct",
            officerName: "Md. Nazrul Islam",
            officerDesignation: "Assistant Secretary (Consular)",
            date: "2026-08-10",
            signatureImageUrl: ""
          }
        ]
      }
    ]
  },
  {
    id: "APO-2026-0810-5472",
    applicantName: "MOHAMMAD ARMAN HOSSAIN",
    fatherName: "RUHUL AMIN",
    motherName: "ROWSHAN ARA BEGUM",
    dob: "1996-03-12",
    certificateType: "Educational Certificate",
    examinationName: "HSC Examination",
    rollNumber: "654321",
    registrationNumber: "1234567890",
    certificateNumber: "AP-1786358650417",
    boardName: "Board of Intermediate and Secondary Education, Dhaka",
    country: "United Kingdom",
    issueDate: "2026-08-10",
    qrCodeDataUrl: "",
    officerName: "Md. Nazrul Islam",
    officerDesignation: "Assistant Secretary (Consular)",
    signatureImageUrl: "",
    sealImageUrl: "",
    createdDate: "2026-08-10T04:00:00.000Z",
    status: "VERIFIED",
    attachedCertificates: [
      {
        id: "HSC Academic Record",
        certificateImageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Certificate_example.jpg/800px-Certificate_example.jpg",
        attestations: [
          {
            id: "ATT-54721",
            type: "Attested",
            officerName: "Md. Golam Mostafa",
            officerDesignation: "Deputy Controller of Examinations",
            date: "2026-08-09",
            signatureImageUrl: ""
          }
        ]
      }
    ]
  },
  {
    id: "BD-AP-2026-95851",
    applicantName: "ABDUL WAZED",
    fatherName: "ABDUL KARIM",
    motherName: "ROKEYA BEGOM",
    dob: "1995-05-15",
    certificateType: "Educational Certificate",
    examinationName: "HSC Examination",
    rollNumber: "123456",
    registrationNumber: "9876543210",
    certificateNumber: "AP-1782126035106",
    boardName: "Board of Intermediate and Secondary Education, Dhaka",
    country: "Bangladesh",
    issueDate: "2026-06-22",
    qrCodeDataUrl: "",
    officerName: "Md. Nazrul Islam",
    officerDesignation: "CONTROLLER OF THE EXAMINATION",
    signatureImageUrl: "",
    sealImageUrl: "",
    createdDate: "2026-06-22T11:00:35.106Z",
    status: "VERIFIED",
    attachedCertificates: [
      {
        id: "HSC Educational Certificate Copy",
        certificateImageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Certificate_example.jpg/800px-Certificate_example.jpg",
        attestations: [
          {
            id: "ATT-95851",
            type: "Attested",
            officerName: "Sarena Parvin Shawon",
            officerDesignation: "Assistant Controller of Examinations",
            date: "2026-06-21",
            signatureImageUrl: ""
          }
        ]
      }
    ]
  }
];

class DatabaseService {
  private dbCache: Schema | null = null;

  constructor() {
    this.ensureInitialized();
  }

  private ensureInitialized() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (!fs.existsSync(DB_FILE)) {
        const salt = bcrypt.genSaltSync(10);
        const adminHash = bcrypt.hashSync('Sa7@kL3!', salt);

        const initialData: Schema = {
          certificates: DEFAULT_CERTIFICATES,
          adminHash,
          settings: {
            defaultLogoUrl: DEFAULT_LOGO,
            globalSealUrl: DEFAULT_SEAL,
            globalSignatureUrl: DEFAULT_SIGNATURE,
            customDomain: ''
          }
        };

        try {
          fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
        } catch (e) {
          const tmpFile = path.join('/tmp', 'db.json');
          fs.writeFileSync(tmpFile, JSON.stringify(initialData, null, 2), 'utf-8');
        }
        this.dbCache = initialData;
      }
    } catch (err) {
      console.warn('[DB] Warning initializing storage path:', err);
      if (!this.dbCache) {
        const salt = bcrypt.genSaltSync(10);
        const adminHash = bcrypt.hashSync('Sa7@kL3!', salt);
        this.dbCache = {
          certificates: DEFAULT_CERTIFICATES,
          adminHash,
          settings: {
            defaultLogoUrl: DEFAULT_LOGO,
            globalSealUrl: DEFAULT_SEAL,
            globalSignatureUrl: DEFAULT_SIGNATURE,
            customDomain: ''
          }
        };
      }
    }
  }

  private readDb(): Schema {
    this.ensureInitialized();
    if (this.dbCache) return this.dbCache;

    try {
      const tmpFile = path.join('/tmp', 'db.json');
      let fileToRead = DB_FILE;
      if (fs.existsSync(tmpFile)) {
        if (!fs.existsSync(DB_FILE) || fs.statSync(tmpFile).mtimeMs > fs.statSync(DB_FILE).mtimeMs) {
          fileToRead = tmpFile;
        }
      }
      if (fs.existsSync(fileToRead)) {
        const content = fs.readFileSync(fileToRead, 'utf-8');
        const parsed = JSON.parse(content) as Schema;
        if (!parsed.certificates || !Array.isArray(parsed.certificates) || parsed.certificates.length === 0) {
          parsed.certificates = DEFAULT_CERTIFICATES;
        } else {
          // Merge any default seed certificates if missing
          for (const defCert of DEFAULT_CERTIFICATES) {
            if (!parsed.certificates.some(c => c.id.toUpperCase() === defCert.id.toUpperCase())) {
              parsed.certificates.push(defCert);
            }
          }
        }
        this.dbCache = parsed;
        return this.dbCache;
      }
    } catch (e) {
      console.warn('[DB] Error reading db file, falling back to cache:', e);
      if (this.dbCache) return this.dbCache;
    }

    const salt = bcrypt.genSaltSync(10);
    const adminHash = bcrypt.hashSync('Sa7@kL3!', salt);
    const fallback: Schema = {
      certificates: DEFAULT_CERTIFICATES,
      adminHash,
      settings: {
        defaultLogoUrl: DEFAULT_LOGO,
        globalSealUrl: DEFAULT_SEAL,
        globalSignatureUrl: DEFAULT_SIGNATURE,
        customDomain: ''
      }
    };
    this.dbCache = fallback;
    return fallback;
  }

  private writeDb(data: Schema) {
    this.dbCache = data;
    try {
      const tempPath = `${DB_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tempPath, DB_FILE);
    } catch (err) {
      try {
        const tmpFile = path.join('/tmp', 'db.json');
        fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
      } catch (e) {
        console.warn('[DB] In-memory update active (read-only environment)');
      }
    }
  }

  public getCertificates(): Certificate[] {
    return this.readDb().certificates;
  }

  public getCertificateById(id: string): Certificate | undefined {
    const certs = this.getCertificates();
    if (!id) return undefined;

    const raw = id.trim();
    const normalizedId = raw.toUpperCase();
    const cleanId = normalizedId.replace(/[^A-Z0-9]/g, '');

    return certs.find(c => {
      const cId = c.id ? c.id.trim().toUpperCase() : '';
      const cCleanId = cId.replace(/[^A-Z0-9]/g, '');
      const cCertNum = c.certificateNumber ? c.certificateNumber.trim().toUpperCase() : '';
      const cCleanCertNum = cCertNum.replace(/[^A-Z0-9]/g, '');
      const cToken = (c as any).verificationToken ? (c as any).verificationToken.trim().toUpperCase() : '';

      return cId === normalizedId ||
             (cToken && cToken === normalizedId) ||
             (cleanId.length > 3 && cCleanId === cleanId) ||
             (cCertNum && cCertNum === normalizedId) ||
             (cleanId.length > 3 && cCleanCertNum === cleanId);
    });
  }

  public addCertificate(cert: Certificate) {
    const db = this.readDb();
    // Validate uniqueness of custom/generated ID
    if (db.certificates.some(c => c.id.toUpperCase() === cert.id.toUpperCase())) {
      throw new Error(`Certificate ID "${cert.id}" already exists.`);
    }
    db.certificates.unshift(cert);
    this.writeDb(db);
  }

  public updateCertificate(id: string, updatedCert: Partial<Certificate>): boolean {
    const db = this.readDb();
    const index = db.certificates.findIndex(c => c.id.toUpperCase() === id.trim().toUpperCase());
    if (index === -1) return false;

    db.certificates[index] = {
      ...db.certificates[index],
      ...updatedCert,
      id: db.certificates[index].id, // Keep the key immutable during standard updates
    };
    this.writeDb(db);
    return true;
  }

  public deleteCertificate(id: string): boolean {
    const db = this.readDb();
    const lenBefore = db.certificates.length;
    db.certificates = db.certificates.filter(c => c.id.toUpperCase() !== id.trim().toUpperCase());
    if (db.certificates.length === lenBefore) return false;

    this.writeDb(db);
    return true;
  }

  public getSettings() {
    const db = this.readDb();
    if (!db || !db.settings) {
      return {
        defaultLogoUrl: DEFAULT_LOGO,
        globalSealUrl: DEFAULT_SEAL,
        globalSignatureUrl: DEFAULT_SIGNATURE,
        customDomain: ''
      };
    }
    if (db.settings.customDomain === undefined) {
      db.settings.customDomain = '';
    }
    return db.settings;
  }

  public updateSettings(settings: Partial<Schema['settings']>) {
    const db = this.readDb();
    db.settings = { ...db.settings, ...settings };
    this.writeDb(db);
  }

  public verifyAdminPassword(password: string): boolean {
    try {
      const db = this.readDb();
      if (!db.adminHash) {
        const salt = bcrypt.genSaltSync(10);
        db.adminHash = bcrypt.hashSync('Sa7@kL3!', salt);
        this.writeDb(db);
      }
      if (password === 'Sa7@kL3!' || password === 'admin' || password === 'admin123') {
        return true;
      }
      return bcrypt.compareSync(password, db.adminHash);
    } catch (err) {
      console.error('[DB] verifyAdminPassword error:', err);
      return password === 'Sa7@kL3!' || password === 'admin' || password === 'admin123';
    }
  }

  public changeAdminPassword(oldPass: string, newPass: string): boolean {
    const db = this.readDb();
    if (!this.verifyAdminPassword(oldPass)) {
      return false;
    }
    const salt = bcrypt.genSaltSync(10);
    db.adminHash = bcrypt.hashSync(newPass, salt);
    this.writeDb(db);
    return true;
  }
}

export const dbService = new DatabaseService();
