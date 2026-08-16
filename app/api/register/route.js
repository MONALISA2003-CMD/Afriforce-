import { NextResponse } from 'next/server';
import { adminAuth, db, verifyRequest } from '@/lib/firebaseAdmin';

// Custom claims (like role) can only be set with the Admin SDK, so the
// flow is: client calls Firebase Auth directly to create the account
// (createUserWithEmailAndPassword), then calls this route with the
// resulting ID token to assign a role. The client must then force-refresh
// its ID token (getIdToken(true)) to see the new claim.
//
// "admin" is never accepted here — see README "Promoting an admin" for
// how to assign that role out-of-band.
export async function POST(req) {
  const decoded = await verifyRequest(req);
  if (!decoded) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const role = body?.role === 'employer' ? 'employer' : 'seeker';

  await adminAuth.setCustomUserClaims(decoded.uid, { role });
  await db.collection('users').doc(decoded.uid).set(
    { email: decoded.email || '', role, createdAt: new Date().toISOString() },
    { merge: true },
  );

  return NextResponse.json({ uid: decoded.uid, role });
}
