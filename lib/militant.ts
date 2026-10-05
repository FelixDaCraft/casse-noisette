import { prisma } from '@/lib/db';
import type { ProfilAP, RoleGroupe } from '@/lib/actionPopulaire';

/** Crée ou met à jour le militant à partir de son profil AP, groupes compris.
 *  Action Populaire fait foi : un groupe quitté là-bas disparaît ici. */
export async function enregistrerMilitant(p: ProfilAP): Promise<string> {
  const champs = {
    email: p.email,
    firstName: p.prenom,
    lastName: p.nom,
    displayName: p.nomAffiche,
    image: p.image,
    department: p.departement,
    postalCode: p.codePostal,
    city: p.commune,
    lastLoginAt: new Date(),
  };
  return prisma.$transaction(async (tx) => {
    const m = await tx.militant.upsert({
      where: { apId: p.apId },
      create: { apId: p.apId, ...champs },
      update: champs,
    });
    const groupIds: string[] = [];
    for (const g of p.groupes) {
      const data = { name: g.nom, type: g.type, department: g.departement, city: g.commune };
      const groupe = await tx.actionGroup.upsert({
        where: { apId: g.apId },
        create: { apId: g.apId, ...data },
        update: data,
      });
      groupIds.push(groupe.id);
      await tx.membership.upsert({
        where: { militantId_groupId: { militantId: m.id, groupId: groupe.id } },
        create: { militantId: m.id, groupId: groupe.id, role: g.role },
        update: { role: g.role },
      });
    }
    await tx.membership.deleteMany({ where: { militantId: m.id, groupId: { notIn: groupIds } } });
    return m.id;
  });
}

/** « Camille Le Goff » -> « CL », « Sofia Aït-Kaci » -> « SA », « Yanis B. » -> « YB ».
 *  Prénom puis début du nom : le deuxième mot, pas le dernier (particules). */
export function initiales(nom: string): string {
  const mots = nom.replace(/[.·]/g, ' ').split(/\s+/).filter(Boolean);
  return ((mots[0]?.[0] ?? '') + (mots[1]?.[0] ?? '')).toUpperCase() || '?';
}

export const ROLE_LIBELLE: Record<RoleGroupe, string> = {
  abonne: 'Abonné·e',
  membre: 'Membre',
  gestionnaire: 'Gestionnaire',
  animateur: 'Animateur·rice',
};
