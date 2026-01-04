import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function toE164OrNull(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const parsed = parsePhoneNumberFromString(raw);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}


