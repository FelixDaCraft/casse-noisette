import crypto from 'crypto';
import { signValue, unsignValue } from '@/lib/auth';
import { COMPTES_SIMULES } from '@/lib/apSimulation';

/* Connexion des militants par Action Populaire.

   Le reste de l'appli ne connaît que `fournisseur()` et son interface : passer
   de la simulation au vrai Action Populaire est une affaire de configuration,
   pas de code.

   Ce qu'on sait du vrai (code d'AP, django-oauth-toolkit) : c'est de l'OAuth2
   « authorization code », sans OpenID Connect — pas d'`id_token` ni de
   `userinfo`. Un client s'obtient auprès de l'équipe numérique LFI, sur le
   modèle de TokTok (appli de porte-à-porte), avec les scopes `toktok` et
   `view_membership` :
   - `GET /api/2022/toktok/` -> { id, displayName, isManager, groups[] }, et
     403 `not_a_group_member` si la personne n'est membre d'aucun groupe actif :
     c'est notre contrôle « militant » ;
   - `GET /api/groupes/` -> ses groupes, avec `membershipType` et la
     localisation (dont `departement`).
   L'email, l'adresse et le nom séparé ne sont exposés par aucune route
   accessible en OAuth : ces champs restent vides avec le vrai fournisseur. */

export type RoleGroupe = 'abonne' | 'membre' | 'gestionnaire' | 'animateur';

export type GroupeAP = {
  apId: string;
  nom: string;
  type: string | null; // L local, B thématique, F fonctionnel, D boucle départementale
  departement: string | null;
  commune: string | null;
  role: RoleGroupe;
};

export type ProfilAP = {
  apId: string;
  email: string | null;
  prenom: string | null;
  nom: string | null;
  nomAffiche: string;
  image: string | null;
  departement: string | null;
  codePostal: string | null;
  commune: string | null;
  groupes: GroupeAP[];
};

/** Échec de connexion, avec un code qu'on peut montrer à l'écran. */
export class RefusAP extends Error {
  constructor(
    public code: 'pas_membre' | 'annule' | 'echange' | 'profil' | 'non_configure',
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface FournisseurIdentite {
  id: 'simulation' | 'action-populaire';
  /** Adresse de l'écran de consentement, où l'on envoie le navigateur. */
  urlAutorisation(p: { state: string; redirectUri: string; codeChallenge: string }): string;
  /** Code reçu au retour -> jeton d'accès. */
  echangerCode(p: { code: string; redirectUri: string; codeVerifier: string }): Promise<string>;
  /** Jeton d'accès -> profil. Lève `RefusAP('pas_membre')` hors militants. */
  profil(jeton: string): Promise<ProfilAP>;
}

/** Simulation tant que le vrai client n'existe pas : active par défaut hors
 *  production (AP_MOCK=0 pour tester le vrai en dev).
 *
 *  En production, elle ouvrirait l'appli à n'importe qui (on choisit son
 *  compte dans une liste) : AP_MOCK=1 n'y est accepté que si le site est servi
 *  en local (SITE_URL sur localhost), c'est-à-dire pour vérifier un build sur
 *  son poste. Une variable oubliée dans le docker-compose du serveur ne suffit
 *  donc plus à tout ouvrir. Fail-closed : sans SITE_URL, pas de simulation. */
export function simulationActive(): boolean {
  if (process.env.NODE_ENV !== 'production') return process.env.AP_MOCK !== '0';
  return process.env.AP_MOCK === '1' && siteLocal();
}

function siteLocal(): boolean {
  try {
    const h = new URL(process.env.SITE_URL ?? '').hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  } catch {
    return false;
  }
}

export function fournisseur(): FournisseurIdentite {
  return simulationActive() ? simulation : actionPopulaire;
}

/** État anti-CSRF + PKCE d'une tentative de connexion. */
export function nouvelleTentative() {
  const state = crypto.randomBytes(16).toString('base64url');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { state, codeVerifier, codeChallenge };
}

/** Rôle à partir de `membershipType` (5, 10, 50, 100). */
export function roleDepuisAP(membershipType: unknown): RoleGroupe {
  const n = Number(membershipType);
  if (n >= 100) return 'animateur';
  if (n >= 50) return 'gestionnaire';
  if (n >= 10) return 'membre';
  return 'abonne';
}

/* ---------------- Simulation ----------------
   Rejoue le même aller-retour que le vrai : écran de consentement
   (/connexion/simulation), retour avec `code` + `state`, échange du code,
   lecture du profil. Seuls les comptes sont faux. */

const CODE_TTL_MS = 2 * 60 * 1000;

const simulation: FournisseurIdentite = {
  id: 'simulation',
  urlAutorisation({ state, redirectUri }) {
    const q = new URLSearchParams({ state, redirect_uri: redirectUri });
    return `/connexion/simulation?${q}`;
  },
  async echangerCode({ code }) {
    const v = unsignValue(code);
    const [quoi, compte, ts] = v?.split('.') ?? [];
    if (quoi !== 'code' || !compte || !(Date.now() - Number(ts) < CODE_TTL_MS)) {
      throw new RefusAP('echange', 'code simulé invalide ou expiré');
    }
    return signValue(`jeton.${compte}`);
  },
  async profil(jeton) {
    const [quoi, compte] = unsignValue(jeton)?.split('.') ?? [];
    const c = quoi === 'jeton' ? COMPTES_SIMULES.find((x) => x.apId === compte) : undefined;
    if (!c) throw new RefusAP('profil', 'compte simulé inconnu');
    // Même règle que TokTok : aucun groupe d'action, pas d'accès.
    if (!c.groupes.some((g) => g.role !== 'abonne')) throw new RefusAP('pas_membre');
    return c;
  },
};

/** Code d'autorisation simulé pour un compte (signé, valable 2 minutes). */
export function codeSimule(apId: string): string {
  return signValue(`code.${apId}.${Date.now()}`);
}

/* ---------------- Action Populaire (OAuth2) ---------------- */

function config() {
  const base = (process.env.AP_BASE_URL || 'https://actionpopulaire.fr').replace(/\/$/, '');
  return {
    clientId: process.env.AP_CLIENT_ID || '',
    clientSecret: process.env.AP_CLIENT_SECRET || '',
    scopes: process.env.AP_SCOPES || 'toktok view_membership',
    authorize: process.env.AP_AUTHORIZE_URL || `${base}/o/authorize/`,
    token: process.env.AP_TOKEN_URL || `${base}/o/token/`,
    profil: process.env.AP_PROFILE_URL || `${base}/api/2022/toktok/`,
    groupes: process.env.AP_GROUPS_URL || `${base}/api/groupes/`,
  };
}

function configure() {
  const c = config();
  if (!c.clientId || !c.clientSecret) throw new RefusAP('non_configure', 'AP_CLIENT_ID / AP_CLIENT_SECRET manquants');
  return c;
}

async function getJson(url: string, jeton: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jeton}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

type GroupeBrut = {
  id?: string;
  name?: string;
  type?: string;
  membershipType?: number;
  location?: { departement?: string; city?: string; commune?: { name?: string } };
};

const actionPopulaire: FournisseurIdentite = {
  id: 'action-populaire',
  urlAutorisation({ state, redirectUri, codeChallenge }) {
    const c = configure();
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: c.clientId,
      redirect_uri: redirectUri,
      scope: c.scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${c.authorize}?${q}`;
  },
  async echangerCode({ code, redirectUri, codeVerifier }) {
    const c = configure();
    const res = await fetch(c.token, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as { access_token?: string } | null;
    if (!res.ok || !body?.access_token) throw new RefusAP('echange', `token ${res.status}`);
    return body.access_token;
  },
  async profil(jeton) {
    const c = configure();
    const moi = await getJson(c.profil, jeton);
    if (moi.status === 403 && moi.body?.error === 'not_a_group_member') throw new RefusAP('pas_membre');
    if (moi.status !== 200 || typeof moi.body?.id !== 'string') throw new RefusAP('profil', `profil ${moi.status}`);

    // Les groupes portent le rôle et la localisation ; si la route refuse, on
    // retombe sur la liste plus maigre de TokTok.
    const g = await getJson(c.groupes, jeton).catch(() => ({ status: 0, body: null }));
    const bruts: GroupeBrut[] = g.status === 200 && Array.isArray(g.body) ? g.body : (moi.body.groups ?? []);
    const groupes: GroupeAP[] = bruts
      .filter((x) => typeof x.id === 'string' && typeof x.name === 'string')
      .map((x) => ({
        apId: x.id!,
        nom: x.name!,
        type: x.type ?? null,
        departement: x.location?.departement ?? null,
        commune: x.location?.commune?.name ?? x.location?.city ?? null,
        role: x.membershipType != null ? roleDepuisAP(x.membershipType) : moi.body.isManager ? 'gestionnaire' : 'membre',
      }));

    return {
      apId: moi.body.id,
      email: null,
      prenom: null,
      nom: null,
      nomAffiche: String(moi.body.displayName || 'Militant·e'),
      image: null,
      departement: departementMajoritaire(groupes),
      codePostal: null,
      commune: null,
      groupes,
    };
  },
};

/** AP ne donne pas l'adresse : on prend le département le plus fréquent parmi
 *  les groupes locaux, à défaut parmi tous. */
function departementMajoritaire(groupes: GroupeAP[]): string | null {
  for (const liste of [groupes.filter((g) => g.type === 'L'), groupes]) {
    const n = new Map<string, number>();
    for (const g of liste) if (g.departement) n.set(g.departement, (n.get(g.departement) ?? 0) + 1);
    const top = [...n].sort((a, b) => b[1] - a[1])[0];
    if (top) return top[0];
  }
  return null;
}
