import { NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';
import { FieldPath } from 'firebase-admin/firestore';

// Public by design — this is how employer search discovers opted-in
// talent profile keys. Implements prefix listing using the standard
// Firestore "range query on document ID" trick (only shared records are
// ever prefix-listed in this app, so that's all this supports).
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const prefix = searchParams.get('prefix') || '';

  let query = db.collection('sharedRecords');
  if (prefix) {
    query = query
      .where(FieldPath.documentId(), '>=', prefix)
      .where(FieldPath.documentId(), '<', prefix + '\uf8ff');
  }

  const snap = await query.get();
  return NextResponse.json({ keys: snap.docs.map((d) => d.id) });
}
