import { logger } from '../lib/logger';
import { env } from '../config/env';
import { enqueueJob } from './processor';
import { guardRedisAccess } from '../lib/accessGuard';

export type EnqueueResult = { ok: boolean; queued?: boolean; id?: string; reason?: string };

export async function enqueue(jobName: string, data: Record<string, any>): Promise<EnqueueResult> {
  if (!env.REDIS_URL || !env.ENABLE_WORKERS) {
    logger.info(`Queue disabled; skipping enqueue for job=${jobName}`);
    return { ok: true, queued: false, reason: 'queue_disabled' };
  }

  // Guard: prevent webhook-edge from queuing jobs directly
  guardRedisAccess(`enqueue job: ${jobName}`);

  try {
    const res = await enqueueJob(jobName, data);
    // Propagate id and reason from processor result
    return { ok: res.ok, queued: res.ok && !!res.id, id: res.id, reason: res.reason };
  } catch (e: any) {
    logger.error(`Failed to enqueue job=${jobName}: ${e?.message}`);
    return { ok: false, queued: false, reason: 'enqueue_failed' };
  }
}


