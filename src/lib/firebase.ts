import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const FIRESTORE_DATABASE_ID = "ai-studio-93bf807c-0792-464e-ad60-0a28bed9c02d";

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

let firestoreDb: any;
try {
  firestoreDb = initializeFirestore(app, {}, FIRESTORE_DATABASE_ID);
} catch (e) {
  firestoreDb = getFirestore(app, FIRESTORE_DATABASE_ID);
}

export const db = firestoreDb;

