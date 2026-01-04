module.exports = {
  async up(db) {
    // Create indexes for audit_rate_limits collection
    await db.collection('audit_rate_limits').createIndex(
      { ip: 1, event_type: 1, window_start: 1 },
      { name: 'audit_rate_limit_lookup' }
    );
    
    await db.collection('audit_rate_limits').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'ttl_audit_rate_limits' }
    );
    
    console.log('Added indexes for audit_rate_limits');
  },

  async down(db) {
    try {
      await db.collection('audit_rate_limits').dropIndex('audit_rate_limit_lookup');
      await db.collection('audit_rate_limits').dropIndex('ttl_audit_rate_limits');
      console.log('Dropped indexes for audit_rate_limits');
    } catch (err) {
      console.log(`Collection audit_rate_limits may not exist: ${err.message}`);
    }
  }
};

