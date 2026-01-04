import { WebClient } from '@slack/web-api';
import sgMail from '@sendgrid/mail';
import { logger } from '../lib/logger';

export async function sendAdminAlert(input: { severity: 'info' | 'warning' | 'error'; message: string; context?: any }) {
  const promises: Promise<any>[] = [];
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const slackChannel = process.env.SLACK_ALERT_CHANNEL;
  if (slackToken && slackChannel) {
    const client = new WebClient(slackToken);
    promises.push(
      client.chat.postMessage({
        channel: slackChannel,
        text: `(${input.severity.toUpperCase()}) ${input.message}\n\`\`\`${JSON.stringify(input.context || {}, null, 2)}\`\`\``
      })
    );
  }
  const sgApiKey = process.env.SENDGRID_API_KEY;
  const emailTo = process.env.ALERT_EMAIL_TO;
  const emailFrom = process.env.EMAIL_FROM;
  if (sgApiKey && emailTo && emailFrom) {
    sgMail.setApiKey(sgApiKey);
    promises.push(
      sgMail.send({
        to: emailTo,
        from: emailFrom,
        subject: `[${input.severity.toUpperCase()}] Backend Alert`,
        text: `${input.message}\n\n${JSON.stringify(input.context || {}, null, 2)}`
      })
    );
  }
  if (promises.length === 0) {
    logger.warn(`Admin alert (no providers configured): ${input.message}`);
    return;
  }
  await Promise.allSettled(promises);
}


