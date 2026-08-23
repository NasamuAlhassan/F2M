import crypto from 'node:crypto';

// No 0/O/1/I/L — this code is read back over a USSD screen and repeated aloud.
const LOT_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateLotCode(): string {
  let out = '';
  const bytes = crypto.randomBytes(4);
  for (const b of bytes) out += LOT_CODE_ALPHABET[b % LOT_CODE_ALPHABET.length];
  return `FTM-${out}`;
}
