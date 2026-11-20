// Carte du parcours : Leaflet (livré avec l'app) et fond de carte OpenStreetMap, gratuit et
// sans clé (CARTO exige désormais une clé : ses tuiles affichaient « API KEY REQUIRED »).
// Les tuiles OSM sont claires : on les assombrit en CSS (.map-osm), le tracé garde ses couleurs.
// Chargé seulement quand une carte s'affiche.

let leaflet = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leaflet ||= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/leaflet/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'vendor/leaflet/leaflet.js';
    s.onload = () => resolve(window.L);
    s.onerror = () => { leaflet = null; reject(new Error('carte indisponible')); };
    document.head.appendChild(s);
  });
  return leaflet;
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
  const map = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'map-osm',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">les contributeurs OpenStreetMap</a>',
  }).addTo(map);
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

function baseMap(L, el, opts = {}) {
  const map = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, ...opts });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'map-osm',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">les contributeurs OpenStreetMap</a>',
  }).addTo(map);
  return map;
}

// Parcours proposé (avant de partir) : la boucle, le départ et des points de passage
// qu'on peut glisser. `onMove(waypoints)` est appelé quand un point a été déplacé.
export async function drawParcours(el, { start, line, waypoints }, onMove) {
  const L = await loadLeaflet();
  if (!el.isConnected) return null;
  const map = baseMap(L, el);
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
  const map = baseMap(L, el, { dragging: true });
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
    remove: () => map.remove(),
  };
}
