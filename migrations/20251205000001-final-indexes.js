/**
 * Migration: Final indexes and capped collections
 * 
 * This migration ensures:
 * - All required indexes exist
 * - idempotency_keys is a capped collection (2GB)
 * - internal_event_id unique index on processed_events
 */
module.exports = {
  async up(db) {
    console.log('Running final indexes migration...');

    // =========================================
    // 1. Ensure internal_event_id unique index
    // =========================================
    try {
      await db.collection('processed_events').createIndex(
        { internal_event_id: 1 },
        { unique: true, name: 'uniq_internal_event_id' }
      );
      console.log('Created/verified index: processed_events.internal_event_id (unique)');
    } catch (err) {
      if (err.code !== 85 && err.code !== 86) {
        console.warn(`Failed to create internal_event_id index: ${err.message}`);
      }
    }

    // =========================================
    // 2. Convert idempotency_keys to capped collection (2GB)
    // =========================================
    const cappedSize = 2 * 1024 * 1024 * 1024; // 2GB
    try {
      const collections = await db.listCollections({ name: 'idempotency_keys' }).toArray();
      
      if (collections.length > 0) {
        // Check if already capped
        const stats = await db.collection('idempotency_keys').stats();
        if (stats.capped) {
          console.log('idempotency_keys is already a capped collection');
        } else {
          console.log('Converting idempotency_keys to capped collection...');
          
          // Backup existing data
          const existingDocs = await db.collection('idempotency_keys').find().toArray();
          console.log(`Backing up ${existingDocs.length} existing idempotency records`);
          
          // Rename old collection
          await db.collection('idempotency_keys').rename('idempotency_keys_backup');
          
          // Create new capped collection
          await db.createCollection('idempotency_keys', {
            capped: true,
            size: cappedSize,
            max: 10000000 // Max 10M documents
          });
          console.log('Created capped collection: idempotency_keys (2GB)');
          
          // Recreate indexes
          await db.collection('idempotency_keys').createIndex(
            { key: 1 },
            { unique: true, name: 'uniq_idempotency_key' }
          );
          await db.collection('idempotency_keys').createIndex(
            { expiresAt: 1 },
            { expireAfterSeconds: 0, name: 'ttl_idempotency_keys' }
          );
          console.log('Recreated indexes on idempotency_keys');
          
          // Restore data (if any)
          if (existingDocs.length > 0) {
            await db.collection('idempotency_keys').insertMany(existingDocs);
            console.log(`Restored ${existingDocs.length} idempotency records`);
          }
          
          // Drop backup
          await db.collection('idempotency_keys_backup').drop();
          console.log('Dropped backup collection');
        }
      } else {
        // Create fresh capped collection
        await db.createCollection('idempotency_keys', {
          capped: true,
          size: cappedSize,
          max: 10000000
        });
        await db.collection('idempotency_keys').createIndex(
          { key: 1 },
          { unique: true, name: 'uniq_idempotency_key' }
        );
        await db.collection('idempotency_keys').createIndex(
          { expiresAt: 1 },
          { expireAfterSeconds: 0, name: 'ttl_idempotency_keys' }
        );
        console.log('Created new capped collection: idempotency_keys (2GB)');
      }
    } catch (err) {
      console.warn(`Failed to cap idempotency_keys: ${err.message}`);
      // Continue with migration - this is not fatal
    }

    // =========================================
    // 3. Ensure all other required indexes
    // =========================================
    const indexSpecs = [
      // processed_events
      { collection: 'processed_events', index: { createdAt: 1 }, options: { expireAfterSeconds: 72 * 60 * 60, name: 'ttl_processed_events_72h' } },
      { collection: 'processed_events', index: { expiresAt: 1 }, options: { expireAfterSeconds: 0, name: 'ttl_processed_events_expiresAt', sparse: true } },
      
      // otps
      { collection: 'otps', index: { otp_id: 1 }, options: { unique: true, name: 'uniq_otp_id' } },
      { collection: 'otps', index: { expiresAt: 1 }, options: { expireAfterSeconds: 0, name: 'ttl_otps' } },
      
      // audit_logs
      { collection: 'audit_logs', index: { internal_event_id: 1, user_id: 1, action: 1, at: 1 }, options: { name: 'audit_lookup' } },
      
      // messages
      { collection: 'messages', index: { to: 1, channel: 1, created_at: -1 }, options: { name: 'messages_to_channel' } },
      { collection: 'messages', index: { status: 1, created_at: -1 }, options: { name: 'messages_status' } },
      { collection: 'messages', index: { message_id: 1 }, options: { unique: true, sparse: true, name: 'uniq_message_id' } },
      
      // blocked_ips
      { collection: 'blocked_ips', index: { ip: 1 }, options: { unique: true, name: 'uniq_ip' } },
      
      // refunds
      { collection: 'refunds', index: { refund_id: 1 }, options: { unique: true, name: 'uniq_refund_id' } },
      { collection: 'refunds', index: { status: 1, created_at: -1 }, options: { name: 'refunds_status_created_at' } },
      
      // signature_replays
      { collection: 'signature_replays', index: { key: 1 }, options: { unique: true, name: 'uniq_signature_replay_key' } },
      { collection: 'signature_replays', index: { expiresAt: 1 }, options: { expireAfterSeconds: 0, name: 'ttl_signature_replays' } },
      
      // audit_rate_limits
      { collection: 'audit_rate_limits', index: { ip: 1, event_type: 1, window_start: 1 }, options: { name: 'audit_rate_limit_lookup' } },
      { collection: 'audit_rate_limits', index: { expiresAt: 1 }, options: { expireAfterSeconds: 0, name: 'ttl_audit_rate_limits' } },
      
      // flow_executions
      { collection: 'flow_executions', index: { flow_id: 1 }, options: { name: 'idx_flow_id' } },
      { collection: 'flow_executions', index: { execution_id: 1 }, options: { unique: true, name: 'uniq_execution_id' } },
      { collection: 'flow_executions', index: { status: 1, started_at: -1 }, options: { name: 'idx_flow_status_started' } },
      
      // users
      { collection: 'users', index: { user_id: 1 }, options: { unique: true, name: 'uniq_user_id' } },
      { collection: 'users', index: { email: 1 }, options: { unique: true, sparse: true, name: 'uniq_email' } },
      { collection: 'users', index: { phone: 1 }, options: { unique: true, sparse: true, name: 'uniq_phone' } },
    ];

    for (const spec of indexSpecs) {
      try {
        await db.collection(spec.collection).createIndex(spec.index, spec.options);
        console.log(`Created index: ${spec.collection}.${spec.options.name}`);
      } catch (err) {
        if (err.code !== 85 && err.code !== 86) {
          console.warn(`Failed to create index ${spec.collection}.${spec.options.name}: ${err.message}`);
        }
      }
    }

    console.log('Migration completed: final-indexes');
  },

  async down(db) {
    console.log('Rolling back final-indexes migration...');
    
    // Note: We don't uncap the collection or remove critical indexes
    // This would be a destructive operation
    
    // Only drop backup if it exists from a failed migration
    try {
      const collections = await db.listCollections({ name: 'idempotency_keys_backup' }).toArray();
      if (collections.length > 0) {
        await db.collection('idempotency_keys_backup').drop();
        console.log('Dropped orphaned backup collection');
      }
    } catch (err) {
      // Ignore
    }

    console.log('Rollback completed: final-indexes (partial - indexes preserved for safety)');
  }
};

