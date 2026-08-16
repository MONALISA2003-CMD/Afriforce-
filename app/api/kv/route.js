import { NextResponse } from 'next/server';
import { db, verifyRequest } from '@/lib/firebaseAdmin';

// Same interface as the Prisma-backed version this replaces (see the
// `storage` shim in components/AfriforceApp.jsx) — personal records
// require auth and live under users/{uid}/records/{key}; shared records
// are public-readable but only writable/deletable by whoever created the
// key (ownerId, checked below).

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');
  const shared = searchParams.get('shared') === 'true';
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 });

  if (shared) {
    const doc = await db.collection('sharedRecords').doc(key).get();
    if (!doc.exists) return NextResponse.json(null, { status: 404 });
    return NextResponse.json({ key, value: doc.data().value, shared: true });
  }

  const decoded = await verifyRequest(req);
  if (!decoded) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const doc = await db.collection('users').doc(decoded.uid).collection('records').doc(key).get();
  if (!doc.exists) return NextResponse.json(null, { status: 404 });
  return NextResponse.json({ key, value: doc.data().value, shared: false });
}

export async function PUT(req) {
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const { key, value, shared } = body || {};
  if (!key || value === undefined) {
    return NextResponse.json({ error: 'key and value are required' }, { status: 400 });
  }

  const decoded = await verifyRequest(req);
  if (!decoded) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  if (shared) {
    const ref = db.collection('sharedRecords').doc(key);
    const existing = await ref.get();
    const existingOwner = existing.exists ? existing.data().ownerId : null;
    if (existingOwner && existingOwner !== decoded.uid) {
      return NextResponse.json({ error: 'This key belongs to another account.' }, { status: 403 });
    }
    await ref.set(
      { value, ownerId: existingOwner || decoded.uid, updatedAt: new Date().toISOString() },
      { merge: true },
    );
    return NextResponse.json({ key, value, shared: true });
  }

  await db.collection('users').doc(decoded.uid).collection('records').doc(key).set(
    { value, updatedAt: new Date().toISOString() },
    { merge: true },
  );
  return NextResponse.json({ key, value, shared: false });
}

export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');
  const shared = searchParams.get('shared') === 'true';
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 });

  const decoded = await verifyRequest(req);
  if (!decoded) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  if (shared) {
    const ref = db.collection('sharedRecords').doc(key);
    const existing = await ref.get();
    const existingOwner = existing.exists ? existing.data().ownerId : null;
    if (existingOwner && existingOwner !== decoded.uid) {
      return NextResponse.json({ error: 'This key belongs to another account.' }, { status: 403 });
    }
    await ref.delete();
    return NextResponse.json({ key, deleted: true, shared: true });
  }

  await db.collection('users').doc(decoded.uid).collection('records').doc(key).delete();
  return NextResponse.json({ key, deleted: true, shared: false });
}
