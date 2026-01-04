module.exports = {
  async up(db) {
    // processed_events indexes
    await db.collection('processed_events').createIndex(
      { internal_event_id: 1 },
      { unique: true, name: 'uniq_internal_event_id' }
    );
    await db.collection('processed_events').createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 72 * 60 * 60, name: 'ttl_processed_events_72h' }
    );

    // idempotency_keys indexes
    await db.collection('idempotency_keys').createIndex(
      { key: 1 },
      { unique: true, name: 'uniq_idempotency_key' }
    );
    await db.collection('idempotency_keys').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'ttl_idempotency_keys' }
    );

    // otps indexes
    await db.collection('otps').createIndex(
      { otp_id: 1 },
      { unique: true, name: 'uniq_otp_id' }
    );
    await db.collection('otps').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'ttl_otps' }
    );

    // audit_logs indexes
    await db.collection('audit_logs').createIndex(
      { internal_event_id: 1, user_id: 1, action: 1, at: 1 },
      { name: 'audit_lookup' }
    );

    // messages indexes
    await db.collection('messages').createIndex(
      { to: 1, channel: 1, createdAt: -1 },
      { name: 'messages_to_channel' }
    );
    await db.collection('messages').createIndex(
      { status: 1, createdAt: -1 },
      { name: 'messages_status' }
    );

    // blocked_ips indexes
    await db.collection('blocked_ips').createIndex(
      { ip: 1 },
      { unique: true, name: 'uniq_ip' }
    );

    // refunds indexes
    await db.collection('refunds').createIndex(
      { refund_id: 1 },
      { unique: true, name: 'uniq_refund_id' }
    );
    await db.collection('refunds').createIndex(
      { status: 1, createdAt: -1 },
      { name: 'refunds_status_createdAt' }
    );

    // signature_replays indexes
    await db.collection('signature_replays').createIndex(
      { key: 1 },
      { unique: true, name: 'uniq_signature_replay_key' }
    );
    await db.collection('signature_replays').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'ttl_signature_replays' }
    );

    console.log('All indexes created successfully');
  },

  async down(db) {
    // Drop all indexes (except _id)
    const collections = [
      'processed_events',
      'idempotency_keys',
      'otps',
      'audit_logs',
      'messages',
      'blocked_ips',
      'refunds',
      'signature_replays'
    ];

    for (const collName of collections) {
      try {
        const indexes = await db.collection(collName).indexes();
        for (const index of indexes) {
          if (index.name !== '_id_') {
            await db.collection(collName).dropIndex(index.name);
          }
        }
        console.log(`Dropped indexes for ${collName}`);
      } catch (err) {
        console.log(`Collection ${collName} may not exist: ${err.message}`);
      }
    }
  }
};

