import { Twilio } from 'twilio';
import sgMail from '@sendgrid/mail';
import { WebClient } from '@slack/web-api';
import { getDb } from '../db/mongo';
import { logger } from '../lib/logger';
import { renderTemplate as renderExternalTemplate } from './templates';

type Channel = 'sms' | 'email' | 'slack';

type SendRequest = {
  channel: Channel;
  to: string;
  template_id: string;
  params?: Record<string, any>;
  fallback?: { channel?: Channel; to?: string };
  correlationId?: string;
};

async function renderTemplate(templateId: string, params: Record<string, any> = {}): Promise<{ subject?: string; text: string }> {
  const tpl = await renderExternalTemplate(templateId, params);
  return tpl;
}

async function sendSms(to: string, body: string): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid || !token || !serviceSid) return { ok: false, error: 'Twilio not configured' };
  const client = new Twilio(sid, token);
  const msg = await client.messages.create({ messagingServiceSid: serviceSid, to, body });
  return { ok: true, providerId: msg.sid };
}

async function sendEmail(to: string, subject: string | undefined, text: string): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { ok: false, error: 'SendGrid not configured' };
  sgMail.setApiKey(apiKey);
  const res = await sgMail.send({ to, from, subject: subject || 'Notification', text });
  return { ok: true, providerId: (res as any)[0]?.headers?.['x-message-id'] };
}

async function sendSlack(to: string, text: string): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, error: 'Slack not configured' };
  const client = new WebClient(token);
  const res = await client.chat.postMessage({ channel: to, text });
  return { ok: Boolean(res.ok), providerId: (res as any).ts, error: (res as any).error };
}

export async function sendMessageWithFallback(req: SendRequest) {
  const db = await getDb();
  const tpl = await renderTemplate(req.template_id, req.params);
  const created_at = new Date();
  const base = {
    to: req.to,
    channel: req.channel,
    template_id: req.template_id,
    params: req.params,
    status: 'pending',
    attempts: 0,
    created_at
  };
  const { insertedId } = await db.collection('messages').insertOne(base);

  async function attempt(channel: Channel, to: string) {
    let result: { ok: boolean; providerId?: string; error?: string } = { ok: false };
    try {
      if (channel === 'sms') result = await sendSms(to, tpl.text);
      else if (channel === 'email') result = await sendEmail(to, tpl.subject, tpl.text);
      else if (channel === 'slack') result = await sendSlack(to, tpl.text);
    } catch (e: any) {
      result = { ok: false, error: e?.message || 'Unknown error' };
    }
    await db.collection('messages').updateOne(
      { _id: insertedId },
      {
        $set: {
          status: result.ok ? 'sent' : 'failed',
          last_error: result.error,
          provider_message_id: result.providerId,
          updated_at: new Date()
        },
        $inc: { attempts: 1 }
      }
    );
    if (!result.ok) {
      try {
        const { auditLog } = await import('./audit');
        await auditLog({
          action: 'messaging_failed',
          correlationId: req.correlationId,
          details: { channel, to, template_id: req.template_id, error: result.error }
        } as any);
      } catch {
        // ignore
      }
    }
    return result;
  }

  const primary = await attempt(req.channel, req.to);
  if (!primary.ok && req.fallback?.channel) {
    logger.warn(`Primary channel ${req.channel} failed, attempting fallback ${req.fallback.channel}`);
    const fallbackTo = req.fallback.to || req.to;
    const fallback = await attempt(req.fallback.channel, fallbackTo);
    return {
      message_id: insertedId.toString(),
      channel_used: fallback.ok ? req.fallback.channel : req.channel,
      ok: fallback.ok
    };
  }
  return { message_id: insertedId.toString(), channel_used: req.channel, ok: primary.ok };
}


