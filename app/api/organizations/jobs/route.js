import { NextResponse } from 'next/server';
import { db, verifyRequest } from '@/lib/firebaseAdmin';

// The last piece of "team hiring": a posted job the whole org can see
// and manage, not just one member's local search result. Same
// org-scoping pattern as searches/candidates — orgId only ever comes
// from the verified token's custom claim.

export async function GET(req) {
  const decoded = await verifyRequest(req);
  if (!decoded) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (decoded.role !== 'employer' || !decoded.orgId) {
    return NextResponse.json({ error: 'This account isn\u2019t part of an organization.' }, { status: 403 });
  }

  const snap = await db
    .collection('organizations').doc(decoded.orgId).collection('jobs')
    .orderBy('createdAt', 'desc').limit(30).get();

  const jobs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return NextResponse.json({ jobs });
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

  const { title, summary, responsibilities, location, workModel } = body || {};
  if (!title) return NextResponse.json({ error: 'title is required.' }, { status: 400 });

  const doc = {
    title: String(title).slice(0, 200),
    summary: String(summary || '').slice(0, 500),
    responsibilities: Array.isArray(responsibilities) ? responsibilities.slice(0, 10).map((r) => String(r).slice(0, 300)) : [],
    location: String(location || '').slice(0, 200),
    workModel: String(workModel || '').slice(0, 60),
    status: 'open',
    postedBy: decoded.email || decoded.uid,
    createdAt: new Date().toISOString(),
  };

  const ref = await db.collection('organizations').doc(decoded.orgId).collection('jobs').add(doc);
  return NextResponse.json({ id: ref.id, ...doc });
}
