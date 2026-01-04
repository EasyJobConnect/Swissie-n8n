module.exports = {
  async up(db) {
    // Add JSON schema validation for idempotency_keys
    try {
      await db.command({
        collMod: 'idempotency_keys',
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['key', 'requestHash', 'status', 'createdAt', 'expiresAt'],
            properties: {
              key: { bsonType: 'string' },
              requestHash: { bsonType: 'string' },
              status: { enum: ['in_progress', 'succeeded', 'failed'] },
              createdAt: { bsonType: 'date' },
              expiresAt: { bsonType: 'date' },
              responseStatus: { bsonType: ['int', 'null'] },
              responseIsJson: { bsonType: ['bool', 'null'] }
            }
          }
        },
        validationLevel: 'moderate',
        validationAction: 'warn'
      });
      console.log('Added validator for idempotency_keys');
    } catch (err) {
      console.log(`Validator creation warning (may not have permissions): ${err.message}`);
    }

    // Add validator for otps
    try {
      await db.command({
        collMod: 'otps',
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['otp_id', 'hashedCode', 'expiresAt', 'attemptsRemaining'],
            properties: {
              otp_id: { bsonType: 'string' },
              hashedCode: { bsonType: 'string' },
              expiresAt: { bsonType: 'date' },
              attemptsRemaining: { bsonType: 'int', minimum: 0 },
              subject_type: { bsonType: 'string' },
              subject_id: { bsonType: 'string' }
            }
          }
        },
        validationLevel: 'moderate',
        validationAction: 'warn'
      });
      console.log('Added validator for otps');
    } catch (err) {
      console.log(`Validator creation warning: ${err.message}`);
    }
  },

  async down(db) {
    // Remove validators
    try {
      await db.command({
        collMod: 'idempotency_keys',
        validator: {},
        validationLevel: 'off'
      });
      console.log('Removed validator for idempotency_keys');
    } catch (err) {
      console.log(`Warning: ${err.message}`);
    }

    try {
      await db.command({
        collMod: 'otps',
        validator: {},
        validationLevel: 'off'
      });
      console.log('Removed validator for otps');
    } catch (err) {
      console.log(`Warning: ${err.message}`);
    }
  }
};

