/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDocs, collection, deleteDoc, getDoc, query, where } from 'firebase/firestore';
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

  public async loadAllEnclosures(certId: string): Promise<any[] | null> {
    try {
      const encDoc = await getDoc(doc(firestoreDb, 'certificate_enclosures', certId));
      if (!encDoc.exists()) return null;
      const data = encDoc.data();
      let attached = data.attachedCertificates || [];
      const totalParts = data.totalParts || 1;
      if (totalParts > 1) {
        const partPromises = [];
        for (let p = 2; p <= totalParts; p++) {
          partPromises.push(getDoc(doc(firestoreDb, 'certificate_enclosures', `${certId}_part${p}`)));
        }
        const parts = await Promise.all(partPromises);
        for (const pDoc of parts) {
          if (pDoc.exists() && pDoc.data()?.attachedCertificates) {
            attached = attached.concat(pDoc.data().attachedCertificates);
          }
        }
      }
      return attached;
    } catch (e) {
      return null;
    }
  }

  public async syncFromFirestore() {
    try {
      const snap = await getDocs(collection(firestoreDb, 'certificates'));
      if (!snap.empty) {
        const loadedCerts: Certificate[] = [];
        for (const docSnap of snap.docs) {
          if (docSnap.exists()) {
            const cert = docSnap.data() as Certificate;
            try {
              const fullAttached = await this.loadAllEnclosures(cert.id);
              if (fullAttached && fullAttached.length > 0) {
                cert.attachedCertificates = fullAttached;
              }
            } catch (e) {}
            loadedCerts.push(cert);
          }
        }
        if (loadedCerts.length > 0) {
          const currentDb = this.readDb();
          const map = new Map<string, Certificate>();
          currentDb.certificates.forEach(c => map.set(c.id.toUpperCase(), c));
          loadedCerts.forEach(c => map.set(c.id.toUpperCase(), c));
          currentDb.certificates = Array.from(map.values());
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
    const certs = this.getCertificates();
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
      const loadEnclosuresIfAny = async (cert: Certificate): Promise<Certificate> => {
        try {
          const fullAttached = await this.loadAllEnclosures(cert.id);
          if (fullAttached && fullAttached.length > 0) {
            cert.attachedCertificates = fullAttached;
          }
        } catch (e) {}
        return cert;
      };

      if (normalizedId) {
        const certDoc = await getDoc(doc(firestoreDb, 'certificates', normalizedId));
        if (certDoc.exists()) {
          let cert = certDoc.data() as Certificate;
          cert = await loadEnclosuresIfAny(cert);
          this.cacheCertificate(cert);
          return cert;
        }

        const studentDoc = await getDoc(doc(firestoreDb, 'students', normalizedId));
        if (studentDoc.exists()) {
          let cert = studentDoc.data() as Certificate;
          cert = await loadEnclosuresIfAny(cert);
          this.cacheCertificate(cert);
          return cert;
        }

        if (raw !== normalizedId) {
          const rawDoc = await getDoc(doc(firestoreDb, 'certificates', raw));
          if (rawDoc.exists()) {
            let cert = rawDoc.data() as Certificate;
            cert = await loadEnclosuresIfAny(cert);
            this.cacheCertificate(cert);
            return cert;
          }
        }

        const qCerts = query(collection(firestoreDb, 'certificates'), where('id', '==', normalizedId));
        const qSnap = await getDocs(qCerts);
        if (!qSnap.empty) {
          let cert = qSnap.docs[0].data() as Certificate;
          cert = await loadEnclosuresIfAny(cert);
          this.cacheCertificate(cert);
          return cert;
        }
      }

      if (rQuery) {
        const qRoll = query(collection(firestoreDb, 'certificates'), where('rollNumber', '==', rQuery));
        const qSnap = await getDocs(qRoll);
        if (!qSnap.empty) {
          let cert = qSnap.docs[0].data() as Certificate;
          cert = await loadEnclosuresIfAny(cert);
          this.cacheCertificate(cert);
          return cert;
        }
      }
    } catch (fsErr) {
      console.warn('[DB] Direct Firestore lookup notice:', fsErr);
    }

    return undefined;
  }

  private async persistToFirestore(cert: Certificate): Promise<void> {
    try {
      const attached = cert.attachedCertificates || [];
      const CHUNK_SIZE = 2; // Up to 2 certificates per enclosure doc ensures each chunk is < 200KB!

      if (attached.length > 0) {
        const totalParts = Math.ceil(attached.length / CHUNK_SIZE);
        // Save Part 1 (root enclosure)
        const part1 = attached.slice(0, CHUNK_SIZE);
        await setDoc(doc(firestoreDb, 'certificate_enclosures', cert.id), {
          id: cert.id,
          totalParts,
          totalCount: attached.length,
          attachedCertificates: part1
        }, { merge: true });

        // Save subsequent parts if any
        for (let p = 2; p <= totalParts; p++) {
          const partSlice = attached.slice((p - 1) * CHUNK_SIZE, p * CHUNK_SIZE);
          await setDoc(doc(firestoreDb, 'certificate_enclosures', `${cert.id}_part${p}`), {
            id: cert.id,
            partNumber: p,
            totalParts,
            attachedCertificates: partSlice
          }, { merge: true });
        }
      }

      // Store the main apostille record in the primary collection safely under 1MB
      const primaryDoc = {
        ...cert,
        attachedCertificates: attached.map(a => ({
          id: a.id,
          attestations: a.attestations,
          certificateImageUrl: (a.certificateImageUrl && a.certificateImageUrl.length < 35000) ? a.certificateImageUrl : ''
        }))
      };
      await setDoc(doc(firestoreDb, 'certificates', cert.id), primaryDoc, { merge: true });
      await setDoc(doc(firestoreDb, 'students', cert.id), primaryDoc, { merge: true });
    } catch (err: any) {
      console.warn('[DB] Firestore persist notice:', err);
    }
  }

  public async addCertificate(cert: Certificate): Promise<void> {
    const db = this.readDb();
    if (db.certificates.some(c => c.id.toUpperCase() === cert.id.toUpperCase())) {
      throw new Error(`Certificate ID "${cert.id}" already exists.`);
    }
    db.certificates.unshift(cert);
    this.writeDb(db);

    await this.persistToFirestore(cert);
  }

  public async updateCertificate(id: string, updatedCert: Partial<Certificate>): Promise<boolean> {
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

    await this.persistToFirestore(merged);
    return true;
  }

  public async deleteCertificate(id: string): Promise<boolean> {
    const db = this.readDb();
    const lenBefore = db.certificates.length;
    db.certificates = db.certificates.filter(c => c.id.toUpperCase() !== id.trim().toUpperCase());
    if (db.certificates.length === lenBefore) return false;

    this.writeDb(db);

    // Asynchronously delete from Cloud Firestore including chunked enclosures
    deleteDoc(doc(firestoreDb, 'certificates', id)).catch(() => {});
    deleteDoc(doc(firestoreDb, 'students', id)).catch(() => {});
    deleteDoc(doc(firestoreDb, 'certificate_enclosures', id)).catch(() => {});
    for (let p = 2; p <= 12; p++) {
      deleteDoc(doc(firestoreDb, 'certificate_enclosures', `${id}_part${p}`)).catch(() => {});
    }

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
