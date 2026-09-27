'use client';
// Réordonnancement des panneaux en fonction du point de départ réel.
//
// Au chargement, on demande la position GPS, puis le serveur renvoie pour chaque
// itinéraire l'ordre de visite le plus court depuis ce point. Tant que la
// position est inconnue (refus, hors-ligne, appareil sans GPS), on garde l'ordre
// défini dans le backoffice : la page reste utilisable en toutes circonstances.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Mode } from '@/lib/maps';

export type Status =
  | 'asking' // la demande d'autorisation est affichée, on attend la réponse
  | 'locating'
  | 'optimizing'
  | 'ready'
  | 'denied'
  | 'unavailable'
  | 'failed';

type Panel = { lat: number; lng: number };
type Input = { id: string; panels: Panel[] };
type ApiResult = { id: string; order: number[]; meters: number; source: 'osrm' | 'haversine' };
type ApiResponse = { results?: ApiResult[]; pending?: boolean };

/** Délai avant de redemander un ordre affiné, et nombre maximum de tentatives. */
// Le serveur de routage public fait patienter plusieurs secondes par requête :
// on laisse le temps aux distances réelles d'arriver, sans s'acharner.
const REFINE_DELAY_MS = 9000;
const MAX_REFINES = 5;

// Chrome ne fait PAS courir le `timeout` de getCurrentPosition tant que la
// demande d'autorisation est à l'écran : sans garde-fou, une popup ignorée
// laisse la page sur « recherche… » pour toujours. On tranche nous-mêmes.
const GEO_TIMEOUT_MS = 10_000;
const GEO_GIVE_UP_MS = 25_000;

export type Optimization = {
  status: Status;
  /** id d'itinéraire -> ordre des indices de panneaux. Vide tant que rien n'est calculé. */
  orders: Record<string, number[]>;
  /** true si au moins un itinéraire a dû retomber sur le vol d'oiseau. */
  approx: boolean;
  /** true tant que les distances routières manquantes se calculent en arrière-plan. */
  refining: boolean;
  retry: () => void;
};

/** Un ordre n'est appliqué que s'il est bien une permutation complète des panneaux. */
function isPermutation(order: unknown, size: number): order is number[] {
  if (!Array.isArray(order) || order.length !== size) return false;
  const seen = new Set<number>();
  for (const i of order) {
    if (!Number.isInteger(i) || i < 0 || i >= size || seen.has(i)) return false;
    seen.add(i);
  }
  return true;
}

export function useOptimizedOrder(itineraries: Input[], mode: Mode): Optimization {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = useState<Status>('locating');
  const [orders, setOrders] = useState<Record<string, number[]>>({});
  const [approx, setApprox] = useState(false);
  const [refining, setRefining] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const refines = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Empreinte stable du contenu : évite de relancer un calcul à chaque rendu.
  const payload = useMemo(
    () => itineraries.map((it) => ({ id: it.id, panels: it.panels.map((p) => ({ lat: p.lat, lng: p.lng })) })),
    [itineraries],
  );
  const payloadKey = useMemo(() => JSON.stringify(payload), [payload]);
  // L'effet ne doit dépendre QUE de cette empreinte, jamais du tableau lui-même :
  // l'appelant peut très bien reconstruire la liste à chaque rendu (c'est le cas
  // quand elle est filtrée par onglet), et une dépendance sur la référence
  // relancerait le calcul en boucle.
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const retry = useCallback(() => {
    refines.current = 0;
    setAttempt((a) => a + 1);
  }, []);

  // Les relances d'affinage en cours ne doivent pas survivre au démontage.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // 1) Position de l'utilisateur, demandée dès l'arrivée sur la page.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      return;
    }
    let alive = true;
    setStatus('locating');

    // Si l'autorisation n'est pas encore accordée, on le dit clairement plutôt
    // que de laisser croire à une recherche en cours.
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((p) => {
        // Cette réponse peut arriver APRÈS la position elle-même : on ne
        // remplace jamais un statut plus avancé par un statut d'attente.
        if (!alive || p.state === 'granted') return;
        setStatus((cur) => (cur === 'locating' ? (p.state === 'denied' ? 'denied' : 'asking') : cur));
      })
      .catch(() => undefined); // Safari ancien : pas de Permissions API, tant pis

    // Garde-fou : une demande d'autorisation laissée sans réponse ne doit pas
    // bloquer l'affichage du statut indéfiniment.
    const giveUp = setTimeout(() => {
      if (alive) setStatus((s) => (s === 'asking' || s === 'locating' ? 'unavailable' : s));
    }, GEO_GIVE_UP_MS);

    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (!alive) return;
        clearTimeout(giveUp);
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      (err) => {
        if (!alive) return;
        clearTimeout(giveUp);
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 120_000 },
    );

    return () => {
      alive = false;
      clearTimeout(giveUp);
    };
  }, [attempt]);

  // 2) Calcul de l'ordre, relancé quand la position ou le mode change.
  useEffect(() => {
    const courant = payloadRef.current;
    if (!pos || courant.length === 0) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setStatus('optimizing');

    fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: pos, mode, itineraries: courant }),
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: ApiResponse) => {
        const next: Record<string, number[]> = {};
        let degraded = false;
        for (const r of data.results ?? []) {
          const it = courant.find((p) => p.id === r.id);
          if (!it || !isPermutation(r.order, it.panels.length)) continue;
          next[r.id] = r.order;
          if (r.source !== 'osrm') degraded = true;
        }
        setOrders(next);
        setApprox(degraded);
        setStatus('ready');

        // Le serveur calcule encore des distances réelles : on redemande un peu plus tard.
        const more = Boolean(data.pending) && refines.current < MAX_REFINES;
        setRefining(more);
        if (more) {
          refines.current += 1;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setRefresh((r) => r + 1), REFINE_DELAY_MS);
        }
      })
      .catch((e) => {
        if (e?.name === 'AbortError') return;
        setRefining(false);
        setStatus('failed');
      });

    return () => ctrl.abort();
  }, [pos, mode, payloadKey, refresh]);

  // Changer de mode relance un cycle d'affinage complet.
  useEffect(() => {
    refines.current = 0;
  }, [mode]);

  return { status, orders, approx, refining, retry };
}
