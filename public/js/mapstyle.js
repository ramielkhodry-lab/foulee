// Fond de carte « flat » de Foulée : tuiles vectorielles OpenFreeMap (gratuites, sans clé, sans
// limite annoncée : https://openfreemap.org/tos/), dessinées par MapLibre avec un style maison.
// Des aplats aux couleurs du thème noir : pas de relief, pas de textures, pas de contours,
// très peu de noms (quartiers et villes seulement). Le tracé garde seul la couleur vive.

export const TILES = 'https://tiles.openfreemap.org/planet';
export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Données <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© les contributeurs OpenStreetMap</a>';
export const ATTRIBUTION_TEXT = 'OpenFreeMap © OpenMapTiles · © contributeurs OpenStreetMap';

export const FLAT = {
  bg: '#0C0C0E',
  water: '#10151D',
  green: '#0F1410',
  urban: '#101012',
  building: '#141417',
  minor: '#1D1D21',
  major: '#29292E',
  motorway: '#33333A',
  rail: '#1A1A1E',
  label: '#5E5E66',
};

const w = (stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops.flat()];

export function flatStyle() {
  const c = FLAT;
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: { omt: { type: 'vector', url: TILES, attribution: ATTRIBUTION } },
    layers: [
      { id: 'fond', type: 'background', paint: { 'background-color': c.bg } },
      { id: 'urbain', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'industrial', 'retail']]], paint: { 'fill-color': c.urban } },
      { id: 'vert', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood', 'farmland']]], paint: { 'fill-color': c.green } },
      { id: 'parcs', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': c.green } },
      { id: 'eau', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      { id: 'rivieres', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': c.water, 'line-width': w([[10, 1], [16, 4]]) } },
      { id: 'batiments', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': c.building } },
      { id: 'chemins', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13, filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]], layout: { 'line-cap': 'round' }, paint: { 'line-color': c.minor, 'line-width': w([[13, 0.5], [18, 2]]) } },
      { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': c.rail, 'line-width': w([[10, 0.5], [16, 2]]) } },
      { id: 'rues', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'tertiary']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.minor, 'line-width': w([[11, 0.5], [14, 2], [18, 12]]) } },
      { id: 'axes', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'trunk']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.major, 'line-width': w([[8, 0.5], [13, 2.5], [18, 18]]) } },
      { id: 'autoroutes', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'motorway'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.motorway, 'line-width': w([[6, 0.5], [13, 3], [18, 20]]) } },
      { id: 'lieux', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village', 'suburb', 'quarter']]],
        layout: { 'text-field': ['coalesce', ['get', 'name:fr'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': ['match', ['get', 'class'], 'city', 14, 'town', 13, 11], 'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 8 },
        paint: { 'text-color': c.label, 'text-halo-color': c.bg, 'text-halo-width': 1.2 } },
    ],
  };
}
