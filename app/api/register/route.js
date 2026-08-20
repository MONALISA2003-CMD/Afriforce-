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
//
// Employer accounts also get an organization. There's no email-sending
// infrastructure wired up in this build, so team growth works via a
// shareable invite code rather than emailed invitations: the first
// employer at a company creates an org and gets a code; teammates enter
// that code at signup to join the same org instead of creating their own.
// A real invite-email flow is a reasonable next step, not a redesign of
// this data model.

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

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
  let orgId = null;
  let orgError = null;

  if (role === 'employer') {
    const inviteCode = String(body?.inviteCode || '').trim().toUpperCase();

    if (inviteCode) {
      const orgSnap = await db.collection('organizations').where('inviteCode', '==', inviteCode).limit(1).get();
      if (orgSnap.empty) {
        orgError = 'That invite code wasn\u2019t recognized. Check it with your teammate, or leave it blank to create a new organization.';
      } else {
        const orgDoc = orgSnap.docs[0];
        orgId = orgDoc.id;
        await db.collection('organizations').doc(orgId).collection('members').doc(decoded.uid).set({
          email: decoded.email || '', role: 'member', joinedAt: new Date().toISOString(),
        });
      }
    }

    if (!orgId && !orgError) {
      const orgName = String(body?.orgName || '').trim().slice(0, 200)
        || `${(decoded.email || 'New').split('@')[0]}'s organization`;
      const newOrgRef = await db.collection('organizations').add({
        name: orgName,
        ownerId: decoded.uid,
        inviteCode: generateInviteCode(),
        createdAt: new Date().toISOString(),
      });
      orgId = newOrgRef.id;
      await db.collection('organizations').doc(orgId).collection('members').doc(decoded.uid).set({
        email: decoded.email || '', role: 'owner', joinedAt: new Date().toISOString(),
      });
    }

    if (orgError) {
      return NextResponse.json({ error: orgError }, { status: 400 });
    }
  }

  const claims = { role };
  if (orgId) claims.orgId = orgId;

  await adminAuth.setCustomUserClaims(decoded.uid, claims);
  await db.collection('users').doc(decoded.uid).set(
    { email: decoded.email || '', role, orgId: orgId || null, createdAt: new Date().toISOString() },
    { merge: true },
  );

  return NextResponse.json({ uid: decoded.uid, role, orgId });
}
