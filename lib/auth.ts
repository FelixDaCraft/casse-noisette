import crypto from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';

export const ADMIN_COOKIE = 'cn_admin';
const TTL_MS = 1000 * 60 * 60 * 12; // 12h
const DEV_FALLBACK = 'dev-insecure-secret-change-me';

/** Secret HMAC, fail-closed en production (évaluation paresseuse). */
function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!s || s.length < 32 || s === DEV_FALLBACK) {
      throw new Error('SESSION_SECRET manquant ou trop faible en production');
    }
    return s;
  }
  return s && s.length > 0 ? s : DEV_FALLBACK;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const h = (s: string) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

/** Jeton de session signé contenant l'id admin + horodatage. */
export function makeToken(adminId: string): string {
  const nonce = crypto.randomBytes(12).toString('hex');
  const payload = `${adminId}.${Date.now()}.${nonce}`;
  const b64 = Buffer.from(payload).toString('base64url');
  return `${b64}.${sign(payload)}`;
}

/** Vérifie signature + fraîcheur, renvoie l'id admin ou null. */
export function readToken(token?: string | null): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(b64, 'base64url').toString();
  } catch {
    return null;
  }
  if (!safeEqual(sig, sign(payload))) return null;
  const [adminId, tsStr] = payload.split('.');
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || Date.now() - ts >= TTL_MS) return null;
  return adminId || null;
}

/** Admin courant (cookie -> jeton -> DB, en vérifiant qu'il est actif). */
export async function getCurrentAdmin() {
  const store = await cookies();
  const adminId = readToken(store.get(ADMIN_COOKIE)?.value);
  if (!adminId) return null;
  const admin = await prisma.admin.findUnique({ where: { id: adminId } });
  if (!admin || !admin.active) return null;
  return admin;
}

/** À appeler en tête des pages/actions protégées. Redirige si non connecté. */
export async function requireAdmin() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/admin/login');
  return admin;
}

export const SESSION_TTL_SECONDS = Math.floor(TTL_MS / 1000);
