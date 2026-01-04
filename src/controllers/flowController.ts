import { Request, Response } from 'express';
import { enqueue } from '../queue/index';
import { getDb } from '../db/mongo';
import { logger } from '../lib/logger';

export async function executeFlowController(req: Request, res: Response): Promise<void> {
  const { flow_name, steps, context, user_id } = req.body || {};
  
  if (!flow_name || !steps || !Array.isArray(steps)) {
    res.status(400).json({ error: { message: 'flow_name and steps (array) are required' } });
    return;
  }
  
  try {
    const flow_id = `flow_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Enqueue flow execution
    const result = await enqueue('flow_execute', {
      flow_id,
      flow_name,
      steps,
      context: context || {},
      user_id,
    });
    
    if (result.ok) {
      res.json({
        ok: true,
        flow_id,
        job_id: result.queued ? (result as any).id : undefined,
        queued: result.queued,
      });
    } else {
      res.status(500).json({ error: { message: 'Failed to enqueue flow', reason: result.reason } });
    }
  } catch (err: any) {
    logger.error(`Flow execution failed: ${err?.message}`);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
}

export async function getFlowStatusController(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  
  if (!id) {
    res.status(400).json({ error: { message: 'flow id is required' } });
    return;
  }
  
  try {
    const db = await getDb();
    
    // Find flow execution by flow_id
    const execution = await db.collection('flow_executions').findOne({ flow_id: id });
    
    if (!execution) {
      res.status(404).json({ error: { message: 'Flow not found' } });
      return;
    }
    
    res.json({
      flow_id: execution.flow_id,
      flow_name: execution.flow_name,
      status: execution.status,
      started_at: execution.started_at,
      completed_at: execution.completed_at,
      failed_at: execution.failed_at,
      error: execution.error,
      results: execution.results,
    });
  } catch (err: any) {
    logger.error(`Get flow status failed: ${err?.message}`);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
}

