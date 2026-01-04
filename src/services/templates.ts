import fs from 'fs/promises';
import path from 'path';
import Mustache from 'mustache';
import { env } from '../config/env';

export type Template = { subject?: string; text: string };

async function tryLoadFromFilesystem(templateId: string): Promise<Template | null> {
  const dir = env.TEMPLATE_DIR;
  const base = path.resolve(process.cwd(), dir, templateId);
  // Try JSON first: { "subject": "...", "text": "..." }
  try {
    const buf = await fs.readFile(base + '.json', 'utf8');
    const parsed = JSON.parse(buf) as Template;
    if (parsed && parsed.text) return parsed;
  } catch {
    // ignore
  }
  // Try .txt for plain text body
  try {
    const text = await fs.readFile(base + '.txt', 'utf8');
    return { text };
  } catch {
    // ignore
  }
  return null;
}

export async function renderTemplate(templateId: string, params: Record<string, any> = {}): Promise<Template> {
  const external = await tryLoadFromFilesystem(templateId);
  if (external) {
    return {
      subject: external.subject ? Mustache.render(external.subject, params) : undefined,
      text: Mustache.render(external.text, params)
    };
  }
  // Fallback built-ins
  const registry: Record<string, Template> = {
    'otp': { subject: 'Your verification code', text: 'Your code is {{code}}.' },
    'generic': { subject: 'Notification', text: '{{message}}' }
  };
  const tpl = registry[templateId] || { text: JSON.stringify(params) };
  return {
    subject: tpl.subject ? Mustache.render(tpl.subject, params) : undefined,
    text: Mustache.render(tpl.text, params)
  };
}


