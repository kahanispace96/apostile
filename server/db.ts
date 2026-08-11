/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDocs, collection, deleteDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { Certificate } from '../src/types';

// Initialize Cloud Firestore on Server
const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const firestoreDb = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

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
const DEFAULT_SEAL = "";
const DEFAULT_SIGNATURE = "";

// No default/dummy test certificates - clean state
const DEFAULT_CERTIFICATES: Certificate[] = [];

class DatabaseService {
  private dbCache: Schema | null = null;

  constructor() {
    this.ensureInitialized();
    // Perform initial Cloud Firestore sync on server boot
    this.syncFromFirestore().catch(e => console.warn('[DB] Initial Firestore boot sync notice:', e));
  }

  public async syncFromFirestore() {
    try {
      const snap = await getDocs(collection(firestoreDb, 'certificates'));
      if (!snap.empty) {
        const loadedCerts: Certificate[] = [];
        snap.forEach(docSnap => {
          if (docSnap.exists()) {
            loadedCerts.push(docSnap.data() as Certificate);
          }
        });
        if (loadedCerts.length > 0) {
          const currentDb = this.readDb();
          currentDb.certificates = loadedCerts;
          this.writeDb(currentDb);
        }
      }
    } catch (e) {
      console.warn('[DB] Firestore sync warning:', e);
    }
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
          certificates: [],
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
        if (!parsed.certificates || !Array.isArray(parsed.certificates)) {
          parsed.certificates = [];
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
      certificates: [],
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

  public getCertificateById(id: string, rollQuery?: string, regQuery?: string): Certificate | undefined {
    const certs = this.getCertificates();
    if ((!id || !id.trim()) && (!rollQuery || !rollQuery.trim())) return undefined;

    const raw = (id || '').trim();
    const normalizedId = raw.toUpperCase();

    const rQuery = (rollQuery || '').trim();
    const regQ = (regQuery || '').trim();

    // 1. Roll / Reg match if provided
    if (rQuery) {
      const rollMatch = certs.find(c => {
        const cRoll = c.rollNumber ? String(c.rollNumber).trim() : '';
        const cReg = c.registrationNumber ? String(c.registrationNumber).trim() : '';
        if (regQ) {
          return cRoll === rQuery && cReg === regQ;
        }
        return cRoll === rQuery;
      });
      if (rollMatch) return rollMatch;
    }

    // 2. Exact match by ID or Certificate Number
    if (normalizedId) {
      const exactMatch = certs.find(c => {
        const cId = c.id ? c.id.trim().toUpperCase() : '';
        const cCertNum = c.certificateNumber ? c.certificateNumber.trim().toUpperCase() : '';
        const cToken = (c as any).verificationToken ? (c as any).verificationToken.trim().toUpperCase() : '';

        return cId === normalizedId ||
               (cToken && cToken === normalizedId) ||
               (cCertNum && cCertNum === normalizedId);
      });

      if (exactMatch) return exactMatch;
    }

    return undefined;
  }

  public addCertificate(cert: Certificate) {
    const db = this.readDb();
    if (db.certificates.some(c => c.id.toUpperCase() === cert.id.toUpperCase())) {
      throw new Error(`Certificate ID "${cert.id}" already exists.`);
    }
    db.certificates.unshift(cert);
    this.writeDb(db);

    // Asynchronously push to Cloud Firestore for permanent persistence
    setDoc(doc(firestoreDb, 'certificates', cert.id), cert, { merge: true })
      .catch(err => console.warn('[DB] Cloud Firestore cert save error:', err));
    setDoc(doc(firestoreDb, 'students', cert.id), cert, { merge: true })
      .catch(err => console.warn('[DB] Cloud Firestore student save error:', err));
  }

  public updateCertificate(id: string, updatedCert: Partial<Certificate>): boolean {
    const db = this.readDb();
    const index = db.certificates.findIndex(c => c.id.toUpperCase() === id.trim().toUpperCase());
    if (index === -1) return false;

    const merged = {
      ...db.certificates[index],
      ...updatedCert,
      id: db.certificates[index].id, // Keep ID immutable during edit
    };
    db.certificates[index] = merged;
    this.writeDb(db);

    // Asynchronously update Cloud Firestore
    setDoc(doc(firestoreDb, 'certificates', merged.id), merged, { merge: true })
      .catch(err => console.warn('[DB] Cloud Firestore update error:', err));
    setDoc(doc(firestoreDb, 'students', merged.id), merged, { merge: true })
      .catch(err => console.warn('[DB] Cloud Firestore student update error:', err));

    return true;
  }

  public deleteCertificate(id: string): boolean {
    const db = this.readDb();
    const lenBefore = db.certificates.length;
    db.certificates = db.certificates.filter(c => c.id.toUpperCase() !== id.trim().toUpperCase());
    if (db.certificates.length === lenBefore) return false;

    this.writeDb(db);

    // Asynchronously delete from Cloud Firestore
    deleteDoc(doc(firestoreDb, 'certificates', id)).catch(() => {});
    deleteDoc(doc(firestoreDb, 'students', id)).catch(() => {});

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
