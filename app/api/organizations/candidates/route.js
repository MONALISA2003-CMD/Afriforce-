import { NextResponse } from 'next/server';
import { db, verifyRequest } from '@/lib/firebaseAdmin';

// A shared shortlist, one layer past search history: a candidate one
// teammate finds and saves is visible to the whole org, not just them.
// Same org-scoping pattern as everything else here — orgId comes only
// from the verified token's custom claim, never a client-supplied value.

export async function GET(req) {
  const decoded = await verifyRequest(req);
  if (!decoded) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (decoded.role !== 'employer' || !decoded.orgId) {
    return NextResponse.json({ error: 'This account isn\u2019t part of an organization.' }, { status: 403 });
  }

  const snap = await db
    .collection('organizations').doc(decoded.orgId).collection('candidates')
    .orderBy('savedAt', 'desc').limit(30).get();

  const candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return NextResponse.json({ candidates });
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

  const { name, headline, matchLevel, why, forRole, isReal } = body || {};
  if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 });

  const doc = {
    name: String(name).slice(0, 200),
    headline: String(headline || '').slice(0, 300),
    matchLevel: String(matchLevel || '').slice(0, 60),
    why: String(why || '').slice(0, 500),
    forRole: String(forRole || '').slice(0, 200),
    isReal: !!isReal,
    savedBy: decoded.email || decoded.uid,
    savedAt: new Date().toISOString(),
  };

  const ref = await db.collection('organizations').doc(decoded.orgId).collection('candidates').add(doc);
  return NextResponse.json({ id: ref.id, ...doc });
}
