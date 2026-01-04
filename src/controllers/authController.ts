import { Request, Response } from 'express';
import { getDb } from '../db/mongo';
import { logger } from '../lib/logger';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import argon2 from 'argon2';

export async function loginController(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body || {};
  
  if (!email || !password) {
    res.status(400).json({ error: { message: 'email and password are required' } });
    return;
  }
  
  try {
    const db = await getDb();
    const user = await db.collection('users').findOne({ email });
    
    if (!user || !user.password_hash) {
      res.status(401).json({ error: { message: 'Invalid credentials' } });
      return;
    }
    
    // Verify password
    const valid = await argon2.verify(user.password_hash, password);
    
    if (!valid) {
      res.status(401).json({ error: { message: 'Invalid credentials' } });
      return;
    }
    
    // Check if JWT_SECRET is configured
    if (!env.JWT_SECRET) {
      logger.error('JWT_SECRET not configured');
      res.status(500).json({ error: { message: 'Authentication not configured' } });
      return;
    }
    
    // Generate JWT token
    const token = jwt.sign(
      {
        user_id: user.user_id,
        email: user.email,
      },
      env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    // Update last login
    await db.collection('users').updateOne(
      { user_id: user.user_id },
      { $set: { last_login_at: new Date() } }
    );
    
    res.json({
      token,
      user: {
        user_id: user.user_id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (err: any) {
    logger.error(`Login failed: ${err?.message}`);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
}

export async function logoutController(req: Request, res: Response): Promise<void> {
  // For JWT-based auth, logout is handled client-side by removing the token
  // We can add token blacklisting here if needed
  res.status(204).send();
}

export async function getMeController(req: Request, res: Response): Promise<void> {
  try {
    const userId = (req as any).user?.user_id;
    
    if (!userId) {
      res.status(401).json({ error: { message: 'Not authenticated' } });
      return;
    }
    
    const db = await getDb();
    const user = await db.collection('users').findOne({ user_id: userId });
    
    if (!user) {
      res.status(404).json({ error: { message: 'User not found' } });
      return;
    }
    
    // Remove sensitive fields using destructuring
    const { _id, password_hash, ...safeUser } = user;
    
    res.json({ user: safeUser });
  } catch (err: any) {
    logger.error(`Get me failed: ${err?.message}`);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
}

