import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export function initFirebase(config: FirebaseConfig) {
  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  return { app, auth, db, storage };
}

export function getFirebaseAuth(): Auth {
  if (!auth) throw new Error('Firebase not initialized. Call initFirebase() first.');
  return auth;
}

export function getFirebaseDb(): Firestore {
  if (!db) throw new Error('Firebase not initialized. Call initFirebase() first.');
  return db;
}

export function getFirebaseStorage(): FirebaseStorage {
  if (!storage) throw new Error('Firebase not initialized. Call initFirebase() first.');
  return storage;
}
