import { Request, Response } from 'express';
import { isLikelyValidPaymentIntentId, requestRefund } from '../services/payments';
import { auditLog } from '../services/audit';

export async function requestRefundController(req: Request, res: Response): Promise<void> {
  const { payment_intent_id, amount_cents } = req.body || {};
  if (!payment_intent_id || typeof payment_intent_id !== 'string') {
    res.status(422).json({ error: { message: 'payment_intent_id is required' } });
    return;
  }
  if (!isLikelyValidPaymentIntentId(payment_intent_id)) {
    res.status(422).json({ error: { message: 'Invalid payment_intent_id' } });
    return;
  }
  const amount = Number(amount_cents);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(422).json({ error: { message: 'amount_cents must be a positive number' } });
    return;
  }
  const correlationId = (req as any).correlationId as string | undefined;
  const result = await requestRefund({ payment_intent_id, amount_cents: amount, correlationId });
  if (!result.ok) {
    void auditLog({
      action: 'refund_request_failed',
      correlationId,
      details: { payment_intent_id, amount_cents: amount, error: result.error }
    });
    res.status(500).json({ error: { message: result.error } });
    return;
  }
  const statusCode = result.status === 'pending_approval' ? 202 : 200;
  void auditLog({
    action: 'refund_request',
    correlationId,
    details: { payment_intent_id, amount_cents: amount, status: result.status }
  });
  res.status(statusCode).json(result);
}


