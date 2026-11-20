// Itinéraire à pied pour le parcours proposé avant une course.
//
// Le téléphone n'appelle pas le service de routage lui-même : c'est ce serveur qui le fait,
// pour que le service ne voie pas l'adresse IP du coureur. Les positions ne sont ni gardées
// ni écrites dans les journaux : elles ne font que passer.
//
// Service : OSRM profil « foot » de FOSSGIS (routing.openstreetmap.de), données OpenStreetMap,
// gratuit, sans clé ni compte. Usage raisonnable demandé : quelques requêtes par parcours.

export const ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';
const MAX_POINTS = 8;
const MAX_SPAN_KM = 15;

export class ParcoursError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function km(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// [[lat, lon], ...] : 2 à 8 points, tous à moins de 15 km du premier.
export function cleanPoints(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_POINTS) throw new ParcoursError(400, 'Points du parcours invalides');
  const pts = points.map((p) => {
    const lat = Number(p?.[0]);
    const lon = Number(p?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) throw new ParcoursError(400, 'Points du parcours invalides');
    return [Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6];
  });
  if (pts.some((p) => km(pts[0], p) > MAX_SPAN_KM)) throw new ParcoursError(400, 'Parcours trop étendu');
  return pts;
}

export async function footRoute(points, fetcher = fetch) {
  const pts = cleanPoints(points);
  const url = `${ROUTER}${pts.map(([lat, lon]) => `${lon},${lat}`).join(';')}?overview=full&geometries=polyline&steps=false`;
  let res;
  try {
    res = await fetcher(url, {
      headers: { 'User-Agent': 'Foulee/1.0 (+https://github.com/ramielkhodry-lab/foulee)' },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new ParcoursError(503, 'Service d’itinéraire injoignable, réessaie dans un moment.');
  }
  if (res.status === 429) throw new ParcoursError(429, 'Service d’itinéraire saturé, réessaie dans une minute.');
  const data = await res.json().catch(() => null);
  const r = data?.routes?.[0];
  if (!res.ok || data?.code !== 'Ok' || !r?.geometry) {
    if (data?.code === 'NoRoute' || data?.code === 'NoSegment') throw new ParcoursError(422, 'Pas de chemin à pied trouvé ici.');
    throw new ParcoursError(503, 'Service d’itinéraire indisponible, réessaie dans un moment.');
  }
  return { km: Math.round(r.distance / 10) / 100, poly: r.geometry };
}
