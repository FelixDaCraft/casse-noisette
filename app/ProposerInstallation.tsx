'use client';
// Petite carte « Installe l'appli » dans le détail d'une tournée, juste avant
// « Démarrer la tournée » : c'est là que les barres du navigateur gênent.
// Rien si l'appli est déjà installée, si le navigateur ne sait pas l'installer,
// ou si le militant l'a écartée (on n'en reparle pas avant 30 jours).

import { useEffect, useState } from 'react';
import { abonnerInstallation, estInstallee, estIos, installer, invitationDisponible } from './installation';

const CLE = 'cn_install_ecartee';
const SILENCE_MS = 30 * 24 * 3600 * 1000;

function ecarteeRecemment(): boolean {
  try {
    const t = Number(localStorage.getItem(CLE));
    return Number.isFinite(t) && t > 0 && Date.now() - t < SILENCE_MS;
  } catch {
    return false;
  }
}

export default function ProposerInstallation() {
  // Rien au premier rendu (serveur) : tout dépend du navigateur.
  const [cas, setCas] = useState<'aucun' | 'android' | 'ios'>('aucun');

  useEffect(() => {
    const evaluer = () => {
      if (estInstallee() || ecarteeRecemment()) setCas('aucun');
      else if (invitationDisponible()) setCas('android');
      else if (estIos()) setCas('ios');
      else setCas('aucun');
    };
    evaluer();
    return abonnerInstallation(evaluer);
  }, []);

  if (cas === 'aucun') return null;

  const ecarter = () => {
    try {
      localStorage.setItem(CLE, String(Date.now()));
    } catch {}
    setCas('aucun');
  };

  return (
    <aside className="installer" aria-label="Installer l’appli">
      <div className="installer-txt">
        <b>Installe l’appli</b>
        {cas === 'android' ? (
          <span>La tournée s’ouvrira en plein écran, sans les barres du navigateur.</span>
        ) : (
          <span>
            Pour la tournée en plein écran : <b>Partager</b>{' '}
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-label="(icône Partager)">
              <path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8" />
            </svg>{' '}
            puis <b>Sur l’écran d’accueil</b>.
          </span>
        )}
      </div>
      {cas === 'android' && (
        <button type="button" className="geste installer-ok" onClick={() => installer().then((ok) => ok && setCas('aucun'))}>
          Installer
        </button>
      )}
      <button type="button" className="installer-fermer" onClick={ecarter} aria-label="Ne plus proposer">
        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </aside>
  );
}
