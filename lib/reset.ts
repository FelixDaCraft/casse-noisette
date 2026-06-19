import crypto from 'crypto';

/** Génère un jeton brut (envoyé par email) + son hash (stocké en base). */
export function makeResetToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

export function hashResetToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
