// Mesure de distance par le GPS du téléphone, tant que la page reste à l'écran.
// Une webapp iPhone perd le GPS quand l'écran se verrouille : chaque coupure est
// notée pour que la distance soit affichée comme incomplète, jamais inventée.

const R = 6371000;
const MAX_ACCURACY = 30; // m : points moins précis ignorés
const MAX_SPEED = 7; // m/s (25 km/h) : au-delà, saut GPS ignoré
const MIN_MOVE = 3; // m : en dessous, bruit à l'arrêt

export function haversine(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function createTrack() {
  return { points: [], meters: 0, rejected: 0, gaps: 0 };
}

// Ajoute un point { lat, lon, t (ms), acc (m) }. Renvoie true s'il est retenu.
export function addPoint(track, p) {
  if (!(p.acc <= MAX_ACCURACY)) { track.rejected++; return false; }
  const last = track.points.at(-1);
  if (!last) { track.points.push(p); return true; }
  const d = haversine(last, p);
  const dt = (p.t - last.t) / 1000;
  if (dt <= 0) return false;
  if (d / dt > MAX_SPEED) { track.rejected++; return false; }
  if (d < MIN_MOVE) return false;
  track.meters += d;
  track.points.push(p);
  return true;
}

// La page est passée en arrière-plan : le GPS s'arrête, la mesure devient incomplète.
export function markGap(track) {
  track.gaps++;
}

export function summary(track, movingSec) {
  const km = Math.round(track.meters / 10) / 100;
  return {
    distanceKm: km > 0 ? km : null,
    allureSecKm: km >= 0.1 && movingSec > 0 ? Math.round(movingSec / km) : null,
    gpsIncomplet: track.gaps > 0,
    points: track.points.map((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6, p.t]),
  };
}
