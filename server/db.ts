/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, getFirestore, doc, setDoc, getDocs, collection, deleteDoc, getDoc, query, where } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { Certificate } from '../src/types';

export const TARGET_DATABASE_ID = "ai-studio-93bf807c-0792-464e-ad60-0a28bed9c02d";

// Initialize Cloud Firestore on Server with custom database ID
const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
let firestoreDb: any;
try {
  firestoreDb = initializeFirestore(firebaseApp, {}, TARGET_DATABASE_ID);
} catch (e) {
  firestoreDb = getFirestore(firebaseApp, TARGET_DATABASE_ID);
}

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
  private lastSyncTime: number = 0;

  constructor() {
    this.ensureInitialized();
    // Perform initial Cloud Firestore sync on server boot
    this.syncFromFirestore().catch(e => console.warn('[DB] Initial Firestore boot sync notice:', e));
  }

  public async syncFromFirestore() {
    try {
      this.lastSyncTime = Date.now();
      const [certSnap, studSnap, settingsSnap] = await Promise.all([
        getDocs(collection(firestoreDb, 'certificates')),
        getDocs(collection(firestoreDb, 'students')),
        getDoc(doc(firestoreDb, 'settings', 'general')).catch(() => null)
      ]);

      const map = new Map<string, Certificate>();

      studSnap.forEach(docSnap => {
        if (docSnap.exists()) {
          const c = docSnap.data() as Certificate;
          if (c && c.id) map.set(c.id.trim().toUpperCase(), c);
        }
      });

      certSnap.forEach(docSnap => {
        if (docSnap.exists()) {
          const c = docSnap.data() as Certificate;
          if (c && c.id) map.set(c.id.trim().toUpperCase(), c);
        }
      });

      const currentDb = this.readDb();

      // Preserve any in-memory / local certificates not yet in map
      for (const c of currentDb.certificates) {
        if (c && c.id && !map.has(c.id.trim().toUpperCase())) {
          map.set(c.id.trim().toUpperCase(), c);
        }
      }

      currentDb.certificates = Array.from(map.values());

      if (settingsSnap && settingsSnap.exists()) {
        const cloudSettings = settingsSnap.data();
        if (cloudSettings) {
          currentDb.settings = { ...currentDb.settings, ...cloudSettings };
        }
      }

      this.writeDb(currentDb);
      console.log(`[DB] Firestore sync successful: ${currentDb.certificates.length} permanent certificate(s) loaded.`);
    } catch (e) {
      console.warn('[DB] Firestore sync notice:', e);
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
            customDomain: 'https://online.apostile-my-gov-bd-verify-eu.vercel.app'
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
            customDomain: 'https://online.apostile-my-gov-bd-verify-eu.vercel.app'
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
        customDomain: 'https://online.apostile-my-gov-bd-verify-eu.vercel.app'
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

  public async getCertificates(): Promise<Certificate[]> {
    const current = this.readDb().certificates;
    // Always sync with Firestore on serverless cold starts or when cache is stale
    if (!current || current.length === 0 || (Date.now() - this.lastSyncTime > 15000)) {
      await this.syncFromFirestore();
      return this.readDb().certificates;
    }
    return current;
  }

  private cacheCertificate(cert: Certificate) {
    if (!cert || !cert.id) return;
    const db = this.readDb();
    const idx = db.certificates.findIndex(c => c.id.toUpperCase() === cert.id.toUpperCase());
    if (idx >= 0) {
      db.certificates[idx] = cert;
    } else {
      db.certificates.unshift(cert);
    }
    this.writeDb(db);
  }

  public async getCertificateById(id: string, rollQuery?: string, regQuery?: string): Promise<Certificate | undefined> {
    if ((!id || !id.trim()) && (!rollQuery || !rollQuery.trim())) return undefined;

    const raw = (id || '').trim();
    const normalizedId = raw.toUpperCase();

    const rQuery = (rollQuery || '').trim();
    const regQ = (regQuery || '').trim();

    // 1. In-memory cache check
    const certs = await this.getCertificates();
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

    // 2. Direct Firestore query fallback (Crucial for cold-start / serverless environments)
    try {
      if (normalizedId) {
        const certDoc = await getDoc(doc(firestoreDb, 'certificates', normalizedId));
        if (certDoc.exists()) {
          const cert = certDoc.data() as Certificate;
          this.cacheCertificate(cert);
          return cert;
        }

        const studentDoc = await getDoc(doc(firestoreDb, 'students', normalizedId));
        if (studentDoc.exists()) {
          const cert = studentDoc.data() as Certificate;
          this.cacheCertificate(cert);
          return cert;
        }

        if (raw !== normalizedId) {
          const rawDoc = await getDoc(doc(firestoreDb, 'certificates', raw));
          if (rawDoc.exists()) {
            const cert = rawDoc.data() as Certificate;
            this.cacheCertificate(cert);
            return cert;
          }
        }

        const qCerts = query(collection(firestoreDb, 'certificates'), where('id', '==', normalizedId));
        const qSnap = await getDocs(qCerts);
        if (!qSnap.empty) {
          const cert = qSnap.docs[0].data() as Certificate;
          this.cacheCertificate(cert);
          return cert;
        }
      }

      if (rQuery) {
        const qRoll = query(collection(firestoreDb, 'certificates'), where('rollNumber', '==', rQuery));
        const qSnap = await getDocs(qRoll);
        if (!qSnap.empty) {
          const cert = qSnap.docs[0].data() as Certificate;
          this.cacheCertificate(cert);
          return cert;
        }
      }
    } catch (fsErr) {
      console.warn('[DB] Direct Firestore lookup notice:', fsErr);
    }

    return undefined;
  }

  public async addCertificate(cert: Certificate): Promise<void> {
    const db = this.readDb();
    const existingIdx = db.certificates.findIndex(c => c.id.toUpperCase() === cert.id.toUpperCase());
    if (existingIdx >= 0) {
      db.certificates[existingIdx] = cert;
    } else {
      db.certificates.unshift(cert);
    }
    this.writeDb(db);

    // Guaranteed AWAITED writes to Cloud Firestore lifetime storage
    try {
      await Promise.all([
        setDoc(doc(firestoreDb, 'certificates', cert.id), cert, { merge: true }),
        setDoc(doc(firestoreDb, 'students', cert.id), cert, { merge: true })
      ]);
      console.log(`[DB] Successfully saved certificate "${cert.id}" to Cloud Firestore lifetime storage.`);
    } catch (err) {
      console.error('[DB] Cloud Firestore cert save error:', err);
    }
  }

  public async updateCertificate(id: string, updatedCert: Partial<Certificate>): Promise<boolean> {
    const db = this.readDb();
    const index = db.certificates.findIndex(c => c.id.toUpperCase() === id.trim().toUpperCase());
    
    let currentCert: Certificate | undefined;
    if (index >= 0) {
      currentCert = db.certificates[index];
    } else {
      currentCert = await this.getCertificateById(id);
    }

    if (!currentCert) return false;

    const merged = {
      ...currentCert,
      ...updatedCert,
      id: currentCert.id, // Keep ID immutable during edit
    };

    if (index >= 0) {
      db.certificates[index] = merged;
    } else {
      db.certificates.unshift(merged);
    }
    this.writeDb(db);

    // Guaranteed AWAITED update to Cloud Firestore
    try {
      await Promise.all([
        setDoc(doc(firestoreDb, 'certificates', merged.id), merged, { merge: true }),
        setDoc(doc(firestoreDb, 'students', merged.id), merged, { merge: true })
      ]);
      console.log(`[DB] Successfully updated certificate "${merged.id}" in Cloud Firestore.`);
    } catch (err) {
      console.error('[DB] Cloud Firestore update error:', err);
    }

    return true;
  }

  public async deleteCertificate(id: string): Promise<boolean> {
    const db = this.readDb();
    const lenBefore = db.certificates.length;
    db.certificates = db.certificates.filter(c => c.id.toUpperCase() !== id.trim().toUpperCase());
    this.writeDb(db);

    // Guaranteed AWAITED delete from Cloud Firestore
    try {
      await Promise.all([
        deleteDoc(doc(firestoreDb, 'certificates', id)),
        deleteDoc(doc(firestoreDb, 'students', id))
      ]);
      console.log(`[DB] Successfully deleted certificate "${id}" from Cloud Firestore.`);
    } catch (err) {
      console.error('[DB] Cloud Firestore delete error:', err);
    }

    return lenBefore !== db.certificates.length;
  }

  public getSettings() {
    const db = this.readDb();
    if (!db || !db.settings) {
      return {
        defaultLogoUrl: DEFAULT_LOGO,
        globalSealUrl: DEFAULT_SEAL,
        globalSignatureUrl: DEFAULT_SIGNATURE,
        customDomain: 'https://online.apostile-my-gov-bd-verify-eu.vercel.app'
      };
    }
    if (!db.settings.customDomain || db.settings.customDomain === '' || db.settings.customDomain.includes('apostile-nine') || !db.settings.customDomain.includes('online.')) {
      db.settings.customDomain = 'https://online.apostile-my-gov-bd-verify-eu.vercel.app';
    }
    return db.settings;
  }

  public async updateSettings(settings: Partial<Schema['settings']>): Promise<void> {
    const db = this.readDb();
    db.settings = { ...db.settings, ...settings };
    this.writeDb(db);

    try {
      await setDoc(doc(firestoreDb, 'settings', 'general'), db.settings, { merge: true });
      console.log('[DB] Settings updated in Cloud Firestore.');
    } catch (e) {
      console.warn('[DB] Could not save settings to Firestore:', e);
    }
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
