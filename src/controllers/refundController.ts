import { Request, Response } from 'express';
import { enqueue } from '../queue/index';
import { getDb } from '../db/mongo';
import { logger } from '../lib/logger';
import { v4 as uuidv4 } from 'uuid';

export async function createRefundController(req: Request, res: Response): Promise<void> {
  const { transaction_id, amount_cents, reason, metadata } = req.body || {};
  
  if (!transaction_id || !amount_cents) {
    res.status(400).json({ error: { message: 'transaction_id and amount_cents are required' } });
    return;
  }
  
  if (typeof amount_cents !== 'number' || amount_cents <= 0) {
    res.status(400).json({ error: { message: 'amount_cents must be a positive number' } });
    return;
  }
  
  try {
    const db = await getDb();
    
    // Verify transaction exists
    const transaction = await db.collection('transactions').findOne({ transaction_id });
    
    if (!transaction) {
      res.status(404).json({ error: { message: 'Transaction not found' } });
      return;
    }
    
    // Check if already refunded
    const existingRefund = await db.collection('refunds').findOne({
      transaction_id,
      status: { $in: ['processing', 'completed'] },
    });
    
    if (existingRefund) {
      res.status(409).json({ error: { message: 'Transaction already has a pending or completed refund' } });
      return;
    }
    
    const refund_id = uuidv4();
    
    // Enqueue refund job
    const result = await enqueue('refund_execute', {
      refund_id,
      user_id: transaction.user_id,
      transaction_id,
      amount_cents,
      reason,
      metadata,
    });
    
    if (result.ok) {
      res.status(202).json({
        ok: true,
        refund_id,
        status: 'queued',
        job_id: result.queued ? (result as any).id : undefined,
      });
    } else {
      res.status(500).json({ error: { message: 'Failed to queue refund', reason: result.reason } });
    }
  } catch (err: any) {
    logger.error(`Create refund failed: ${err?.message}`);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
}

export async function getRefundStatusController(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  
  if (!id) {
    res.status(400).json({ error: { message: 'refund id is required' } });
    return;
  }
  
  try {
    const db = await getDb();
    const refund = await db.collection('refunds').findOne({ refund_id: id });
    
    if (!refund) {
      res.status(404).json({ error: { message: 'Refund not found' } });
      return;
    }
    
    // Remove internal fields using destructuring
    const { _id, ...safeRefund } = refund;
    
    res.json({ refund: safeRefund });
  } catch (err: any) {
    logger.error(`Get refund status failed: ${err?.message}`);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
}

