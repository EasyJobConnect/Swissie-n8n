import { Request, Response } from 'express';
import { getDb } from '../db/mongo';
import { http } from '../lib/http';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import Redis from 'ioredis';

let redisClient: Redis | null = null;

function getRedisClient(): Redis | null {
  if (!env.REDIS_URL) {
    return null;
  }
  
  if (!redisClient) {
    try {
      redisClient = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        lazyConnect: true,
      });
    } catch (err: any) {
      logger.warn(`Failed to create Redis client: ${err?.message}`);
      return null;
    }
  }
  
  return redisClient;
}

/**
 * Parse Redis INFO response into structured object
 */
function parseRedisInfo(infoStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = infoStr.split('\r\n');
  for (const line of lines) {
    if (line && !line.startsWith('#')) {
      const [key, value] = line.split(':');
      if (key && value !== undefined) {
        result[key] = value;
      }
    }
  }
  return result;
}

export async function healthCheckController(req: Request, res: Response): Promise<void> {
  const deep = req.query.deep === 'true';
  const out: any = { ok: true, checks: {}, timestamp: new Date().toISOString() };
  
  // Check MongoDB
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    out.checks.db = 'ok';
    
    // Deep mode: add DB stats
    if (deep) {
      try {
        const stats = await db.stats();
        out.checks.db_stats = {
          collections: stats.collections,
          objects: stats.objects,
          dataSize: `${Math.round(stats.dataSize / 1024 / 1024)}MB`,
          indexes: stats.indexes,
          indexSize: `${Math.round(stats.indexSize / 1024 / 1024)}MB`,
        };
      } catch {
        // Stats might fail with limited permissions
      }
    }
  } catch (e: any) {
    out.ok = false;
    out.checks.db = `error: ${e?.message || 'unknown'}`;
  }
  
  // Check Redis (if configured) - use persistent client
  if (env.REDIS_URL) {
    try {
      const redis = getRedisClient();
      if (redis) {
        // Ensure connected (lazyConnect mode)
        if (!redis.status || redis.status !== 'ready') {
          await redis.connect();
        }
        const pong = await redis.ping();
        out.checks.redis = pong === 'PONG' ? 'ok' : `unexpected: ${pong}`;
        
        // Deep mode: add Redis memory/persistence info
        if (deep) {
          try {
            const memoryInfo = await redis.info('memory');
            const persistenceInfo = await redis.info('persistence');
            const serverInfo = await redis.info('server');
            
            const memory = parseRedisInfo(memoryInfo);
            const persistence = parseRedisInfo(persistenceInfo);
            const server = parseRedisInfo(serverInfo);
            
            out.checks.redis_info = {
              version: server.redis_version,
              used_memory_human: memory.used_memory_human,
              used_memory_peak_human: memory.used_memory_peak_human,
              maxmemory_human: memory.maxmemory_human || 'unlimited',
              rdb_last_save_time: persistence.rdb_last_save_time,
              rdb_last_bgsave_status: persistence.rdb_last_bgsave_status,
              aof_enabled: persistence.aof_enabled,
              aof_current_rewrite_time_sec: persistence.aof_current_rewrite_time_sec,
              connected_clients: server.connected_clients,
            };
          } catch (infoErr: any) {
            out.checks.redis_info = `error: ${infoErr?.message}`;
          }
        }
        // Do not quit; keep client for future checks to avoid resource churn
      } else {
        out.checks.redis = 'client_init_failed';
      }
    } catch (e: any) {
      out.ok = false;
      out.checks.redis = `error: ${e?.message || 'unknown'}`;
      // Only reset client on error
      if (redisClient) {
        try {
          await redisClient.quit();
        } catch {}
        redisClient = null;
      }
    }
  } else {
    out.checks.redis = 'not_configured';
  }
  
  // Check n8n (optional)
  try {
    const url = env.N8N_INGEST_URL;
    if (url) {
      const result = await http.get(url, { validateStatus: () => true, timeout: 3000 });
      out.checks.n8n = `status:${result.status}`;
      if (result.status >= 500) out.ok = false;
    } else {
      out.checks.n8n = 'not_configured';
    }
  } catch (e: any) {
    out.ok = false;
    out.checks.n8n = `error: ${e?.message || 'unknown'}`;
  }
  
  // Deep mode: add worker health status
  if (deep) {
    try {
      // Import dynamically to avoid circular dependencies
      const { getWorkerHealth } = await import('../queue/worker');
      out.checks.workers = getWorkerHealth();
    } catch {
      out.checks.workers = 'unavailable';
    }
  }
  
  res.status(out.ok ? 200 : 503).json(out);
}

