import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  Unsubscribe,
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { getFirebaseDb, getFirebaseStorage } from './firebase-config';
import { ForensicCase, Acquisition, SyncStatus } from '../types/case';

const CASES_COLLECTION = 'cases';

export async function syncCaseToCloud(userId: string, forensicCase: ForensicCase): Promise<void> {
  const db = getFirebaseDb();
  const caseRef = doc(db, 'users', userId, CASES_COLLECTION, forensicCase.id);
  await setDoc(caseRef, {
    ...forensicCase,
    syncStatus: 'synced' as SyncStatus,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function fetchCaseFromCloud(userId: string, caseId: string): Promise<ForensicCase | null> {
  const db = getFirebaseDb();
  const caseRef = doc(db, 'users', userId, CASES_COLLECTION, caseId);
  const snap = await getDoc(caseRef);
  return snap.exists() ? (snap.data() as ForensicCase) : null;
}

export async function fetchAllCases(userId: string): Promise<ForensicCase[]> {
  const db = getFirebaseDb();
  const casesRef = collection(db, 'users', userId, CASES_COLLECTION);
  const q = query(casesRef, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as ForensicCase);
}

export async function deleteCaseFromCloud(userId: string, caseId: string): Promise<void> {
  const db = getFirebaseDb();
  const caseRef = doc(db, 'users', userId, CASES_COLLECTION, caseId);
  await deleteDoc(caseRef);
}

export async function syncAcquisition(
  userId: string,
  caseId: string,
  acquisition: Acquisition
): Promise<void> {
  const db = getFirebaseDb();
  const acqRef = doc(db, 'users', userId, CASES_COLLECTION, caseId, 'acquisitions', acquisition.id);
  await setDoc(acqRef, acquisition, { merge: true });
}

export async function uploadCaseFile(
  userId: string,
  caseId: string,
  filePath: string,
  fileBuffer: Uint8Array
): Promise<string> {
  const storage = getFirebaseStorage();
  const fileRef = ref(storage, `users/${userId}/cases/${caseId}/${filePath}`);
  await uploadBytes(fileRef, fileBuffer);
  return getDownloadURL(fileRef);
}

export function subscribeToCaseUpdates(
  userId: string,
  onUpdate: (cases: ForensicCase[]) => void
): Unsubscribe {
  const db = getFirebaseDb();
  const casesRef = collection(db, 'users', userId, CASES_COLLECTION);
  const q = query(casesRef, orderBy('updatedAt', 'desc'));
  return onSnapshot(q, (snap) => {
    const cases = snap.docs.map(d => d.data() as ForensicCase);
    onUpdate(cases);
  });
}
