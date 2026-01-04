/**
 * Migration: Add missing indexes
 * 
 * This migration adds indexes that were identified as needed:
 * - flow_executions.flow_id
 * - users.email (unique sparse)
 * - users.phone (unique sparse)
 * - audit_rate_limits TTL fix
 */
module.exports = {
  async up(db) {
    console.log('Adding missing indexes...');

    // flow_executions indexes
    try {
      await db.collection('flow_executions').createIndex(
        { flow_id: 1 },
        { name: 'idx_flow_id' }
      );
      console.log('Created index: flow_executions.flow_id');
    } catch (err) {
      if (err.code !== 85) { // Index already exists
        console.warn(`Failed to create flow_id index: ${err.message}`);
      }
    }

    try {
      await db.collection('flow_executions').createIndex(
        { execution_id: 1 },
        { unique: true, name: 'uniq_execution_id' }
      );
      console.log('Created index: flow_executions.execution_id (unique)');
    } catch (err) {
      if (err.code !== 85) {
        console.warn(`Failed to create execution_id index: ${err.message}`);
      }
    }

    try {
      await db.collection('flow_executions').createIndex(
        { status: 1, started_at: -1 },
        { name: 'idx_flow_status_started' }
      );
      console.log('Created index: flow_executions.status + started_at');
    } catch (err) {
      if (err.code !== 85) {
        console.warn(`Failed to create status_started index: ${err.message}`);
      }
    }

    // users collection indexes (unique sparse for optional fields)
    try {
      await db.collection('users').createIndex(
        { email: 1 },
        { unique: true, sparse: true, name: 'uniq_email' }
      );
      console.log('Created index: users.email (unique sparse)');
    } catch (err) {
      if (err.code !== 85) {
        console.warn(`Failed to create email index: ${err.message}`);
      }
    }

    try {
      await db.collection('users').createIndex(
        { phone: 1 },
        { unique: true, sparse: true, name: 'uniq_phone' }
      );
      console.log('Created index: users.phone (unique sparse)');
    } catch (err) {
      if (err.code !== 85) {
        console.warn(`Failed to create phone index: ${err.message}`);
      }
    }

    try {
      await db.collection('users').createIndex(
        { user_id: 1 },
        { unique: true, name: 'uniq_user_id' }
      );
      console.log('Created index: users.user_id (unique)');
    } catch (err) {
      if (err.code !== 85) {
        console.warn(`Failed to create user_id index: ${err.message}`);
      }
    }

    // Ensure TTL index on audit_rate_limits exists
    try {
      await db.collection('audit_rate_limits').createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'ttl_audit_rate_limits' }
      );
      console.log('Ensured TTL index: audit_rate_limits.expiresAt');
    } catch (err) {
      if (err.code !== 85) {
        console.warn(`Failed to create audit TTL index: ${err.message}`);
      }
    }

    // Add expiresAt TTL for processed_events (backup to createdAt TTL)
    try {
      await db.collection('processed_events').createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'ttl_processed_events_expiresAt', sparse: true }
      );
      console.log('Created TTL index: processed_events.expiresAt');
    } catch (err) {
      if (err.code !== 85) {
        console.warn(`Failed to create processed_events expiresAt TTL: ${err.message}`);
      }
    }

    console.log('Migration completed: add-missing-indexes');
  },

  async down(db) {
    console.log('Rolling back missing indexes...');

    const indexesToDrop = [
      { collection: 'flow_executions', index: 'idx_flow_id' },
      { collection: 'flow_executions', index: 'uniq_execution_id' },
      { collection: 'flow_executions', index: 'idx_flow_status_started' },
      { collection: 'users', index: 'uniq_email' },
      { collection: 'users', index: 'uniq_phone' },
      { collection: 'users', index: 'uniq_user_id' },
      { collection: 'processed_events', index: 'ttl_processed_events_expiresAt' },
    ];

    for (const { collection, index } of indexesToDrop) {
      try {
        await db.collection(collection).dropIndex(index);
        console.log(`Dropped index: ${collection}.${index}`);
      } catch (err) {
        console.log(`Could not drop ${collection}.${index}: ${err.message}`);
      }
    }

    console.log('Rollback completed: add-missing-indexes');
  }
};

