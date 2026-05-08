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
import { ref, uploadBytes, getDownloadURL, deleteObject, listAll, getBytes } from 'firebase/storage';
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

/**
 * Recursively enumerate every file stored under a case in Firebase Storage.
 * Returns paths relative to the case root (e.g. "audit/errors.jsonl"), suitable
 * for passing back to {@link downloadCaseFile}.
 *
 * Firebase Storage's `listAll` is non-paginated and returns up to 1000 entries
 * per directory — fine for typical forensic case sizes (artifacts are organised
 * into a small handful of subdirs). For larger directories use the paginated
 * `list()` API; not needed here yet.
 */
export async function listCaseFiles(userId: string, caseId: string): Promise<string[]> {
  const storage = getFirebaseStorage();
  const rootPath = `users/${userId}/cases/${caseId}`;
  const collected: string[] = [];

  async function walk(prefix: string): Promise<void> {
    const r = ref(storage, prefix);
    const res = await listAll(r);
    for (const item of res.items) {
      // item.fullPath is absolute in the bucket — strip rootPath + leading slash
      collected.push(item.fullPath.slice(rootPath.length + 1));
    }
    // Recurse into subdirectories (Firebase Storage returns these as `prefixes`)
    for (const sub of res.prefixes) {
      await walk(sub.fullPath);
    }
  }

  await walk(rootPath);
  return collected;
}

/**
 * Download a single case file as raw bytes. Path is relative to the case root,
 * matching what {@link listCaseFiles} returns and {@link uploadCaseFile} accepts.
 */
export async function downloadCaseFile(
  userId: string,
  caseId: string,
  filePath: string
): Promise<Uint8Array> {
  const storage = getFirebaseStorage();
  const fileRef = ref(storage, `users/${userId}/cases/${caseId}/${filePath}`);
  const buf = await getBytes(fileRef);
  return new Uint8Array(buf);
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
