import { NextResponse } from 'next/server';
import { db, verifyRequest } from '@/lib/firebaseAdmin';

async function checkAccess(req) {
  const decoded = await verifyRequest(req);
  if (!decoded) return { error: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) };
  if (decoded.role !== 'employer' || !decoded.orgId) {
    return { error: NextResponse.json({ error: 'This account isn\u2019t part of an organization.' }, { status: 403 }) };
  }
  return { decoded };
}

export async function PATCH(req, { params }) {
  const { decoded, error } = await checkAccess(req);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const status = body?.status === 'closed' ? 'closed' : 'open';
  await db.collection('organizations').doc(decoded.orgId).collection('jobs').doc(params.id).set(
    { status }, { merge: true },
  );
  return NextResponse.json({ id: params.id, status });
}

export async function DELETE(req, { params }) {
  const { decoded, error } = await checkAccess(req);
  if (error) return error;

  await db.collection('organizations').doc(decoded.orgId).collection('jobs').doc(params.id).delete();
  return NextResponse.json({ id: params.id, deleted: true });
}
