import { Queue, ConnectionOptions } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../lib/logger';

const queueCache = new Map<string, Queue>();

function getConnectionOptions(): ConnectionOptions {
  if (!env.REDIS_URL) {
    throw new Error('REDIS_URL not configured');
  }
  
  // Parse Redis URL
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    db: url.pathname ? parseInt(url.pathname.slice(1), 10) : 0,
  };
}

export function getQueue(name: string): Queue | null {
  if (!env.REDIS_URL) {
    logger.info('REDIS_URL not set; queue disabled');
    return null;
  }

  // Return cached queue if exists
  if (queueCache.has(name)) {
    return queueCache.get(name)!;
  }

  try {
    const queue = new Queue(name, {
      connection: getConnectionOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          age: 24 * 3600, // Keep completed jobs for 24 hours
          count: 1000, // Keep last 1000 jobs
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // Keep failed jobs for 7 days
        },
      },
    });

    queueCache.set(name, queue);
    logger.info(`Queue initialized: ${name}`);
    return queue;
  } catch (err: any) {
    logger.error(`Failed to initialize queue ${name}: ${err?.message}`);
    return null;
  }
}

export async function enqueueJob(
  queueName: string,
  data: Record<string, any>,
  options?: { delay?: number; priority?: number }
): Promise<{ ok: boolean; id?: string; reason?: string }> {
  const queue = getQueue(queueName);
  if (!queue) {
    return { ok: true, reason: 'queue_disabled' };
  }

  try {
    const job = await queue.add(queueName, data, {
      ...options,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });

    logger.info(`Job enqueued: queue=${queueName} id=${job.id}`);
    return { ok: true, id: job.id };
  } catch (err: any) {
    logger.error(`Failed to enqueue job: queue=${queueName} error=${err?.message}`);
    return { ok: false, reason: 'enqueue_failed' };
  }
}

export async function closeAllQueues(): Promise<void> {
  for (const [name, queue] of queueCache.entries()) {
    try {
      await queue.close();
      logger.info(`Queue closed: ${name}`);
    } catch (err: any) {
      logger.warn(`Failed to close queue ${name}: ${err?.message}`);
    }
  }
  queueCache.clear();
}


