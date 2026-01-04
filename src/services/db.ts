import { Db } from 'mongodb';
import { getDb } from '../db/mongo';
import { logger } from '../lib/logger';

export async function getDatabase(): Promise<Db> {
  return await getDb();
}

export async function healthCheck(): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = await getDb();
    const res = await db.command({ ping: 1 });
    const ok = res?.ok === 1;
    return { ok };
  } catch (e: any) {
    logger.error(`DB health check failed: ${e?.message}`);
    return { ok: false, error: e?.message };
  }
}

export async function withDb<T>(fn: (db: Db) => Promise<T>, retries = 2): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      const db = await getDb();
      return await fn(db);
    } catch (e: any) {
      lastErr = e;
      if (i < retries) {
        const backoff = 100 * Math.pow(2, i);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}


