import { getDb } from '../db/mongo';

const ALLOWED_COLLECTIONS = new Set(['users', 'events', 'orders', 'messages', 'audit_logs', 'processed_events', 'otps', 'blocked_ips']);

export async function upsertDocument(input: {
  collection: string;
  match: Record<string, any>;
  update: Record<string, any>;
  options?: { upsert?: boolean };
}): Promise<{ upserted_id?: string; matched_count?: number }> {
  if (!ALLOWED_COLLECTIONS.has(input.collection)) {
    throw Object.assign(new Error('Collection not allowed'), { status: 400 });
  }
  const db = await getDb();
  const res = await db.collection(input.collection).updateOne(input.match, { $set: input.update }, { upsert: input.options?.upsert ?? true });
  return {
    upserted_id: res.upsertedId ? String(res.upsertedId) : undefined,
    matched_count: res.matchedCount
  };
}


