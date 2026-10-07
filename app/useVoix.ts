'use client';
// Guidage vocal en français (Web Speech API, synthèse locale de l'appareil).
//
// Coupée par défaut (on colle souvent à plusieurs, en ville, de nuit) : le
// bouton haut-parleur l'active, et le choix est retenu par l'appareil. Chrome charge la
// liste des voix après coup (`voiceschanged`) : on reprend la meilleure voix
// française dès qu'elle arrive. Une nouvelle annonce coupe la précédente :
// une consigne périmée ne doit pas passer avant la bonne.

import { useCallback, useEffect, useRef, useState } from 'react';

const CLE = 'cn_voix';

function lire(): boolean {
  try {
    return localStorage.getItem(CLE) === '1';
  } catch {
    return false;
  }
}

export function useVoix() {
  const [supportee, setSupportee] = useState(false);
  const [active, setActive] = useState(false);
  const voix = useRef<SpeechSynthesisVoice | null>(null);
  const activeRef = useRef(false);
  activeRef.current = active;

  useEffect(() => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) return;
    setSupportee(true);
    setActive(lire());
    const choisir = () => {
      const toutes = synth.getVoices();
      voix.current =
        toutes.find((v) => v.lang === 'fr-FR' && v.localService) ??
        toutes.find((v) => v.lang === 'fr-FR') ??
        toutes.find((v) => v.lang.replace('_', '-').toLowerCase().startsWith('fr')) ??
        null;
    };
    choisir();
    synth.addEventListener('voiceschanged', choisir);
    return () => {
      synth.removeEventListener('voiceschanged', choisir);
      synth.cancel();
    };
  }, []);

  /** Dit `texte` tout de suite (coupe ce qui est en cours). `force` : même voix coupée
   *  (sert à « débloquer » la synthèse au premier toucher sur iOS). */
  const dire = useCallback((texte: string, force = false) => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || (!activeRef.current && !force)) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(texte);
    u.lang = 'fr-FR';
    if (voix.current) u.voice = voix.current;
    u.rate = 1;
    synth.speak(u);
  }, []);

  const basculer = useCallback(() => {
    const b = !activeRef.current;
    activeRef.current = b;
    setActive(b);
    try {
      localStorage.setItem(CLE, b ? '1' : '0');
    } catch {}
    const synth = window.speechSynthesis;
    if (!b) synth?.cancel();
    else if (synth) {
      // Dit pendant le toucher : c'est aussi ce qui « débloque » la synthèse
      // sur iOS pour les annonces suivantes.
      synth.cancel();
      const u = new SpeechSynthesisUtterance('Guidage vocal activé.');
      u.lang = 'fr-FR';
      if (voix.current) u.voice = voix.current;
      synth.speak(u);
    }
  }, []);

  return { supportee, active: supportee && active, dire, basculer };
}

/**
 * Safari (iOS) ne parle qu'après un geste de l'utilisateur : à appeler dans
 * le clic « Démarrer la tournée », sans quoi les annonces suivantes, lancées
 * après un appel réseau, resteraient muettes.
 */
export function debloquerVoix(texte = 'C’est parti !') {
  try {
    const synth = window.speechSynthesis;
    if (!synth || !lire()) return;
    const u = new SpeechSynthesisUtterance(texte);
    u.lang = 'fr-FR';
    synth.speak(u);
  } catch {}
}
