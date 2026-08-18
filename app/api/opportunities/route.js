import { NextResponse } from 'next/server';
import { db, verifyRequest } from '@/lib/firebaseAdmin';

// A real opportunity store, distinct from the AI-generated preview
// opportunities elsewhere in the app. This is the "Opportunity Service"
// the product docs describe: something that can hold genuinely-sourced
// listings and be queried by the matching engine, with AI used only to
// explain fit — not to invent the listing itself.
//
// There's no live scraper wired in here (that needs its own paid API/
// ToS-compliant source — e.g. a service like Apify's job-board actors —
// and shouldn't be faked). What's real today: admins can add listings
// through this API (see the Admin screen), and anything added here is
// a genuine record, checked before any AI-generated filler, with a
// visible "Verified listing" badge distinguishing it from AI previews.

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const limitParam = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 100);

  const snap = await db
    .collection('opportunities')
    .orderBy('createdAt', 'desc')
    .limit(limitParam)
    .get();

  const opportunities = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return NextResponse.json({ opportunities });
}

export async function POST(req) {
  const decoded = await verifyRequest(req);
  if (!decoded) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (decoded.role !== 'admin') {
    return NextResponse.json({ error: 'Only admin accounts can add opportunities.' }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { title, company, category, location, remote, skills, description, sourceUrl, source } = body || {};
  if (!title || !category) {
    return NextResponse.json({ error: 'title and category are required.' }, { status: 400 });
  }
  if (!['Jobs', 'Freelance', 'Business', 'Learning'].includes(category)) {
    return NextResponse.json({ error: 'category must be one of Jobs, Freelance, Business, Learning.' }, { status: 400 });
  }

  const doc = {
    title: String(title).slice(0, 200),
    company: String(company || '').slice(0, 200),
    category,
    location: String(location || '').slice(0, 200),
    remote: !!remote,
    skills: Array.isArray(skills) ? skills.slice(0, 15).map((s) => String(s).slice(0, 60)) : [],
    description: String(description || '').slice(0, 1000),
    sourceUrl: String(sourceUrl || '').slice(0, 500),
    source: String(source || 'Manually added').slice(0, 200),
    addedBy: decoded.uid,
    createdAt: new Date().toISOString(),
  };

  const ref = await db.collection('opportunities').add(doc);
  return NextResponse.json({ id: ref.id, ...doc });
}
