import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Server-only. Never import this file from a Client Component — it reads
// the service account private key from process.env.

function getServiceAccount() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Env vars can't hold real newlines cleanly, so the private key is
  // stored with literal "\n" and converted back here.
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase Admin credentials are not fully configured. ' +
      'Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in .env.',
    );
  }
  return { projectId, clientEmail, privateKey };
}

const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(getServiceAccount()) });

export const adminAuth = getAuth(app);
export const db = getFirestore(app);

// Verifies the Firebase ID token from an `Authorization: Bearer <token>`
// header. Returns the decoded token (uid, email, and any custom claims
// like role) or null if the header is missing or the token is invalid —
// callers should treat null as "not signed in" and respond 401.
export async function verifyRequest(req) {
  const authHeader = req.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) return null;
  try {
    return await adminAuth.verifyIdToken(match[1]);
  } catch (e) {
    return null;
  }
}
