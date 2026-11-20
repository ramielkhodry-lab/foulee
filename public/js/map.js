// Carte du parcours : Leaflet (livré avec l'app) pour le tracé et les points à glisser, et dessous
// un fond « flat » vectoriel (MapLibre + tuiles OpenFreeMap, gratuites et sans clé, style maison
// dans mapstyle.js). Sans WebGL ou si MapLibre ne charge pas : tuiles OSM assombries en CSS.
// Tout est chargé seulement quand une carte s'affiche (MapLibre : ~280 Ko compressé).
import { flatStyle } from './mapstyle.js';

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">les contributeurs OpenStreetMap</a>';

function script(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('carte indisponible'));
    document.head.appendChild(s);
  });
}
function css(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.appendChild(l);
}

let leaflet = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leaflet ||= (css('vendor/leaflet/leaflet.css'), script('vendor/leaflet/leaflet.js').then(() => window.L, (e) => { leaflet = null; throw e; }));
  return leaflet;
}

export const webgl = () => {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
};

// MapLibre seul (image de partage) ; avec le pont Leaflet si `withLeaflet`.
let maplibre = null;
export function loadMaplibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  maplibre ||= (css('vendor/maplibre/maplibre-gl.css'), script('vendor/maplibre/maplibre-gl.js').then(() => window.maplibregl, (e) => { maplibre = null; throw e; }));
  return maplibre;
}
let bridge = null;
function loadBridge() {
  bridge ||= Promise.all([loadLeaflet(), loadMaplibre()]).then(() => (window.L.maplibreGL ? null : script('vendor/maplibre/leaflet-maplibre-gl.js'))).then(() => window.L);
  return bridge;
}

// Chaque fond flat tient un contexte WebGL, et Safari n'en garde qu'une poignée (au-delà il
// coupe les plus anciens). Les cartes dont l'écran a été redessiné sont libérées, et au-delà de
// MAX_FLAT cartes visibles en même temps, les suivantes prennent le fond OSM.
const MAX_FLAT = 6;
const flats = new Set();
function freeFlats() {
  for (const m of flats) if (!m.getContainer().isConnected) { try { m.remove(); } catch { /* déjà libérée */ } flats.delete(m); }
}

// Fond de carte d'une carte Leaflet : flat vectoriel si possible, sinon OSM assombri.
async function baseLayer(L, map) {
  freeFlats();
  if (webgl() && flats.size < MAX_FLAT) {
    try {
      await loadBridge();
      L.maplibreGL({ style: flatStyle() }).addTo(map);
      flats.add(map);
      map.getContainer().classList.add('map-flat');
      return;
    } catch { /* repli ci-dessous */ }
  }
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'map-osm', attribution: OSM_ATTR }).addTo(map);
}

// segments : [[[lat, lon, secondes], ...], ...]. Un segment par période où le GPS a suivi.
export async function drawTrace(el, segments) {
  if (!el || el.dataset.drawn || !segments.length) return;
  el.dataset.drawn = '1';
  let L;
  try {
    L = await loadLeaflet();
  } catch {
    el.textContent = 'Carte indisponible hors connexion.';
    return;
  }
  const map = await baseMap(L, el);
  const lines = segments.map((seg) => seg.map(([lat, lon]) => [lat, lon]));
  for (const line of lines) {
    L.polyline(line, { color: '#C8FF2E', weight: 9, opacity: 0.22, lineCap: 'round' }).addTo(map);
    L.polyline(line, { color: '#C8FF2E', weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  }
  // Tronçons perdus (écran verrouillé) : pointillés gris entre deux segments.
  for (let i = 1; i < lines.length; i++) {
    L.polyline([lines[i - 1].at(-1), lines[i][0]], { color: '#9A9AA1', weight: 2, dashArray: '4 6' }).addTo(map);
  }
  const start = lines[0][0];
  const end = lines.at(-1).at(-1);
  L.circleMarker(start, { radius: 6, color: '#000', weight: 2, fillColor: '#FFFFFF', fillOpacity: 1 }).addTo(map);
  L.circleMarker(end, { radius: 7, color: '#000', weight: 2, fillColor: '#C8FF2E', fillOpacity: 1 }).addTo(map);
  map.fitBounds(L.latLngBounds(lines.flat()), { padding: [24, 24] });
}

async function baseMap(L, el, opts = {}) {
  const map = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, ...opts });
  await baseLayer(L, map);
  return map;
}

// Parcours proposé (avant de partir) : la boucle, le départ et des points de passage
// qu'on peut glisser. `onMove(waypoints)` est appelé quand un point a été déplacé.
export async function drawParcours(el, { start, line, waypoints }, onMove) {
  const L = await loadLeaflet();
  if (!el.isConnected) return null;
  const map = await baseMap(L, el);
  L.polyline(line, { color: '#C8FF2E', weight: 9, opacity: 0.22, lineCap: 'round' }).addTo(map);
  L.polyline(line, { color: '#C8FF2E', weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  L.circleMarker(start, { radius: 8, color: '#000', weight: 3, fillColor: '#FFFFFF', fillOpacity: 1 }).addTo(map).bindTooltip('Départ et arrivée');
  const pins = waypoints.map((w, i) => {
    const m = L.marker(w, {
      draggable: true,
      icon: L.divIcon({ className: 'wp-pin', html: `<b>${i + 1}</b>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
    }).addTo(map);
    m.on('dragend', () => onMove?.(pins.map((p) => { const ll = p.getLatLng(); return [ll.lat, ll.lng]; })));
    return m;
  });
  map.fitBounds(L.latLngBounds([start, ...line, ...waypoints]), { padding: [28, 28] });
  return map;
}

// Pendant la séance : le parcours proposé en blanc dessous, ce que tu as couru en vert dessus,
// ta position actuelle. `update(points)` redessine le tracé ([[lat, lon], ...]).
export async function liveParcoursMap(el, line) {
  const L = await loadLeaflet();
  if (!el.isConnected) return null;
  const map = await baseMap(L, el, { dragging: true });
  L.polyline(line, { color: '#FFFFFF', weight: 5, opacity: 0.55, dashArray: '2 9', lineCap: 'round' }).addTo(map);
  const done = L.polyline([], { color: '#C8FF2E', weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  const me = L.circleMarker(line[0], { radius: 7, color: '#000', weight: 2, fillColor: '#C8FF2E', opacity: 0, fillOpacity: 0 }).addTo(map);
  map.fitBounds(L.latLngBounds(line), { padding: [20, 20] });
  return {
    update(points) {
      done.setLatLngs(points);
      const last = points.at(-1);
      if (last) me.setLatLng(last).setStyle({ opacity: 1, fillOpacity: 1 });
    },
    remove: () => { flats.delete(map); map.remove(); },
  };
}
