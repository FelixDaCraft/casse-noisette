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

/** Signe une valeur courte (état OAuth, code simulé…) : `valeur.signature`. */
export function signValue(value: string): string {
  return `${Buffer.from(value).toString('base64url')}.${sign(value)}`;
}

/** Inverse de `signValue` : la valeur si la signature est bonne, sinon null. */
export function unsignValue(signed?: string | null): string | null {
  if (!signed) return null;
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  let value: string;
  try {
    value = Buffer.from(signed.slice(0, dot), 'base64url').toString();
  } catch {
    return null;
  }
  return safeEqual(signed.slice(dot + 1), sign(value)) ? value : null;
}

/** Jeton de session : `sujet.horodatage.nonce`, signé. */
function makeSessionToken(subject: string): string {
  const nonce = crypto.randomBytes(12).toString('hex');
  return signValue(`${subject}.${Date.now()}.${nonce}`);
}

/** Vérifie signature + fraîcheur, renvoie le sujet ou null. */
function readSessionToken(token: string | null | undefined, ttlMs: number): string | null {
  const payload = unsignValue(token);
  if (!payload) return null;
  const [subject, tsStr] = payload.split('.');
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || Date.now() - ts >= ttlMs) return null;
  return subject || null;
}

/** Jeton de session signé contenant l'id admin + horodatage. */
export function makeToken(adminId: string): string {
  return makeSessionToken(adminId);
}

/** Vérifie signature + fraîcheur, renvoie l'id admin ou null. */
export function readToken(token?: string | null): string | null {
  const subject = readSessionToken(token, TTL_MS);
  // Un jeton militant (préfixe `m:`) ne doit jamais ouvrir le backoffice.
  return subject && !subject.startsWith(MILITANT_PREFIX) ? subject : null;
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

/* ---------------- Session militant ----------------
   Même signature HMAC que l'admin, mais un cookie et un préfixe à part : les
   deux sessions coexistent sans pouvoir se substituer l'une à l'autre. Plus
   longue que celle de l'admin : on colle avec son téléphone, se reconnecter à
   chaque sortie serait un frein. */

export const MILITANT_COOKIE = 'cn_militant';
const MILITANT_PREFIX = 'm:';
const MILITANT_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 jours
export const MILITANT_TTL_SECONDS = Math.floor(MILITANT_TTL_MS / 1000);

export function makeMilitantToken(militantId: string): string {
  return makeSessionToken(MILITANT_PREFIX + militantId);
}

export function readMilitantToken(token?: string | null): string | null {
  const subject = readSessionToken(token, MILITANT_TTL_MS);
  if (!subject?.startsWith(MILITANT_PREFIX)) return null;
  return subject.slice(MILITANT_PREFIX.length) || null;
}

/** Militant courant, avec ses groupes d'action (cookie -> jeton -> DB). */
export async function getCurrentMilitant() {
  const store = await cookies();
  const id = readMilitantToken(store.get(MILITANT_COOKIE)?.value);
  if (!id) return null;
  const militant = await prisma.militant.findUnique({
    where: { id },
    include: { memberships: { include: { group: true } } },
  });
  if (!militant || !militant.active) return null;
  return militant;
}

/** Garde des pages militantes. Redirige vers la connexion, en gardant la page
 *  demandée pour y revenir ensuite. */
export async function requireMilitant(suite = '/') {
  const militant = await getCurrentMilitant();
  if (!militant) redirect(suite === '/' ? '/connexion' : `/connexion?suite=${encodeURIComponent(suite)}`);
  return militant;
}
