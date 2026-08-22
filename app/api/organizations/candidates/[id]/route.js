import { NextResponse } from 'next/server';
import { db, verifyRequest } from '@/lib/firebaseAdmin';

export async function DELETE(req, { params }) {
  const decoded = await verifyRequest(req);
  if (!decoded) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (decoded.role !== 'employer' || !decoded.orgId) {
    return NextResponse.json({ error: 'This account isn\u2019t part of an organization.' }, { status: 403 });
  }

  await db.collection('organizations').doc(decoded.orgId).collection('candidates').doc(params.id).delete();
  return NextResponse.json({ id: params.id, deleted: true });
}
