import { NextResponse } from 'next/server';
import { db, verifyRequest } from '@/lib/firebaseAdmin';

// Returns the signed-in employer's own organization: name, invite code
// (so the owner can share it), and the member list. Scoped entirely by
// the orgId custom claim on the verified token — there's no way to pass
// a different org's id and read someone else's team.
export async function GET(req) {
  const decoded = await verifyRequest(req);
  if (!decoded) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (decoded.role !== 'employer' || !decoded.orgId) {
    return NextResponse.json({ error: 'This account isn\u2019t part of an organization.' }, { status: 403 });
  }

  const orgDoc = await db.collection('organizations').doc(decoded.orgId).get();
  if (!orgDoc.exists) {
    return NextResponse.json({ error: 'Organization not found.' }, { status: 404 });
  }

  const membersSnap = await db.collection('organizations').doc(decoded.orgId).collection('members').get();
  const members = membersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  members.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0));

  return NextResponse.json({ id: orgDoc.id, name: orgDoc.data().name, inviteCode: orgDoc.data().inviteCode, members });
}
