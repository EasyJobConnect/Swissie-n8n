import { Db } from 'mongodb';

export async function ensureIndexes(db: Db): Promise<void> {
  // processed_events indexes
  await db.collection('processed_events').createIndex(
    { internal_event_id: 1 },
    { unique: true, name: 'uniq_internal_event_id' }
  );
  await db.collection('processed_events').createIndex(
    { created_at: 1 },
    { expireAfterSeconds: 72 * 60 * 60, name: 'ttl_processed_events_72h' }
  );
  await db.collection('processed_events').createIndex(
    { expires_at: 1 },
    { expireAfterSeconds: 0, name: 'ttl_processed_events_expires_at', sparse: true }
  );

  // Idempotency storage
  await db.collection('idempotency_keys').createIndex(
    { key: 1 },
    { unique: true, name: 'uniq_idempotency_key' }
  );
  await db.collection('idempotency_keys').createIndex(
    { expires_at: 1 },
    { expireAfterSeconds: 0, name: 'ttl_idempotency_keys' }
  );

  await db.collection('otps').createIndex(
    { otp_id: 1 },
    { unique: true, name: 'uniq_otp_id' }
  );
  await db.collection('otps').createIndex(
    { expires_at: 1 },
    { expireAfterSeconds: 0, name: 'ttl_otps' }
  );

  await db.collection('audit_logs').createIndex(
    { internal_event_id: 1, user_id: 1, action: 1, at: 1 },
    { name: 'audit_lookup' }
  );

  await db.collection('messages').createIndex(
    { to: 1, channel: 1, created_at: -1 },
    { name: 'messages_to_channel' }
  );
  await db.collection('messages').createIndex(
    { status: 1, created_at: -1 },
    { name: 'messages_status' }
  );

  await db.collection('blocked_ips').createIndex(
    { ip: 1 },
    { unique: true, name: 'uniq_ip' }
  );
  await db.collection('refunds').createIndex(
    { refund_id: 1 },
    { unique: true, name: 'uniq_refund_id' }
  );
  await db.collection('refunds').createIndex(
    { status: 1, created_at: -1 },
    { name: 'refunds_status_created_at' }
  );

  // Signature replay guard
  await db.collection('signature_replays').createIndex(
    { key: 1 },
    { unique: true, name: 'uniq_signature_replay_key' }
  );
  await db.collection('signature_replays').createIndex(
    { expires_at: 1 },
    { expireAfterSeconds: 0, name: 'ttl_signature_replays' }
  );

  // Audit rate limits indexes
  await db.collection('audit_rate_limits').createIndex(
    { ip: 1, event_type: 1, window_start: 1 },
    { name: 'audit_rate_limit_lookup' }
  );
  await db.collection('audit_rate_limits').createIndex(
    { expires_at: 1 },
    { expireAfterSeconds: 0, name: 'ttl_audit_rate_limits' }
  );

  // Flow executions indexes
  await db.collection('flow_executions').createIndex(
    { flow_id: 1 },
    { name: 'idx_flow_id' }
  );
  await db.collection('flow_executions').createIndex(
    { execution_id: 1 },
    { unique: true, name: 'uniq_execution_id' }
  );
  await db.collection('flow_executions').createIndex(
    { status: 1, started_at: -1 },
    { name: 'idx_flow_status_started' }
  );

  // Users indexes (unique sparse for optional email/phone)
  await db.collection('users').createIndex(
    { user_id: 1 },
    { unique: true, name: 'uniq_user_id' }
  );
  await db.collection('users').createIndex(
    { email: 1 },
    { unique: true, sparse: true, name: 'uniq_email' }
  );
  await db.collection('users').createIndex(
    { phone: 1 },
    { unique: true, sparse: true, name: 'uniq_phone' }
  );

  // Basic schema validation (best-effort; ignore failures if permissions are limited)
  try {
    await db.command({
      collMod: 'idempotency_keys',
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['key', 'requestHash', 'status', 'created_at', 'expires_at'],
          properties: {
            key: { bsonType: 'string' },
            requestHash: { bsonType: 'string' },
            status: { enum: ['in_progress', 'succeeded', 'failed'] },
            created_at: { bsonType: 'date' },
            expires_at: { bsonType: 'date' }
          }
        }
      }
    });
  } catch {
    // ignore
  }
}


