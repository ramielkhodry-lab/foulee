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
  return { points: [], meters: 0, rejected: 0, gaps: 0, alts: [] };
}

// Mesure en cours gardée sur le téléphone (reprise si iOS ferme l'app pendant la séance).
export function packTrack(track) {
  return {
    p: track.points.map((x) => [Math.round(x.lat * 1e6) / 1e6, Math.round(x.lon * 1e6) / 1e6, x.t]),
    m: Math.round(track.meters * 10) / 10, g: track.gaps, a: track.alts || [],
  };
}
export function restoreTrack(saved) {
  const t = createTrack();
  if (!saved || !Array.isArray(saved.p)) return t;
  t.points = saved.p.filter((x) => Array.isArray(x) && x.length >= 3).map(([lat, lon, ts]) => ({ lat, lon, t: ts, acc: 0 }));
  t.meters = Number(saved.m) || 0;
  t.gaps = Number(saved.g) || 0;
  t.alts = Array.isArray(saved.a) ? saved.a : [];
  return t;
}

// Ajoute un point { lat, lon, t (ms), acc (m) }. Renvoie true s'il est retenu.
export function addPoint(track, p) {
  if (!(p.acc <= MAX_ACCURACY)) { track.rejected++; return false; }
  const last = track.points.at(-1);
  // Premier point après une reprise : pas de distance avec le point d'avant (trajet non mesuré).
  if (!last || track.cut) { track.cut = false; track.points.push(p); return true; }
  const d = haversine(last, p);
  const dt = (p.t - last.t) / 1000;
  if (dt <= 0) return false;
  if (d / dt > MAX_SPEED) { track.rejected++; return false; }
  if (d < MIN_MOVE) return false;
  track.meters += d;
  track.points.push(p);
  return true;
}

// Altitude (m) donnée par l'iPhone avec la position (GPS et baromètre). Gardée seulement si
// le téléphone la dit précise.
const MAX_ALT_ACCURACY = 10; // m
export function addAltitude(track, alt, acc, t) {
  if (!Number.isFinite(alt) || !(acc <= MAX_ALT_ACCURACY)) return false;
  (track.alts ||= []).push([t, alt]);
  return true;
}

// Dénivelé positif : une montée ne compte qu'une fois qu'elle dépasse 3 m depuis le point
// le plus bas, pour que le bruit de l'altitude (± quelques mètres) ne s'additionne pas.
const ALT_STEP = 3; // m
const MIN_ALTS = 20;
export function ascent(alts) {
  if (!alts || alts.length < MIN_ALTS) return null;
  // Lissage : moyenne glissante sur 5 mesures.
  const v = alts.map((_, i) => {
    const w = alts.slice(Math.max(0, i - 2), i + 3).map((a) => a[1]);
    return w.reduce((x, y) => x + y, 0) / w.length;
  });
  let up = 0;
  let ref = v[0]; // dernier point bas ou haut retenu
  let climbing = false;
  for (const a of v) {
    if (climbing) {
      if (a > ref) { up += a - ref; ref = a; } else if (a < ref - ALT_STEP) { climbing = false; ref = a; }
    } else if (a < ref) ref = a;
    else if (a > ref + ALT_STEP) { up += a - ref; ref = a; climbing = true; }
  }
  return Math.round(up);
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
    deniveleM: ascent(track.alts),
    points: track.points.map((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6, p.t]),
  };
}

// Allure du moment (s/km) : distance des ~25 dernières secondes de points retenus, pour lisser
// le bruit du GPS. Rien (null) plutôt qu'une valeur fausse si le GPS ne suit plus (aucun point
// depuis 10 s : arrêt, pause, écran verrouillé), s'il est imprécis ou s'il y a trop peu de mesure.
const PACE_WINDOW = 25; // s
const PACE_MIN_SEC = 12; // s de mesure au moins
const PACE_MIN_M = 20; // m parcourus au moins
const PACE_STALE = 10; // s sans point = plus d'allure
const PACE_HOLE = 10; // s entre deux points = trou (pause, reprise) : la fenêtre s'arrête là
const PACE_MAX_ACC = 20; // m : précision moyenne exigée
export function currentPace(track, now) {
  const pts = track.points;
  const last = pts.at(-1);
  if (!last || track.cut || (now - last.t) / 1000 > PACE_STALE) return null;
  let m = 0;
  let acc = last.acc || 0;
  let n = 1;
  let first = last;
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i];
    const b = pts[i + 1];
    if ((b.t - a.t) / 1000 > PACE_HOLE || (last.t - a.t) / 1000 > PACE_WINDOW) break;
    m += haversine(a, b);
    acc += a.acc || 0;
    n++;
    first = a;
  }
  const sec = (last.t - first.t) / 1000;
  if (sec < PACE_MIN_SEC || m < PACE_MIN_M || acc / n > PACE_MAX_ACC) return null;
  const secKm = (sec / m) * 1000;
  return secKm > 3600 ? null : Math.round(secKm); // plus lent que 60 min/km : à l'arrêt
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
