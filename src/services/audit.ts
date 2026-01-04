import { getDb } from '../db/mongo';
import { logger, maskPII } from '../lib/logger';

type AuditEvent = {
  action: string;
  at?: Date;
  correlationId?: string;
  user_id?: string;
  ip?: string;
  path?: string;
  details?: Record<string, any>;
};

/**
 * Write an audit log entry with PII masking applied
 */
export async function auditLog(event: AuditEvent): Promise<void> {
  try {
    const db = await getDb();
    
    // Apply PII masking to the entire event before storing
    const maskedEvent = maskPII({
      ...event,
      at: event.at || new Date()
    }) as Record<string, unknown>;
    
    await db.collection('audit_logs').insertOne(maskedEvent);
  } catch (e: any) {
    logger.warn(`auditLog insert failed: ${e?.message}`);
  }
}


