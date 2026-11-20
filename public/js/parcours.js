// Parcours proposé avant une course : une boucle qui part de ta position et y revient.
//
// Les points de passage sont posés sur un cercle qui passe par le départ, puis le serveur
// Foulée demande l'itinéraire à pied réel (OSRM « foot » de FOSSGIS, carte OpenStreetMap,
// gratuit et sans clé). Si la boucle obtenue est trop courte ou trop longue, le cercle est
// agrandi ou réduit et on redemande (3 essais au plus).
//
// La distance affichée est celle de l'itinéraire calculé sur la carte, pas une mesure :
// elle est toujours présentée comme telle.

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Point à `m` mètres de `p` dans la direction `bearing` (degrés, 0 = nord).
export function offset([lat, lon], m, bearing) {
  const d = m / R;
  const b = rad(bearing);
  const la = rad(lat);
  const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lon2 = rad(lon) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
  return [Math.round(deg(lat2) * 1e6) / 1e6, Math.round(deg(lon2) * 1e6) / 1e6];
}

// Les rues font des détours : une boucle « à vol d'oiseau » de 1 km donne environ 1,3 km à pied.
export const DETOUR = 1.3;

// Points de passage d'une boucle d'environ `km` qui part de `start` vers `bearing`.
// Le cercle passe par le départ ; `n` points sont répartis dessus (départ exclu).
export function loopWaypoints(start, km, bearing, { n = 3, detour = DETOUR } = {}) {
  const r = (km * 1000) / (2 * Math.PI * detour);
  const center = offset(start, r, bearing);
  const back = (bearing + 180) % 360; // direction du centre vers le départ
  const pts = [];
  for (let k = 1; k <= n; k++) pts.push(offset(center, r, back + (360 * k) / (n + 1)));
  return pts;
}

// Polyline Google (précision 5) renvoyée par OSRM.
export function decodePolyline(str) {
  const out = [];
  let lat = 0;
  let lon = 0;
  let i = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let shift = 0;
      let n = 0;
      let b;
      do {
        b = str.charCodeAt(i++) - 63;
        n |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const v = n & 1 ? ~(n >>> 1) : n >>> 1;
      if (k === 0) lat += v; else lon += v;
    }
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}

// Distance visée : la durée de la séance à ton allure moyenne de séance (marche comprise),
// d'après tes dernières courses mesurées. Sans course mesurée, 6 km/h et on le dit.
export const DEFAULT_KMH = 6;
export function targetKm(history, sessionSec) {
  const runs = (history || [])
    .filter((h) => (h.sport || 'course') === 'course' && h.distanceKm > 0.3 && h.elapsedSec > 600 && !h.distanceEstimee && !h.test)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 3);
  const kmh = runs.length
    ? runs.reduce((a, h) => a + h.distanceKm, 0) / (runs.reduce((a, h) => a + h.elapsedSec, 0) / 3600)
    : DEFAULT_KMH;
  const km = Math.round(Math.min(25, Math.max(1, (kmh * sessionSec) / 3600)) * 2) / 2;
  return { km, kmh: Math.round(kmh * 10) / 10, from: runs.length };
}

// Une boucle d'environ `km`. `route(points)` renvoie { km, poly } (itinéraire à pied qui passe
// par tous les points dans l'ordre). Renvoie { km, poly, waypoints, bearing }.
export async function planLoop(start, km, bearing, route, { tries = 3, tolerance = 0.12 } = {}) {
  let detour = DETOUR;
  let best = null;
  for (let t = 0; t < tries; t++) {
    const waypoints = loopWaypoints(start, km, bearing, { detour });
    const r = await route([start, ...waypoints, start]);
    const cand = { km: r.km, poly: r.poly, waypoints, bearing };
    if (!best || Math.abs(r.km - km) < Math.abs(best.km - km)) best = cand;
    if (Math.abs(r.km - km) / km <= tolerance) break;
    // Boucle trop longue : le détour réel est plus grand que prévu, on réduit le cercle.
    detour *= Math.min(2, Math.max(0.5, r.km / km));
  }
  return best;
}

// Itinéraire qui repasse par des points déplacés à la main (pas de réajustement de longueur).
export async function reroute(start, waypoints, route) {
  const r = await route([start, ...waypoints, start]);
  return { km: r.km, poly: r.poly, waypoints };
}

export const kmLabel = (km) => km.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
