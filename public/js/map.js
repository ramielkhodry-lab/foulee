// Carte du parcours : Leaflet (livré avec l'app) et fond de carte CARTO sombre,
// construit sur OpenStreetMap. Gratuit, sans clé ; chargé seulement quand une carte s'affiche.

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
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd',
    attribution: '© OpenStreetMap · © CARTO',
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
