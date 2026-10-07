'use client';
// Installation de l'appli sur l'écran d'accueil (PWA).
//
// Ouverte dans un onglet, l'appli garde les barres du navigateur en haut et
// en bas : l'écran de navigation y perd un tiers de sa hauteur. Installée,
// elle s'ouvre en plein écran (standalone). On le propose, discrètement :
//   - Android / Chrome : le navigateur émet `beforeinstallprompt`, qu'on
//     garde pour ouvrir sa fenêtre d'installation sur un bouton ;
//   - iOS / Safari : pas d'API, seulement le geste « Partager → Sur l'écran
//     d'accueil », qu'on explique.
// L'événement arrive tôt, parfois avant que la page qui le propose soit
// affichée : on l'écoute dès le chargement (RegisterSW).

type InvitationInstallation = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let invitation: InvitationInstallation | null = null;
const abonnes = new Set<() => void>();
const prevenir = () => abonnes.forEach((f) => f());

export function ecouterInstallation(): void {
  if (typeof window === 'undefined' || (window as any).__cnInstallation) return;
  (window as any).__cnInstallation = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // pas de bandeau automatique : on propose nous-mêmes
    invitation = e as InvitationInstallation;
    prevenir();
  });
  window.addEventListener('appinstalled', () => {
    invitation = null;
    prevenir();
  });
}

export function abonnerInstallation(f: () => void): () => void {
  abonnes.add(f);
  return () => abonnes.delete(f);
}

/** Déjà installée et ouverte depuis l'écran d'accueil. */
export function estInstallee(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as any).standalone === true
  );
}

/** iPhone / iPad sous Safari (les iPad récents se disent « Macintosh »). */
export function estIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function invitationDisponible(): boolean {
  return invitation != null;
}

/** Ouvre la fenêtre d'installation d'Android. Vrai si acceptée. */
export async function installer(): Promise<boolean> {
  const i = invitation;
  if (!i) return false;
  invitation = null;
  try {
    await i.prompt();
    const choix = await i.userChoice;
    return choix.outcome === 'accepted';
  } catch {
    return false;
  } finally {
    prevenir();
  }
}
