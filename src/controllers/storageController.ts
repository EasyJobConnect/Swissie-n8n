import { Request, Response } from 'express';
import { upsertDocument } from '../services/storage';

export async function upsertController(req: Request, res: Response): Promise<void> {
  const { collection, match, update, options } = req.body || {};
  
  if (!collection || !match || !update) {
    res.status(400).json({ error: { message: 'collection, match, and update are required' } });
    return;
  }
  
  try {
    const result = await upsertDocument({ collection, match, update, options });
    res.json(result);
  } catch (e: any) {
    res.status(e?.status || 500).json({ error: { message: e?.message || 'Storage error' } });
  }
}

