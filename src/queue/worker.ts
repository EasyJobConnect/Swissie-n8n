import { Worker, Job, Queue, ConnectionOptions } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { processOCR } from '../workers/ocrProcessor';
import { processMessagingRetry } from '../workers/messagingRetry';
import { processRefundExecute } from '../workers/refundExecutor';
import { processFlowExecute } from '../workers/flowExecutor';
import { processDailyCleanup } from '../workers/cleanupDaily';

const workers: Worker[] = [];
const dlqQueues: Map<string, Queue> = new Map();

// Worker health tracking
interface WorkerHealthStatus {
  status: 'running' | 'stopped' | 'error';
  last_job_at?: Date;
  jobs_processed: number;
  jobs_failed: number;
  started_at: Date;
}

const workerHealth: Map<string, WorkerHealthStatus> = new Map();

export function getWorkerHealth(): Record<string, WorkerHealthStatus> {
  return Object.fromEntries(workerHealth);
}

function getConnectionOptions(): ConnectionOptions {
  if (!env.REDIS_URL) {
    throw new Error('REDIS_URL not configured');
  }
  
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    db: url.pathname ? parseInt(url.pathname.slice(1), 10) : 0,
  };
}

type QueueName = 'ocr' | 'messaging_retry' | 'refund_execute' | 'flow_execute' | 'daily_cleanup';
type ProcessorFunction = (job: Job) => Promise<any>;

const processors: Record<QueueName, ProcessorFunction> = {
  ocr: processOCR,
  messaging_retry: processMessagingRetry,
  refund_execute: processRefundExecute,
  flow_execute: processFlowExecute,
  daily_cleanup: processDailyCleanup,
};

export async function startWorkers(): Promise<void> {
  if (!env.ENABLE_WORKERS || !env.REDIS_URL) {
    logger.info('Workers disabled (ENABLE_WORKERS=false or REDIS_URL not set)');
    return;
  }

  const connection = getConnectionOptions();
  const concurrency = env.QUEUE_CONCURRENCY;
  
  // Log effective concurrency
  logger.info(`Queue concurrency configured: ${concurrency} (min: 1, max: 50)`);

  const queues: QueueName[] = ['ocr', 'messaging_retry', 'refund_execute', 'flow_execute', 'daily_cleanup'];

  for (const queueName of queues) {
    const processor = processors[queueName];
    
    // Initialize DLQ for this worker
    const dlqName = `${queueName}_dlq`;
    const dlqQueue = new Queue(dlqName, { connection });
    dlqQueues.set(queueName, dlqQueue);
    
    // Initialize health status
    workerHealth.set(queueName, {
      status: 'running',
      jobs_processed: 0,
      jobs_failed: 0,
      started_at: new Date()
    });
    
    const worker = new Worker(queueName, processor, {
      connection,
      concurrency,
      lockDuration: 30000, // 30 seconds
      limiter: {
        max: 100,
        duration: 1000, // 100 jobs per second max
      },
    });

    worker.on('completed', (job: Job) => {
      logger.info(`Job completed: queue=${queueName} id=${job.id} duration=${Date.now() - job.processedOn!}ms`);
      
      // Update health status
      const health = workerHealth.get(queueName);
      if (health) {
        health.last_job_at = new Date();
        health.jobs_processed++;
      }
    });

    worker.on('failed', async (job: Job | undefined, err: Error) => {
      logger.error(`Job failed: queue=${queueName} id=${job?.id} error=${err.message} attempts=${job?.attemptsMade}`);
      
      // Update health status
      const health = workerHealth.get(queueName);
      if (health) {
        health.last_job_at = new Date();
        health.jobs_failed++;
      }
      
      // Push to Dead Letter Queue after max retries (default 3)
      const maxAttempts = job?.opts?.attempts || 3;
      if (job && job.attemptsMade >= maxAttempts) {
        const dlq = dlqQueues.get(queueName);
        if (dlq) {
          try {
            await dlq.add(`failed_${job.id}`, {
              originalJobId: job.id,
              originalData: job.data,
              error: err.message,
              stack: err.stack,
              attemptsMade: job.attemptsMade,
              failed_at: new Date().toISOString(),
            });
            logger.warn(`Job moved to DLQ: queue=${queueName}_dlq job=${job.id}`);
          } catch (dlqErr: any) {
            logger.error(`Failed to push to DLQ: ${dlqErr?.message}`);
          }
        }
      }
    });

    worker.on('error', (err: Error) => {
      logger.error(`Worker error: queue=${queueName} error=${err.message}`);
      
      // Update health status
      const health = workerHealth.get(queueName);
      if (health) {
        health.status = 'error';
      }
    });

    workers.push(worker);
    logger.info(`Worker started: queue=${queueName} concurrency=${concurrency}`);
  }

  logger.info(`All workers started (${workers.length} queues)`);
}

export async function stopWorkers(): Promise<void> {
  logger.info('Stopping workers...');
  
  // Update health status
  for (const [name] of workerHealth) {
    const health = workerHealth.get(name);
    if (health) {
      health.status = 'stopped';
    }
  }
  
  // Close workers gracefully
  for (const worker of workers) {
    try {
      await worker.close();
    } catch (err: any) {
      logger.warn(`Failed to close worker: ${err?.message}`);
    }
  }
  
  // Close DLQ connections
  for (const [name, dlq] of dlqQueues) {
    try {
      await dlq.close();
    } catch (err: any) {
      logger.warn(`Failed to close DLQ ${name}: ${err?.message}`);
    }
  }
  
  workers.length = 0;
  dlqQueues.clear();
  workerHealth.clear();
  logger.info('All workers stopped');
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down workers gracefully');
  await stopWorkers();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down workers gracefully');
  await stopWorkers();
  process.exit(0);
});


