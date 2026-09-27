'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireAdmin, makeToken, ADMIN_COOKIE, SESSION_TTL_SECONDS } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/password';
import { sendMail } from '@/lib/mail';
import { makeResetToken, hashResetToken } from '@/lib/reset';
import { MAX_PANELS } from '@/lib/maps';

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
    try {
      await sendMail(
        admin.email,
        'Réinitialisation de ton mot de passe — Casse-Noisette',
        `<p>Une réinitialisation de mot de passe a été demandée pour le backoffice Casse-Noisette.</p>
         <p><a href="${link}">Clique ici pour choisir un nouveau mot de passe</a> (lien valable 1 heure).</p>
         <p>Si tu n’es pas à l’origine de cette demande, ignore cet email.</p>`,
        `Réinitialise ton mot de passe (lien valable 1h) : ${link}`,
      );
    } catch (e) {
      console.error('[reset] échec envoi email:', e);
    }
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

/** Renvoie l'id de la tournée créée, pour ouvrir l'éditeur dans la foulée. */
export async function createItinerary(formData: FormData): Promise<string | undefined> {
  await requireAdmin();
  const name = String(formData.get('name') || '').trim();
  if (!name) return;
  const city = String(formData.get('city') || '').trim() || null;
  const kind = formData.get('kind') === 'circo' ? 'circo' : 'ville';
  const max = await prisma.itinerary.aggregate({ _max: { position: true } });
  const it = await prisma.itinerary.create({
    data: { name, city, kind, position: (max._max.position ?? -1) + 1 },
  });
  revalAll();
  return it.id;
}

export async function updateItinerary(
  id: string,
  name: string,
  city: string,
  kind?: 'circo' | 'ville',
) {
  await requireAdmin();
  const n = name.trim();
  if (!n) return;
  await prisma.itinerary.update({
    where: { id },
    data: { name: n, city: city.trim() || null, ...(kind ? { kind } : {}) },
  });
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

/* ---------------- Panneaux et arrêts ----------------
   Un panneau est un lieu, partagé entre plusieurs itinéraires ; un `Stop` est
   son passage dans une tournée donnée. Éditer un panneau (nom, position) le
   corrige donc partout à la fois ; retirer un arrêt ne retire le panneau de
   cette tournée-là, pas des autres. */

export async function addPanel(itineraryId: string, lat: number, lng: number, name?: string) {
  await requireAdmin();
  // Limite Google Maps : 10 arrêts par itinéraire (garde côté serveur).
  const count = await prisma.stop.count({ where: { itineraryId } });
  if (count >= MAX_PANELS) return null;

  const itinerary = await prisma.itinerary.findUnique({ where: { id: itineraryId } });
  const max = await prisma.stop.aggregate({ where: { itineraryId }, _max: { position: true } });
  const panel = await prisma.panel.create({
    data: {
      name: (name || '').trim() || 'Nouveau panneau',
      lat,
      lng,
      city: itinerary?.city ?? null,
      stops: { create: { itineraryId, position: (max._max.position ?? -1) + 1 } },
    },
  });
  revalAll(itineraryId);
  return { id: panel.id, name: panel.name, lat: panel.lat, lng: panel.lng };
}

/** Ajoute un panneau existant à une tournée, sans le dupliquer. */
export async function attachPanel(itineraryId: string, panelId: string) {
  await requireAdmin();
  const count = await prisma.stop.count({ where: { itineraryId } });
  if (count >= MAX_PANELS) return null;
  if (await prisma.stop.findUnique({ where: { itineraryId_panelId: { itineraryId, panelId } } })) return null;
  const max = await prisma.stop.aggregate({ where: { itineraryId }, _max: { position: true } });
  await prisma.stop.create({
    data: { itineraryId, panelId, position: (max._max.position ?? -1) + 1 },
  });
  revalAll(itineraryId);
  return { ok: true };
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
  await prisma.panel.update({ where: { id }, data: clean });
  // Le panneau peut servir dans plusieurs tournées : toutes sont concernées.
  const stops = await prisma.stop.findMany({ where: { panelId: id }, select: { itineraryId: true } });
  for (const s of stops) revalAll(s.itineraryId);
}

/**
 * Retire le panneau de CETTE tournée. S'il n'est utilisé nulle part ailleurs,
 * le lieu lui-même est supprimé — sinon on ne ferait qu'accumuler des panneaux
 * orphelins invisibles.
 */
export async function deletePanel(id: string, itineraryId?: string) {
  await requireAdmin();
  const stops = await prisma.stop.findMany({ where: { panelId: id } });
  const cible = itineraryId ?? stops[0]?.itineraryId;
  if (!cible) return;
  await prisma.stop.deleteMany({ where: { panelId: id, itineraryId: cible } });
  if (stops.length <= 1) await prisma.panel.delete({ where: { id } }).catch(() => undefined);
  revalAll(cible);
}

export async function movePanel(id: string, dir: 'up' | 'down', itineraryId?: string) {
  await requireAdmin();
  const stop = itineraryId
    ? await prisma.stop.findUnique({ where: { itineraryId_panelId: { itineraryId, panelId: id } } })
    : await prisma.stop.findFirst({ where: { panelId: id } });
  if (!stop) return;
  const all = await prisma.stop.findMany({
    where: { itineraryId: stop.itineraryId },
    orderBy: { position: 'asc' },
  });
  const i = all.findIndex((x) => x.id === stop.id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return;
  await prisma.$transaction([
    prisma.stop.update({ where: { id: all[i].id }, data: { position: all[j].position } }),
    prisma.stop.update({ where: { id: all[j].id }, data: { position: all[i].position } }),
  ]);
  revalAll(stop.itineraryId);
}


/* ---------------- Catalogue de panneaux et import ----------------
   Utilisé par la page Panneaux : créer un panneau sans tournée, le supprimer
   partout, ou importer une série de points (GPS ou lien Google Maps).
   Tout point à moins de 40 m d'un panneau existant réutilise ce panneau
   plutôt que d'en créer un doublon. */

const DEDUP_METERS = 40;
const hav = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dg = (b.lng - a.lng) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

/** Panneau existant à moins de 40 m, sinon null (évite les doublons). */
async function findNear(lat: number, lng: number) {
  const d = 0.0006; // ~65 m
  const near = await prisma.panel.findMany({
    where: { lat: { gte: lat - d, lte: lat + d }, lng: { gte: lng - d, lte: lng + d } },
  });
  return near.map((p) => ({ p, d: hav({ lat, lng }, p) })).filter((x) => x.d <= DEDUP_METERS).sort((a, b) => a.d - b.d)[0]?.p ?? null;
}

/** Page Panneaux : crée un panneau sans tournée (clic carte ou GPS avec « Catalogue seulement »). */
export async function createPanel(input: { name: string; lat: number; lng: number; city?: string | null }) {
  await requireAdmin();
  const dup = await findNear(input.lat, input.lng);
  if (dup) return { id: dup.id, reused: true };
  const p = await prisma.panel.create({
    data: { name: input.name.trim() || 'Nouveau panneau', lat: input.lat, lng: input.lng, city: input.city?.trim() || null },
  });
  revalidatePath('/admin/panels');
  return { id: p.id, reused: false };
}

/** Suppression depuis la page Panneaux : retire le panneau de TOUTES les tournées (Stop cascade). */
export async function deletePanelEverywhere(id: string) {
  await requireAdmin();
  await prisma.panel.delete({ where: { id } });
  revalidatePath('/'); revalidatePath('/admin'); revalidatePath('/admin/panels');
}

/**
 * Import GPS / Google : crée ou réutilise chaque point, puis rattache.
 * target = 'catalog' | 'new' | <itineraryId>. Respecte MAX_PANELS (le surplus reste au catalogue).
 */
export async function importPanels(
  points: { name: string; lat: number; lng: number }[],
  target: string,
  opts: { city?: string; newName?: string } = {},
) {
  await requireAdmin();
  const ids: string[] = [];
  let created = 0, reused = 0;
  for (const pt of points) {
    const r = await createPanel({ ...pt, city: opts.city });
    ids.push(r.id); r.reused ? reused++ : created++;
  }
  const uniq = [...new Set(ids)];
  let itineraryId: string | null = null, attached = 0, skipped = 0;
  if (target === 'new') {
    const stops = uniq.slice(0, MAX_PANELS);
    skipped = uniq.length - stops.length;
    const first = await prisma.panel.findUnique({ where: { id: stops[0] } });
    const lastP = await prisma.panel.findUnique({ where: { id: stops[stops.length - 1] } });
    const max = await prisma.itinerary.aggregate({ _max: { position: true } });
    const it = await prisma.itinerary.create({
      data: {
        name: opts.newName || `Itinéraire de ${first?.name} à ${lastP?.name}`, // nom « auto » : recalculé côté public
        city: opts.city?.trim() || null,
        kind: 'ville',
        position: (max._max.position ?? -1) + 1,
        stops: { create: stops.map((panelId, position) => ({ panelId, position })) },
      },
    });
    itineraryId = it.id; attached = stops.length;
  } else if (target !== 'catalog') {
    itineraryId = target;
    const existing = await prisma.stop.findMany({ where: { itineraryId }, orderBy: { position: 'asc' } });
    const have = new Set(existing.map((s) => s.panelId));
    let pos = (existing.at(-1)?.position ?? -1) + 1;
    for (const panelId of uniq) {
      if (have.has(panelId)) continue;
      if (existing.length + attached >= MAX_PANELS) { skipped++; continue; }
      await prisma.stop.create({ data: { itineraryId, panelId, position: pos++ } });
      attached++;
    }
  }
  revalidatePath('/'); revalidatePath('/admin'); revalidatePath('/admin/panels');
  if (itineraryId) revalidatePath(`/admin/itineraries/${itineraryId}`);
  return { created, reused, attached, skipped, itineraryId };
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
