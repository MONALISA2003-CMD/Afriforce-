import { NextResponse } from 'next/server';
import { db, verifyRequest } from '@/lib/firebaseAdmin';

// The first piece of genuinely shared organization data (previously,
// org membership existed but nothing members did was actually shared —
// see the README/deck "Honest Gaps" history on this). A saved search is
// visible to every member of the org that ran it, not just the person
// who ran it, scoped entirely by the orgId custom claim — there's no
// way to read another organization's search history.

export async function GET(req) {
  const decoded = await verifyRequest(req);
  if (!decoded) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (decoded.role !== 'employer' || !decoded.orgId) {
    return NextResponse.json({ error: 'This account isn\u2019t part of an organization.' }, { status: 403 });
  }

  const snap = await db
    .collection('organizations').doc(decoded.orgId).collection('searches')
    .orderBy('createdAt', 'desc').limit(20).get();

  const searches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return NextResponse.json({ searches });
}

export async function POST(req) {
  const decoded = await verifyRequest(req);
  if (!decoded) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (decoded.role !== 'employer' || !decoded.orgId) {
    return NextResponse.json({ error: 'This account isn\u2019t part of an organization.' }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { role, jobDescription, candidateCount } = body || {};
  if (!role) return NextResponse.json({ error: 'role is required.' }, { status: 400 });

  const doc = {
    role: String(role).slice(0, 200),
    summary: String(jobDescription?.summary || '').slice(0, 500),
    candidateCount: Number(candidateCount) || 0,
    searchedBy: decoded.email || decoded.uid,
    createdAt: new Date().toISOString(),
  };

  const ref = await db.collection('organizations').doc(decoded.orgId).collection('searches').add(doc);
  return NextResponse.json({ id: ref.id, ...doc });
}
