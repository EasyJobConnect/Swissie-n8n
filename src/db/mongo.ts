import { MongoClient, Db } from 'mongodb';
import { logger } from '../lib/logger';
import { ensureIndexes } from './indexes';
import { guardDatabaseAccess } from '../lib/accessGuard';
import { env } from '../config/env';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  // Allow database access only for non-webhook-edge services
  // Webhook-edge can read for idempotency/audit only, not write
  if (env.SERVICE_ROLE === 'webhook-edge') {
    logger.warn(
      `webhook-edge service accessing database; ensure operations are read-only or audit-only`
    );
  }

  if (db) return db;
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set');
  }
  client = new MongoClient(uri);
  await client.connect();
  db = client.db();
  await ensureIndexes(db);
  logger.info('MongoDB connected and indexes ensured');
  return db;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}


