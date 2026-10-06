// Export d'une tournée en GPX 1.1, pour OsmAnd (ou toute appli de navigation
// hors ligne) : de quoi être guidé écran verrouillé, ce qu'une page web ne
// sait pas faire.
//
// - un <wpt> par panneau, numéroté dans l'ordre de passage courant : ils
//   s'affichent sur la carte d'OsmAnd avec leur nom ;
// - une <rte> qui les enchaîne dans le même ordre : OsmAnd la traite comme
//   une suite de points intermédiaires et calcule lui-même le trajet par la
//   route (« Naviguer par la trace »), selon le profil choisi.
//
// Fichier pur (aucun import à l'exécution) : généré dans le navigateur à partir
// des panneaux déjà affichés, et testé avec Node (scripts/tester-navigation.mjs).

export type PointGpx = { name: string; lat: number; lng: number };

/** Échappe le texte pour le XML (noms de rues saisis à la main). */
export function xml(t: string): string {
  return t
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

const coord = (n: number) => (Math.round(n * 1e6) / 1e6).toFixed(6);

export function gpxTournee(titre: string, panels: PointGpx[], date = new Date()): string {
  const nom = (p: PointGpx, k: number) => xml(`${k + 1}. ${p.name || `Panneau ${k + 1}`}`);
  const point = (balise: 'wpt' | 'rtept', p: PointGpx, k: number, retrait: string) =>
    `${retrait}<${balise} lat="${coord(p.lat)}" lon="${coord(p.lng)}">\n` +
    `${retrait}  <name>${nom(p, k)}</name>\n` +
    `${retrait}  <sym>Flag, Red</sym>\n` +
    `${retrait}</${balise}>`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Casse-Noisette" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${xml(titre)}</name>`,
    '    <desc>Tournée de collage : panneaux dans l’ordre de passage.</desc>',
    `    <time>${date.toISOString()}</time>`,
    '  </metadata>',
    ...panels.map((p, k) => point('wpt', p, k, '  ')),
    '  <rte>',
    `    <name>${xml(titre)}</name>`,
    ...panels.map((p, k) => point('rtept', p, k, '    ')),
    '  </rte>',
    '</gpx>',
    '',
  ].join('\n');
}

/** Nom de fichier sûr : « tournee-nantes-centre-ville.gpx ». */
export function nomFichierGpx(titre: string): string {
  const base = titre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `tournee-${base || 'casse-noisette'}.gpx`;
}
