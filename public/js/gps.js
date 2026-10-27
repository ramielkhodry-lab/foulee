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

// Tracé compact pour l'historique (synchronisé, donc il doit rester léger) :
// segments coupés quand le GPS s'est interrompu plus de 30 s, un point tous les 5 m au plus,
// chaque segment encodé comme une polyline (lat, lon au 1e-5 près, secondes depuis le départ).
const GAP_SEC = 30;
const TRACE_STEP = 5; // m

function encodeValue(v, out) {
  let n = v < 0 ? ~(v << 1) : v << 1;
  while (n >= 0x20) {
    out.push(String.fromCharCode((0x20 | (n & 0x1f)) + 63));
    n >>>= 5;
  }
  out.push(String.fromCharCode(n + 63));
}

// points : [[lat, lon, t (ms)], ...] tels que renvoyés par summary().
export function encodeTrace(points) {
  if (!points?.length) return null;
  const t0 = points[0][2];
  const segments = [];
  let seg = [];
  let lastKept = null;
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (prev && (p[2] - prev[2]) / 1000 > GAP_SEC) {
      if (prev !== lastKept) seg.push(prev);
      segments.push(seg);
      seg = [];
      lastKept = null;
    }
    const isLast = i === points.length - 1;
    if (!lastKept || isLast || haversine({ lat: lastKept[0], lon: lastKept[1] }, { lat: p[0], lon: p[1] }) >= TRACE_STEP) {
      seg.push(p);
      lastKept = p;
    }
  });
  segments.push(seg);
  return {
    t0,
    seg: segments.filter((s) => s.length).map((s) => {
      const out = [];
      let prev = [0, 0, 0];
      for (const [lat, lon, t] of s) {
        const cur = [Math.round(lat * 1e5), Math.round(lon * 1e5), Math.round((t - t0) / 1000)];
        cur.forEach((v, k) => encodeValue(v - prev[k], out));
        prev = cur;
      }
      return out.join('');
    }),
  };
}

// Renvoie les segments : [[[lat, lon, secondes], ...], ...].
export function decodeTrace(trace) {
  if (!trace?.seg) return [];
  return trace.seg.map((str) => {
    const pts = [];
    const cur = [0, 0, 0];
    let i = 0;
    while (i < str.length) {
      for (let k = 0; k < 3; k++) {
        let shift = 0;
        let n = 0;
        let b;
        do {
          b = str.charCodeAt(i++) - 63;
          n |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        cur[k] += n & 1 ? ~(n >>> 1) : n >>> 1;
      }
      pts.push([cur[0] / 1e5, cur[1] / 1e5, cur[2]]);
    }
    return pts;
  });
}
