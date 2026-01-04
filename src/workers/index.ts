import { env } from '../config/env';
import { logger } from '../lib/logger';
import { startWorkers, stopWorkers } from '../queue/worker';
import { closeDb } from '../db/mongo';

async function start() {
  if (!env.ENABLE_WORKERS) {
    logger.info('Workers disabled via ENABLE_WORKERS flag; exiting.');
    process.exit(0);
    return;
  }
  await startWorkers();
  logger.info('Workers started and running');
}

// Handle graceful shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}; shutting down gracefully...`);
  try {
    await stopWorkers();
  } catch (e: any) {
    logger.warn(`Error stopping workers: ${e?.message}`);
  }
  try {
    await closeDb();
  } catch (e: any) {
    logger.warn(`Error closing DB: ${e?.message}`);
  }
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void start();


