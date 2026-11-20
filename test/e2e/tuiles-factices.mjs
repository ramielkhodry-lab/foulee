// Tuiles vectorielles factices (format MVT, schéma OpenMapTiles) pour tester le fond « flat »
// sans réseau : quelques rues, un fleuve, un parc, des bâtiments et un nom de quartier autour
// du point de test (48.897, 2.253). Encodeur protobuf minimal, aucune dépendance.

const LAT0 = 48.897;
const LON0 = 2.253;

function features() {
  const f = [];
  const line = (layer, cls, pts) => f.push({ layer, type: 2, props: { class: cls }, rings: [pts] });
  const poly = (layer, props, ring) => f.push({ layer, type: 3, props, rings: [ring] });
  for (let i = -12; i <= 12; i++) {
    const cls = i % 6 === 0 ? 'primary' : i % 3 === 0 ? 'tertiary' : 'minor';
    line('transportation', cls, [[LAT0 - 0.02, LON0 + i * 0.0021], [LAT0 + 0.02, LON0 + i * 0.0021 + 0.002]]);
    line('transportation', cls, [[LAT0 + i * 0.0015, LON0 - 0.03], [LAT0 + i * 0.0015 + 0.001, LON0 + 0.03]]);
  }
  line('transportation', 'motorway', [[LAT0 - 0.02, LON0 - 0.03], [LAT0 + 0.02, LON0 - 0.012]]);
  line('transportation', 'path', [[LAT0 + 0.004, LON0 + 0.004], [LAT0 + 0.006, LON0 + 0.009], [LAT0 + 0.003, LON0 + 0.012]]);
  // Fleuve : une bande en diagonale.
  poly('water', { class: 'river' }, [[LAT0 + 0.012, LON0 - 0.03], [LAT0 + 0.02, LON0 + 0.03], [LAT0 + 0.016, LON0 + 0.03], [LAT0 + 0.008, LON0 - 0.03]]);
  poly('park', { class: 'park' }, [[LAT0 + 0.002, LON0 + 0.003], [LAT0 + 0.007, LON0 + 0.003], [LAT0 + 0.007, LON0 + 0.013], [LAT0 + 0.002, LON0 + 0.013]]);
  poly('landuse', { class: 'residential' }, [[LAT0 - 0.02, LON0 - 0.03], [LAT0 + 0.008, LON0 - 0.03], [LAT0 + 0.008, LON0 + 0.03], [LAT0 - 0.02, LON0 + 0.03]]);
  for (let a = -8; a < 8; a++) for (let b = -8; b < 8; b++) {
    const la = LAT0 + a * 0.0015 + 0.0003;
    const lo = LON0 + b * 0.0021 + 0.0004;
    poly('building', {}, [[la, lo], [la + 0.0006, lo], [la + 0.0006, lo + 0.0009], [la, lo + 0.0009]]);
  }
  f.push({ layer: 'place', type: 1, props: { class: 'suburb', name: 'Quartier test' }, rings: [[[LAT0 - 0.006, LON0 - 0.01]]] });
  return f;
}
const FEATURES = features();

// --- protobuf ---
const varint = (n, out) => { n >>>= 0; while (n > 127) { out.push((n & 127) | 128); n >>>= 7; } out.push(n); };
const key = (field, wire, out) => varint((field << 3) | wire, out);
const bytes = (field, arr, out) => { key(field, 2, out); varint(arr.length, out); for (const b of arr) out.push(b); };
const str = (field, s, out) => bytes(field, [...Buffer.from(s, 'utf8')], out);
const packed = (field, nums, out) => { const b = []; for (const n of nums) varint(n, b); bytes(field, b, out); };
const zz = (n) => ((n << 1) ^ (n >> 31)) >>> 0;

function tile(z, x, y) {
  const E = 4096;
  const n = 2 ** z;
  const px = (lat, lon) => {
    const fx = ((lon + 180) / 360) * n;
    const r = (lat * Math.PI) / 180;
    const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
    return [Math.round((fx - x) * E), Math.round((fy - y) * E)];
  };
  const layers = {};
  for (const f of FEATURES) {
    const rings = f.rings.map((r) => r.map(([la, lo]) => px(la, lo)));
    const xs = rings.flat().map((p) => p[0]);
    const ys = rings.flat().map((p) => p[1]);
    if (Math.max(...xs) < -256 || Math.min(...xs) > E + 256 || Math.max(...ys) < -256 || Math.min(...ys) > E + 256) continue;
    (layers[f.layer] ||= []).push({ ...f, rings });
  }
  const out = [];
  for (const [name, feats] of Object.entries(layers)) {
    const keys = [];
    const vals = [];
    const L = [];
    varint((15 << 3) | 0, L); varint(2, L);
    str(1, name, L);
    feats.forEach((f, id) => {
      const F = [];
      key(1, 0, F); varint(id + 1, F);
      const tags = [];
      for (const [k, v] of Object.entries(f.props)) {
        let ki = keys.indexOf(k); if (ki < 0) { keys.push(k); ki = keys.length - 1; }
        let vi = vals.indexOf(v); if (vi < 0) { vals.push(v); vi = vals.length - 1; }
        tags.push(ki, vi);
      }
      if (tags.length) packed(2, tags, F);
      key(3, 0, F); varint(f.type, F);
      const g = [];
      let cx = 0;
      let cy = 0;
      for (const ring of f.rings) {
        // Polygone : anneau extérieur dans le sens des aiguilles d'une montre (aire > 0, y vers le bas).
        const area = ring.reduce((acc, p, i) => { const q = ring[(i + 1) % ring.length]; return acc + (p[0] * q[1] - q[0] * p[1]); }, 0);
        const pts = f.type === 3 && area < 0 ? [...ring].reverse() : ring;
        g.push((1 & 7) | (1 << 3), zz(pts[0][0] - cx), zz(pts[0][1] - cy));
        cx = pts[0][0]; cy = pts[0][1];
        if (pts.length > 1) {
          g.push((2 & 7) | ((pts.length - 1) << 3));
          for (const p of pts.slice(1)) { g.push(zz(p[0] - cx), zz(p[1] - cy)); cx = p[0]; cy = p[1]; }
        }
        if (f.type === 3) g.push((7 & 7) | (1 << 3));
      }
      packed(4, g, F);
      bytes(2, F, L);
    });
    for (const k of keys) str(3, k, L);
    for (const v of vals) { const V = []; str(1, String(v), V); bytes(4, V, L); }
    key(5, 0, L); varint(E, L);
    bytes(3, L, out);
  }
  return Buffer.from(out);
}

// À brancher sur une page Playwright : sert la TileJSON, les tuiles et refuse les polices.
export async function routeTuiles(page) {
  await page.route('https://tiles.openfreemap.org/**', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/planet') {
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/t/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14, bounds: [-180, -85, 180, 85] }) });
    }
    const m = u.pathname.match(/^\/t\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (m) return r.fulfill({ status: 200, contentType: 'application/x-protobuf', headers: { 'access-control-allow-origin': '*' }, body: tile(+m[1], +m[2], +m[3]) });
    return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
  });
}
