/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Certificate } from '../types';

/**
 * Strips all undefined fields recursively from an object so Firestore never throws
 * "Function setDoc() called with invalid data. Unsupported field value: undefined"
 */
export function sanitizeForFirestore<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return null as any;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForFirestore(item)) as any;
  }
  if (typeof obj === 'object') {
    const clean: any = {};
    for (const [key, val] of Object.entries(obj)) {
      if (val !== undefined) {
        clean[key] = sanitizeForFirestore(val);
      }
    }
    return clean;
  }
  return obj;
}

/**
 * Permanently saves a certificate to Cloud Firestore across both 'certificates' and 'students' collections.
 * Lifetime persistence guarantee.
 */
export async function saveCertificatePermanently(cert: Certificate): Promise<boolean> {
  if (!cert || !cert.id) return false;
  const cleanId = cert.id.trim().toUpperCase();
  const certToSave: Certificate = {
    ...cert,
    id: cleanId
  };
  const sanitized = sanitizeForFirestore(certToSave);

  try {
    if (db) {
      await Promise.all([
        setDoc(doc(db, 'certificates', cleanId), sanitized, { merge: true }),
        setDoc(doc(db, 'students', cleanId), sanitized, { merge: true })
      ]);
      console.log(`[Firestore] Successfully persisted e-Apostille "${cleanId}" permanently.`);
      return true;
    }
  } catch (err) {
    console.error(`[Firestore] Error saving certificate "${cleanId}":`, err);
  }
  return false;
}

/**
 * Fetches all certificates directly from Firestore to guarantee lifetime persistence.
 */
export async function fetchAllCertificatesFromFirestore(): Promise<Certificate[]> {
  try {
    if (!db) return [];
    const snap = await getDocs(collection(db, 'certificates'));
    const list: Certificate[] = [];
    snap.forEach(docSnap => {
      if (docSnap.exists()) {
        list.push(docSnap.data() as Certificate);
      }
    });
    return list;
  } catch (err) {
    console.warn('[Firestore] Notice fetching all certificates:', err);
    return [];
  }
}

/**
 * Direct stateless lookup for an e-Apostille record from Cloud Firestore.
 */
export async function lookupCertificateFromFirestore(idOrToken: string): Promise<Certificate | null> {
  if (!idOrToken || !idOrToken.trim()) return null;
  const raw = idOrToken.trim();
  const upper = raw.toUpperCase();

  try {
    if (!db) return null;

    // 1. Direct doc lookup by uppercase ID
    const docCert = await getDoc(doc(db, 'certificates', upper));
    if (docCert.exists()) {
      return docCert.data() as Certificate;
    }

    const docStudent = await getDoc(doc(db, 'students', upper));
    if (docStudent.exists()) {
      return docStudent.data() as Certificate;
    }

    // 2. Direct doc lookup by raw case if different
    if (raw !== upper) {
      const docRaw = await getDoc(doc(db, 'certificates', raw));
      if (docRaw.exists()) {
        return docRaw.data() as Certificate;
      }
    }

    // 3. Query by 'id' field
    const qCert = query(collection(db, 'certificates'), where('id', '==', upper));
    const snapCert = await getDocs(qCert);
    if (!snapCert.empty) {
      return snapCert.docs[0].data() as Certificate;
    }

    // 4. Query by 'certificateNumber' field
    const qNum = query(collection(db, 'certificates'), where('certificateNumber', '==', upper));
    const snapNum = await getDocs(qNum);
    if (!snapNum.empty) {
      return snapNum.docs[0].data() as Certificate;
    }

    // 5. Query by rollNumber
    const qRoll = query(collection(db, 'students'), where('rollNumber', '==', raw));
    const snapRoll = await getDocs(qRoll);
    if (!snapRoll.empty) {
      return snapRoll.docs[0].data() as Certificate;
    }
  } catch (err) {
    console.warn('[Firestore] Direct lookup notice:', err);
  }

  return null;
}
