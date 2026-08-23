import crypto from 'node:crypto';

// No 0/O/1/I/L — these codes are read back over a USSD screen and repeated aloud.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateCode(prefix: string): string {
  let out = '';
  const bytes = crypto.randomBytes(4);
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${prefix}-${out}`;
}

export function generateLotCode(): string {
  return generateCode('FTM');
}

export function generateJobCode(): string {
  return generateCode('DLV');
}
