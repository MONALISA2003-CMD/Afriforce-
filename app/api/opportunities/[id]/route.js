import { NextResponse } from 'next/server';
import { db, verifyRequest } from '@/lib/firebaseAdmin';

export async function DELETE(req, { params }) {
  const decoded = await verifyRequest(req);
  if (!decoded) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (decoded.role !== 'admin') {
    return NextResponse.json({ error: 'Only admin accounts can remove opportunities.' }, { status: 403 });
  }

  await db.collection('opportunities').doc(params.id).delete();
  return NextResponse.json({ id: params.id, deleted: true });
}
