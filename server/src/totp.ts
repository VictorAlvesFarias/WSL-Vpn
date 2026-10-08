import { createHmac } from 'node:crypto';

// The key lives in the WSL vault, but the code is computed on Windows: its clock is NTP-synced,
// while the WSL clock tends to drift after the PC sleeps, and a few seconds invalidate a TOTP code.
const step = 30;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Accepts a bare key (spaces/lowercase allowed) or an otpauth:// link. Returns normalized base32 or null. */
export function parseTotpSecret(input: string): string | null {
  let text = input.trim();
  if (/^otpauth:\/\//i.test(text)) {
    try {
      text = new URL(text).searchParams.get('secret') ?? '';
    } catch {
      return null;
    }
  }
  const key = text.replace(/[\s=-]/g, '').toUpperCase();
  return key.length >= 16 && /^[A-Z2-7]+$/.test(key) ? key : null;
}

function base32Decode(key: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of key) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** TOTP code (SHA-1, 6 digits, 30 s) and the seconds it stays valid. */
export function totpNow(key: string, now = Date.now() / 1000): { code: string; remaining: number } {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / step)));
  const mac = createHmac('sha1', base32Decode(key)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return { code: code.toString().padStart(6, '0'), remaining: step - Math.floor(now % step) };
}
