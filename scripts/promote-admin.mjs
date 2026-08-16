// Promotes a user to the "admin" role. Registration only ever assigns
// "seeker" or "employer" (see app/api/register/route.js) — admin is
// intentionally not self-service.
//
// Usage:
//   npm run promote-admin -- someone@example.com
//
// Requires the same Firebase Admin env vars as the app itself
// (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) —
// loaded here from .env via dotenv, since this runs outside Next.js.
//
// This is a standalone .mjs file (not importing lib/firebaseAdmin.js) so
// it can run with plain `node`, independent of the Next.js app's module
// setup.

import 'dotenv/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run promote-admin -- someone@example.com');
  process.exit(1);
}

const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
  console.error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY — check your .env.');
  process.exit(1);
}

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey,
  }),
});

const auth = getAuth(app);
const db = getFirestore(app);

try {
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { role: 'admin' });
  await db.collection('users').doc(user.uid).set({ role: 'admin' }, { merge: true });
  console.log(`${email} is now an admin.`);
  console.log('They need to sign out and back in (or wait for their token to refresh, ~1 hour) for it to take effect.');
  process.exit(0);
} catch (e) {
  console.error('Could not promote that user:', e.message);
  process.exit(1);
}
