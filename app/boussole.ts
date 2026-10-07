'use client';
// Boussole du téléphone pour le mode « Tournée ».
//
// Le cap du GPS n'existe qu'en mouvement, et il est faux à pied lent : à
// l'arrêt, la flèche restait figée et la carte ne tournait pas quand on
// pivotait sur soi. La boussole (magnétomètre) donne l'orientation du
// téléphone à tout moment :
//   - Android / Chrome : `deviceorientationabsolute`, cap = 360 − alpha
//     (alpha tourne dans le sens inverse des aiguilles d'une montre) ;
//   - iOS / Safari : `deviceorientation` et sa propriété `webkitCompassHeading`,
//     déjà un cap, mais seulement après DeviceOrientationEvent.requestPermission(),
//     à demander sur un geste (le bouton « Démarrer la tournée »).
// Les deux se rapportent au haut du téléphone tenu en portrait : on corrige
// de l'angle de l'écran (screen.orientation.angle) s'il est tourné.
//
// Le cap brut tremble (quelques degrés à chaque mesure) : on le lisse par une
// moyenne glissante des vecteurs (sin, cos), qui passe de 359° à 0° sans
// faire le tour du cadran.

export type EtatBoussole = 'inconnu' | 'ok' | 'refus' | 'absente';

let permission: EtatBoussole = 'inconnu';

/** Ce que le capteur envoie réellement, pour l'écran de diagnostic
 *  (`?diag=boussole` dans l'URL de l'appli, voir Navigation). */
export const diagBoussole = {
  permission: 'inconnu' as string,
  ecoute: 'aucune' as string,
  evenements: 0,
  source: '-' as string,
  brut: null as number | null,
  cap: null as number | null,
  angleEcran: 0,
  angles: '-' as string,
  precisionIos: null as number | null,
};

/**
 * À appeler pendant le geste qui lance la tournée (iOS l'exige). Ailleurs, la
 * boussole ne demande rien : on saura en l'écoutant si elle répond.
 */
export function demanderBoussole(): void {
  try {
    const DOE = (globalThis as any).DeviceOrientationEvent;
    if (!DOE) {
      permission = 'absente';
      return;
    }
    if (typeof DOE.requestPermission === 'function') {
      diagBoussole.permission = 'demandée';
      DOE.requestPermission()
        .then((r: string) => {
          permission = r === 'granted' ? 'ok' : 'refus';
          diagBoussole.permission = r;
        })
        .catch((e: unknown) => {
          permission = 'refus';
          diagBoussole.permission = `erreur : ${(e as Error)?.name ?? e}`;
        });
    } else {
      diagBoussole.permission = 'sans objet';
    }
  } catch {
    permission = 'absente';
  }
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const norm = (d: number) => ((d % 360) + 360) % 360;

/**
 * Cap à partir des angles d'Euler (repère W3C : X est, Y nord, Z haut ;
 * rotations intrinsèques Z-X'-Y'' d'angles alpha, beta, gamma).
 *
 * `360 − alpha` n'est juste que téléphone à plat : tenu incliné comme pour
 * naviguer, la flèche déviait. On projette deux axes du téléphone sur
 * l'horizontale : son haut (Y), qui donne le cap à plat mais s'écrase quand on
 * le redresse, et son dos (−Z, la formule de la spécification W3C), qui donne
 * le cap redressé mais s'annule à plat. Leur somme, non normalisée, passe de
 * l'un à l'autre en douceur : le cap est celui où l'on regarde, quelle que
 * soit la tenue du téléphone.
 */
export function capDepuisAngles(alpha: number, beta: number | null, gamma: number | null): number {
  const a = rad(alpha), b = rad(beta ?? 0), g = rad(gamma ?? 0);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  // Haut du téléphone (axe Y) projeté : (est, nord).
  const hx = -sa * cb, hy = ca * cb;
  // Dos du téléphone (axe −Z) projeté.
  const dx = -ca * sg - sa * sb * cg;
  const dy = -sa * sg + ca * sb * cg;
  return norm(deg(Math.atan2(hx + dx, hy + dy)));
}

/** Écart angulaire signé de a vers b, dans ]-180, 180]. */
export function ecartAngle(a: number, b: number): number {
  const d = norm(b - a);
  return d > 180 ? d - 360 : d;
}

/** Moyenne glissante circulaire : poids `k` pour la nouvelle mesure. */
export class LissageCap {
  private s = 0;
  private c = 0;
  private pret = false;
  constructor(private k = 0.25) {}
  ajouter(cap: number): number {
    const s = Math.sin(rad(cap));
    const c = Math.cos(rad(cap));
    if (!this.pret) {
      this.s = s;
      this.c = c;
      this.pret = true;
    } else {
      this.s += this.k * (s - this.s);
      this.c += this.k * (c - this.c);
    }
    return norm(deg(Math.atan2(this.s, this.c)));
  }
}

function angleEcran(): number {
  const a = (globalThis as any).screen?.orientation?.angle ?? (globalThis as any).orientation ?? 0;
  return typeof a === 'number' ? a : 0;
}

/**
 * Écoute la boussole. `surCap` reçoit le cap lissé, en degrés depuis le nord,
 * au plus une dizaine de fois par seconde. Renvoie de quoi arrêter.
 */
export function ecouterBoussole(surCap: (cap: number) => void, surEtat?: (e: EtatBoussole) => void): () => void {
  if (typeof window === 'undefined' || permission === 'refus' || permission === 'absente') {
    surEtat?.(permission === 'refus' ? 'refus' : 'absente');
    return () => undefined;
  }
  const lissage = new LissageCap();
  let dernier = 0;
  let recu = false;

  const traiter = (cap: number | null, source: string) => {
    diagBoussole.evenements++;
    diagBoussole.source = source;
    diagBoussole.brut = cap;
    if (cap == null || !Number.isFinite(cap)) return;
    if (!recu) {
      recu = true;
      surEtat?.('ok');
    }
    diagBoussole.angleEcran = angleEcran();
    const lisse = lissage.ajouter(norm(cap + angleEcran()));
    diagBoussole.cap = Math.round(lisse);
    const t = Date.now();
    if (t - dernier < 100) return;
    dernier = t;
    surCap(lisse);
  };

  const noter = (e: DeviceOrientationEvent) => {
    const r = (v: number | null) => (v == null ? '-' : Math.round(v));
    diagBoussole.angles = `α ${r(e.alpha)} β ${r(e.beta)} γ ${r(e.gamma)}`;
  };
  const absolu = (e: DeviceOrientationEvent) => {
    noter(e);
    traiter(e.alpha == null ? null : capDepuisAngles(e.alpha, e.beta, e.gamma), 'absolu');
  };
  const relatif = (e: DeviceOrientationEvent) => {
    const ios = (e as any).webkitCompassHeading;
    if (typeof ios === 'number' && ios >= 0) {
      noter(e);
      const prec = (e as any).webkitCompassAccuracy;
      diagBoussole.precisionIos = typeof prec === 'number' ? prec : null;
      traiter(ios, 'iOS');
    }
    // Certains Android n'émettent que `deviceorientation`, mais absolu.
    else if (e.absolute && e.alpha != null) {
      noter(e);
      traiter(capDepuisAngles(e.alpha, e.beta, e.gamma), 'relatif-absolu');
    }
    else diagBoussole.source = `relatif ignoré (absolute=${e.absolute}, alpha=${e.alpha == null ? 'null' : Math.round(e.alpha)})`;
  };

  // Les deux à la fois : `deviceorientationabsolute` (Chrome Android) et
  // `deviceorientation` (iOS, Firefox, et les Android qui n'émettent que lui).
  // Le relatif d'un navigateur qui a l'absolu est ignoré (absolute=false).
  const aAbsolu = 'ondeviceorientationabsolute' in window;
  diagBoussole.ecoute = aAbsolu ? 'absolu + relatif' : 'relatif';
  if (aAbsolu) window.addEventListener('deviceorientationabsolute', absolu as EventListener);
  window.addEventListener('deviceorientation', relatif);

  // Pas un signe au bout de 3 s : pas de boussole (ordinateur, capteur absent).
  const veille = setTimeout(() => {
    if (!recu) surEtat?.('absente');
  }, 3000);

  return () => {
    clearTimeout(veille);
    window.removeEventListener('deviceorientationabsolute', absolu as EventListener);
    window.removeEventListener('deviceorientation', relatif);
  };
}
