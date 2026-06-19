'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireAdmin, makeToken, ADMIN_COOKIE, SESSION_TTL_SECONDS } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/password';
import { sendMail } from '@/lib/mail';
import { makeResetToken, hashResetToken } from '@/lib/reset';

function revalAll(itineraryId?: string) {
  revalidatePath('/');
  revalidatePath('/admin');
  if (itineraryId) revalidatePath(`/admin/itineraries/${itineraryId}`);
}

/* ---------------- Auth ---------------- */

export async function login(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get('email') || '').toLowerCase().trim();
  const password = String(formData.get('password') || '');
  if (!email || !password) return { error: 'Email et mot de passe requis.' };
  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin || !admin.active || !verifyPassword(password, admin.passwordHash)) {
    return { error: 'Identifiants invalides.' };
  }
  const store = await cookies();
  store.set(ADMIN_COOKIE, makeToken(admin.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  redirect('/admin');
}

export async function logout() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  redirect('/admin/login');
}

/* ---------------- Reset de mot de passe par email ---------------- */

export async function requestReset(
  _prev: { error?: string; ok?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string; ok?: string }> {
  const email = String(formData.get('email') || '').toLowerCase().trim();
  if (!email) return { error: 'Email requis.' };
  // Réponse générique : ne révèle pas si le compte existe.
  const generic = {
    ok: 'Si un compte existe pour cet email, un lien de réinitialisation vient d’être envoyé.',
  };
  const admin = await prisma.admin.findUnique({ where: { email } });
  if (admin && admin.active) {
    await prisma.passwordReset.deleteMany({ where: { adminId: admin.id, usedAt: null } });
    const { raw, hash } = makeResetToken();
    await prisma.passwordReset.create({
      data: { adminId: admin.id, tokenHash: hash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    const base = process.env.NEXT_PUBLIC_SITE_URL || '';
    const link = `${base}/admin/reset?token=${raw}`;
    await sendMail(
      admin.email,
      'Réinitialisation de ton mot de passe — Casse-Noisette',
      `<p>Une réinitialisation de mot de passe a été demandée pour le backoffice Casse-Noisette.</p>
       <p><a href="${link}">Clique ici pour choisir un nouveau mot de passe</a> (lien valable 1 heure).</p>
       <p>Si tu n’es pas à l’origine de cette demande, ignore cet email.</p>`,
      `Réinitialise ton mot de passe (lien valable 1h) : ${link}`,
    );
  }
  return generic;
}

export async function performReset(
  _prev: { error?: string } | undefined,
  formData: FormData,
) {
  const token = String(formData.get('token') || '');
  const password = String(formData.get('password') || '');
  const confirm = String(formData.get('confirm') || '');
  if (password.length < 8) return { error: 'Mot de passe : 8 caractères minimum.' };
  if (password !== confirm) return { error: 'Les mots de passe ne correspondent pas.' };

  const reset = await prisma.passwordReset.findUnique({ where: { tokenHash: hashResetToken(token) } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
    return { error: 'Lien invalide ou expiré. Refais une demande.' };
  }
  await prisma.$transaction([
    prisma.admin.update({ where: { id: reset.adminId }, data: { passwordHash: hashPassword(password) } }),
    prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
  ]);
  redirect('/admin/login?reset=1');
}

/* ---------------- Itinéraires ---------------- */

export async function createItinerary(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get('name') || '').trim();
  if (!name) return;
  const max = await prisma.itinerary.aggregate({ _max: { position: true } });
  await prisma.itinerary.create({ data: { name, position: (max._max.position ?? -1) + 1 } });
  revalAll();
}

export async function renameItinerary(id: string, name: string) {
  await requireAdmin();
  const n = name.trim();
  if (!n) return;
  await prisma.itinerary.update({ where: { id }, data: { name: n } });
  revalAll(id);
}

export async function deleteItinerary(id: string) {
  await requireAdmin();
  await prisma.itinerary.delete({ where: { id } });
  revalAll();
}

export async function moveItinerary(id: string, dir: 'up' | 'down') {
  await requireAdmin();
  const all = await prisma.itinerary.findMany({ orderBy: { position: 'asc' } });
  const i = all.findIndex((x) => x.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= all.length) return;
  await prisma.$transaction([
    prisma.itinerary.update({ where: { id: all[i].id }, data: { position: all[j].position } }),
    prisma.itinerary.update({ where: { id: all[j].id }, data: { position: all[i].position } }),
  ]);
  revalAll();
}

/* ---------------- Panneaux ---------------- */

export async function addPanel(itineraryId: string, lat: number, lng: number, name?: string) {
  await requireAdmin();
  const max = await prisma.panel.aggregate({ where: { itineraryId }, _max: { position: true } });
  const panel = await prisma.panel.create({
    data: {
      itineraryId,
      name: (name || '').trim() || 'Nouveau panneau',
      lat,
      lng,
      position: (max._max.position ?? -1) + 1,
    },
  });
  revalAll(itineraryId);
  return { id: panel.id, name: panel.name, lat: panel.lat, lng: panel.lng };
}

export async function updatePanel(
  id: string,
  data: { name?: string; lat?: number; lng?: number },
) {
  await requireAdmin();
  const clean: { name?: string; lat?: number; lng?: number } = {};
  if (typeof data.name === 'string') clean.name = data.name.trim();
  if (typeof data.lat === 'number' && Number.isFinite(data.lat)) clean.lat = data.lat;
  if (typeof data.lng === 'number' && Number.isFinite(data.lng)) clean.lng = data.lng;
  const panel = await prisma.panel.update({ where: { id }, data: clean });
  revalAll(panel.itineraryId);
}

export async function deletePanel(id: string) {
  await requireAdmin();
  const panel = await prisma.panel.delete({ where: { id } });
  revalAll(panel.itineraryId);
}

export async function movePanel(id: string, dir: 'up' | 'down') {
  await requireAdmin();
  const panel = await prisma.panel.findUnique({ where: { id } });
  if (!panel) return;
  const all = await prisma.panel.findMany({
    where: { itineraryId: panel.itineraryId },
    orderBy: { position: 'asc' },
  });
  const i = all.findIndex((x) => x.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return;
  await prisma.$transaction([
    prisma.panel.update({ where: { id: all[i].id }, data: { position: all[j].position } }),
    prisma.panel.update({ where: { id: all[j].id }, data: { position: all[i].position } }),
  ]);
  revalAll(panel.itineraryId);
}

/* ---------------- Comptes admin ---------------- */

export async function createAdmin(_prev: { error?: string; ok?: string } | undefined, formData: FormData) {
  await requireAdmin();
  const email = String(formData.get('email') || '').toLowerCase().trim();
  const password = String(formData.get('password') || '');
  if (!email || !/.+@.+\..+/.test(email)) return { error: 'Email invalide.' };
  if (password.length < 8) return { error: 'Mot de passe : 8 caractères minimum.' };
  if (await prisma.admin.findUnique({ where: { email } })) return { error: 'Cet email existe déjà.' };
  await prisma.admin.create({ data: { email, passwordHash: hashPassword(password) } });
  revalidatePath('/admin/admins');
  return { ok: `Admin ${email} créé.` };
}

export async function toggleAdmin(id: string) {
  const me = await requireAdmin();
  if (me.id === id) return; // pas de désactivation de soi-même
  const a = await prisma.admin.findUnique({ where: { id } });
  if (!a) return;
  await prisma.admin.update({ where: { id }, data: { active: !a.active } });
  revalidatePath('/admin/admins');
}

export async function deleteAdmin(id: string) {
  const me = await requireAdmin();
  if (me.id === id) return; // pas de suppression de soi-même
  if ((await prisma.admin.count()) <= 1) return; // garder au moins un admin
  await prisma.admin.delete({ where: { id } });
  revalidatePath('/admin/admins');
}
