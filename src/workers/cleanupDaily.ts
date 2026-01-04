import { Job } from 'bullmq';
import { logger } from '../lib/logger';
import { getDb } from '../db/mongo';

interface CleanupDailyJobData {
  cleanup_date?: string;
  retention_days?: number;
}

/**
 * Daily Cleanup Worker
 * Performs maintenance tasks: expired records, old logs, temp data
 */
export async function processDailyCleanup(job: Job<CleanupDailyJobData>): Promise<any> {
  logger.info(`Daily cleanup job started: id=${job.id}`);

  const results: Record<string, any> = {};
  const db = await getDb();

  try {
    // 1. Clean up expired processed_events (beyond TTL)
    // Note: TTL index handles this automatically, but we can clean orphaned records
    const expiredEventsResult = await db.collection('processed_events').deleteMany({
      created_at: { $lt: new Date(Date.now() - 72 * 60 * 60 * 1000) },
    });
    results.expired_events_deleted = expiredEventsResult.deletedCount;
    logger.info(`Cleaned up expired events: ${expiredEventsResult.deletedCount}`);

    // 2. Clean up expired idempotency keys (beyond TTL)
    const expiredIdempotencyResult = await db.collection('idempotency_keys').deleteMany({
      expires_at: { $lt: new Date() },
    });
    results.expired_idempotency_deleted = expiredIdempotencyResult.deletedCount;
    logger.info(`Cleaned up expired idempotency keys: ${expiredIdempotencyResult.deletedCount}`);

    // 3. Clean up expired OTPs (beyond TTL)
    const expiredOtpsResult = await db.collection('otps').deleteMany({
      expires_at: { $lt: new Date() },
    });
    results.expired_otps_deleted = expiredOtpsResult.deletedCount;
    logger.info(`Cleaned up expired OTPs: ${expiredOtpsResult.deletedCount}`);

    // 4. Clean up old signature replay guards (beyond TTL)
    const expiredReplaysResult = await db.collection('signature_replays').deleteMany({
      expires_at: { $lt: new Date() },
    });
    results.expired_replays_deleted = expiredReplaysResult.deletedCount;
    logger.info(`Cleaned up expired signature replays: ${expiredReplaysResult.deletedCount}`);

    // 5. Archive old audit logs (older than 90 days)
    const retentionDays = job.data.retention_days || 90;
    const archiveDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    
    const oldAuditLogs = await db.collection('audit_logs').find({
      at: { $lt: archiveDate },
    }).toArray();

    if (oldAuditLogs.length > 0) {
      // Archive to separate collection
      await db.collection('audit_logs_archive').insertMany(oldAuditLogs);
      
      // Delete from main collection
      const auditDeleteResult = await db.collection('audit_logs').deleteMany({
        at: { $lt: archiveDate },
      });
      results.audit_logs_archived = auditDeleteResult.deletedCount;
      logger.info(`Archived old audit logs: ${auditDeleteResult.deletedCount}`);
    } else {
      results.audit_logs_archived = 0;
    }

    // 6. Clean up old messages (delivered, older than 30 days)
    const messageRetentionDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const oldMessagesResult = await db.collection('messages').deleteMany({
      status: 'delivered',
      delivered_at: { $lt: messageRetentionDate },
    });
    results.old_messages_deleted = oldMessagesResult.deletedCount;
    logger.info(`Cleaned up old messages: ${oldMessagesResult.deletedCount}`);

    // 7. Clean up old flow executions (older than 60 days)
    // Using snake_case field name: completed_at
    const flowRetentionDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const oldFlowsResult = await db.collection('flow_executions').deleteMany({
      completed_at: { $lt: flowRetentionDate },
      status: 'completed',
    });
    results.old_flows_deleted = oldFlowsResult.deletedCount;
    logger.info(`Cleaned up old flow executions: ${oldFlowsResult.deletedCount}`);

    // 8. Clean up old refunds (older than 90 days, completed/failed)
    // Using snake_case field name: updated_at
    const refundRetentionDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const oldRefundsResult = await db.collection('refunds').deleteMany({
      updated_at: { $lt: refundRetentionDate },
      status: { $in: ['completed', 'failed'] },
    });
    results.old_refunds_deleted = oldRefundsResult.deletedCount;
    logger.info(`Cleaned up old refunds: ${oldRefundsResult.deletedCount}`);

    // 9. Database statistics
    const stats = await db.stats();
    results.db_size_mb = Math.round(stats.dataSize / 1024 / 1024);
    results.collections_count = stats.collections;

    // 10. Generate cleanup summary
    results.cleanup_date = new Date().toISOString();
    results.total_records_cleaned = 
      (results.expired_events_deleted || 0) +
      (results.expired_idempotency_deleted || 0) +
      (results.expired_otps_deleted || 0) +
      (results.expired_replays_deleted || 0) +
      (results.audit_logs_archived || 0) +
      (results.old_messages_deleted || 0) +
      (results.old_flows_deleted || 0) +
      (results.old_refunds_deleted || 0);

    logger.info(`Daily cleanup completed: total_cleaned=${results.total_records_cleaned} db_size=${results.db_size_mb}MB`);

    // Optionally send admin notification about cleanup
    // await sendAdminAlert({ ... });

    return {
      ok: true,
      ...results,
    };

  } catch (err: any) {
    logger.error(`Daily cleanup job failed: id=${job.id} error=${err?.message}`);
    throw err;
  }
}

