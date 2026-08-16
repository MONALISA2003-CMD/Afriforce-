'use client';

import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// These NEXT_PUBLIC_ values are safe to expose in the browser — they
// identify the Firebase project, they aren't secrets. Access control is
// enforced server-side (see lib/firebaseAdmin.js's verifyRequest and the
// role checks in each API route), not by hiding this config.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Only the Auth SDK is initialized here — deliberately. The browser never
// talks to Firestore directly in this app; every read/write goes through
// our API routes, which use the Admin SDK server-side. That means there
// are no Firestore security rules to get right (or wrong) for data
// access — the same ownership/role checks that used to live in Prisma
// queries now live in the route handlers instead.
export const auth = getAuth(app);
