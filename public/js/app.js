import { KINDS } from './phrases.js';
import { assemble, stepAt } from './track.js';
import { load, update, uid, PRESETS } from './store.js';
import { createTrack, addPoint, markGap, summary } from './gps.js';

const app = document.getElementById('app');
const audio = document.getElementById('player');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mmss = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const minutesLabel = (sec) => (sec < 60 ? `${sec} s` : sec % 60 ? `${Math.floor(sec / 60)} min ${sec % 60} s` : `${sec / 60} min`);
const total = (steps) => steps.reduce((a, s) => a + s.duration, 0);
const today = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ, heure locale
const dateLabel = (d) => new Date(String(d).length === 10 ? `${d}T12:00` : d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const allure = (secKm) => `${Math.floor(secKm / 60)}'${String(Math.round(secKm % 60)).padStart(2, '0')}/km`;

function journalCard(h) {
  const sport = h.sport || 'course';
  const parts = [];
  if (h.elapsedSec) parts.push(`${Math.round(h.elapsedSec / 60)} min`);
  if (sport === 'natation' && h.swim?.longueurs) parts.push(`${h.swim.longueurs} × ${h.swim.bassinM} m = ${h.swim.longueurs * h.swim.bassinM} m`);
  if (h.distanceKm && sport !== 'natation') parts.push(`${h.distanceKm.toLocaleString('fr-FR')} km${h.distanceEstimee ? ' (estimé)' : ''}`);
  if (h.allureSecKm) parts.push(`allure ${allure(h.allureSecKm)}`);
  if (h.gpsIncomplet) parts.push('GPS incomplet');
  if (h.steps && h.source === 'guidee') parts.push(`${h.completedSteps}/${h.steps.length} étapes`);
  const feel = [
    h.difficulte && `difficulté ${h.difficulte}/5`,
    h.essoufflement && `essoufflement ${h.essoufflement}/5`,
    h.fatigue && `fatigue ${h.fatigue}/5`,
    h.douleur && `douleur : ${esc(h.douleur)}`,
  ].filter(Boolean);
  return `
    <div class="card">
      <p><span class="pill">${sport === 'natation' ? 'Natation' : 'Course'}</span> <strong>${dateLabel(h.date)}</strong></p>
      <p class="muted">${parts.join(' · ')}</p>
      ${sport === 'natation' && h.swim?.nages?.length ? `<p class="small">${esc(h.swim.nages.join(', '))}${h.swim.detail ? ` · ${esc(h.swim.detail)}` : ''}</p>` : ''}
      ${h.structure ? `<p class="small">${esc(h.structure)}</p>` : ''}
      ${feel.length ? `<p class="muted small">${feel.join(' · ')}</p>` : ''}
      ${h.commentaire ? `<p>« ${esc(h.commentaire)} »</p>` : ''}
    </div>`;
}

// --- Sons -------------------------------------------------------------------

let audioAssets = null;
async function loadAudio() {
  if (audioAssets) return audioAssets;
  const [index, pack] = await Promise.all([
    fetch('audio/index.json').then((r) => r.json()),
    fetch('audio/pack.mp3').then((r) => r.arrayBuffer()),
  ]);
  audioAssets = { index, pack: new Uint8Array(pack) };
  return audioAssets;
}
loadAudio().catch(() => {});

function applyAudioMode() {
  // Exclusif : la séance continue écran verrouillé mais met la musique en pause.
  // Mélange : se superpose à la musique, mais risque de s'arrêter écran verrouillé.
  if (!('audioSession' in navigator)) return;
  try {
    navigator.audioSession.type = load().settings.audioMode === 'melange' ? 'ambient' : 'playback';
  } catch {}
}

// --- Séance en cours ----------------------------------------------------------

let live = null; // { session, track, url, skipped:Set, maxTime, lastStep }

function startSession(session) {
  if (!audioAssets) {
    alert('Les sons ne sont pas encore chargés. Réessaie dans quelques secondes.');
    loadAudio();
    return;
  }
  // Tout se fait sans attente pour rester dans le geste de l'utilisateur :
  // iOS refuse de lancer l'audio sinon.
  const track = assemble(session.steps, audioAssets.index, audioAssets.pack, { voice: load().settings.annonces === 'voix' });
  if (live) URL.revokeObjectURL(live.url);
  const url = URL.createObjectURL(new Blob([track.bytes], { type: 'audio/mpeg' }));
  stopLiveExtras();
  live = { session, track, url, skipped: new Set(), maxTime: 0, lastStep: null, startedAt: new Date().toISOString(), gps: createTrack(), gpsError: null };
  applyAudioMode();
  audio.src = url;
  audio.currentTime = 0;
  audio.play().catch((e) => alert(`Lecture impossible : ${e.message}`));
  setupMediaSession();
  startGps();
  keepAwake();
  go('live');
}

// GPS : actif tant que la page est à l'écran. Écran verrouillé = coupure notée.
let gpsWatch = null;
function startGps() {
  if (!('geolocation' in navigator)) { live.gpsError = 'GPS indisponible'; return; }
  gpsWatch = navigator.geolocation.watchPosition(
    (pos) => {
      if (!live) return;
      live.gpsError = null;
      // Pas de distance pendant une pause : on ne compte que le temps de séance.
      if (audio.paused) return;
      addPoint(live.gps, { lat: pos.coords.latitude, lon: pos.coords.longitude, t: pos.timestamp, acc: pos.coords.accuracy });
    },
    (err) => { if (live) live.gpsError = err.code === 1 ? 'GPS refusé' : 'GPS en attente'; },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );
}

// Empêche l'iPhone de verrouiller l'écran pendant la séance (Safari 16.4+).
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}

function stopLiveExtras() {
  if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
  gpsWatch = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  touchLocked = false;
}

document.addEventListener('visibilitychange', () => {
  if (!live || current !== 'live') return;
  if (document.visibilityState === 'hidden') markGap(live.gps);
  else keepAwake();
});

// Verrou tactile : en poche, l'écran allumé ne doit pas réagir au tissu.
let touchLocked = false;
let unlockTimer = null;
function renderTouchLock() {
  let el = document.getElementById('touchlock');
  if (!touchLocked) { el?.remove(); return; }
  if (el) return;
  el = document.createElement('div');
  el.id = 'touchlock';
  el.innerHTML = '<div class="lockhint">Écran verrouillé<br><span class="small">Appui long 2 secondes pour déverrouiller</span></div>';
  const cancel = () => { clearTimeout(unlockTimer); el.classList.remove('pressing'); };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.classList.add('pressing');
    unlockTimer = setTimeout(() => { touchLocked = false; renderTouchLock(); }, 2000);
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  document.body.appendChild(el);
}

function seekToStep(i) {
  if (!live) return;
  const { starts, end } = live.track;
  const t = i >= starts.length ? end : starts[Math.max(0, i)];
  audio.currentTime = t;
}

function nextStep() {
  if (!live) return;
  const cur = stepAt(live.track.starts, live.track.end, audio.currentTime);
  if (cur >= 0 && cur < live.session.steps.length) live.skipped.add(cur);
  seekToStep(cur + 1);
}

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (action, fn) => {
    try { ms.setActionHandler(action, fn); } catch {}
  };
  set('play', () => audio.play());
  set('pause', () => audio.pause());
  set('nexttrack', nextStep);
  set('previoustrack', () => seekToStep(stepAt(live.track.starts, live.track.end, audio.currentTime)));
  set('seekforward', null);
  set('seekbackward', null);
  updateMediaMetadata(-1);
}

function updateMediaMetadata(i) {
  if (!('mediaSession' in navigator) || !live) return;
  const steps = live.session.steps;
  const title = i < 0 ? 'Introduction' : i >= steps.length ? 'Séance terminée' : `${KINDS[steps[i].kind].label} · ${minutesLabel(steps[i].duration)}`;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: `Foulée · ${live.session.name}`,
      artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  } catch {}
}

audio.addEventListener('timeupdate', () => {
  if (!live) return;
  live.maxTime = Math.max(live.maxTime, audio.currentTime);
  const i = stepAt(live.track.starts, live.track.end, audio.currentTime);
  if (i !== live.lastStep) {
    live.lastStep = i;
    updateMediaMetadata(i);
  }
});
audio.addEventListener('ended', () => {
  if (live && current === 'live') go('bilan');
});
audio.addEventListener('pause', () => current === 'live' && render());
audio.addEventListener('play', () => current === 'live' && render());

// Affichage du lecteur : relu à chaque image depuis la position de la piste, donc sans dérive.
function tick() {
  if (current !== 'live' || !live) return;
  const { starts, end } = live.track;
  const steps = live.session.steps;
  const t = audio.currentTime;
  const i = stepAt(starts, end, t);
  const el = (id) => document.getElementById(id);
  if (!el('count')) return;
  // Changement d'étape : l'écran clignote (citron = course, blanc = marche).
  if (live.shownStep !== undefined && i !== live.shownStep && i >= 0 && i < steps.length) {
    const flash = KINDS[steps[i].kind].effort === 'course' ? 'flash-course' : 'flash-marche';
    document.body.classList.remove('flash-course', 'flash-marche');
    void document.body.offsetWidth;
    document.body.classList.add(flash);
    setTimeout(() => document.body.classList.remove(flash), 1500);
  }
  live.shownStep = i;
  if (i < 0) {
    el('now').textContent = 'Prépare-toi';
    el('count').textContent = mmss(starts[0] - t);
    el('next').textContent = `Ensuite : ${KINDS[steps[0].kind].label}`;
  } else if (i >= steps.length) {
    el('now').textContent = 'Terminé !';
    el('count').textContent = '0:00';
    el('next').textContent = '';
  } else {
    el('now').textContent = KINDS[steps[i].kind].label;
    el('count').textContent = mmss(starts[i] + steps[i].duration - t);
    const n = steps[i + 1];
    el('next').textContent = n ? `Ensuite : ${KINDS[n.kind].label} · ${minutesLabel(n.duration)}` : 'Dernière étape';
  }
  el('stepno').textContent = i < 0 ? '' : `Étape ${Math.min(i + 1, steps.length)} sur ${steps.length}`;
  el('progress').style.width = `${Math.min(100, ((t - starts[0]) / (end - starts[0])) * 100)}%`;
  el('elapsed').textContent = `${mmss(Math.max(0, t - starts[0]))} / ${mmss(end - starts[0])}`;
  const g = summary(live.gps, Math.max(0, t - starts[0]));
  el('gps').textContent = live.gpsError
    ? live.gpsError
    : g.distanceKm
      ? `${g.distanceKm.toLocaleString('fr-FR')} km${g.allureSecKm ? ` · ${allure(g.allureSecKm)}` : ''}${g.gpsIncomplet ? ' · GPS coupé un moment' : ''}`
      : 'GPS : recherche…';
  requestAnimationFrame(tick);
}

// --- Écrans -------------------------------------------------------------------

let current = 'accueil';
let editing = null; // séance en cours d'édition (copie)
let bilan = null; // formulaire de bilan en cours

const screens = {
  accueil() {
    const d = load();
    const last = [...d.history].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const installed = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    const next = d.sessions[0];
    const hello = d.profile.prenom ? `Bonjour ${esc(d.profile.prenom)} !` : 'Bonjour !';
    return `
      <h1>${hello}</h1>
      ${installed ? '' : '<div class="notice"><strong>Installe Foulée :</strong> dans Safari, touche Partager puis « Sur l\'écran d\'accueil », et ouvre l\'app depuis son icône. Le guidage est plus fiable ainsi.</div>'}
      <div class="card dark">
        <span class="pill">Prochaine séance</span>
        <h2 style="margin-top:10px">${esc(next.name)}</h2>
        <p class="muted">${minutesLabel(total(next.steps))} · ${next.steps.length} étapes. Reste à une intensité où tu peux parler.</p>
        <ul class="steps">${next.steps.map((s) => `<li><span>${KINDS[s.kind].label}</span><span>${minutesLabel(s.duration)}</span></li>`).join('')}</ul>
        <p style="margin-top:14px"><button class="btn-primary" data-start="${esc(next.id)}">Démarrer la séance</button></p>
      </div>
      ${last ? `<h2 style="margin:4px 0 10px">Dernière séance</h2>${journalCard(last)}` : ''}
      <div class="notice">Prototype de test : tes séances sont enregistrées sur ce téléphone uniquement. Les comptes et le coach arrivent ensuite.</div>`;
  },

  seance() {
    const d = load();
    return `
      <h1>Séances</h1>
      ${d.sessions.map((s) => `
        <div class="card">
          <h2>${esc(s.name)}</h2>
          <p class="muted">${minutesLabel(total(s.steps))} · ${s.steps.length} étapes</p>
          <div class="row"><button class="btn-dark" data-start="${esc(s.id)}">Démarrer</button><button data-edit="${esc(s.id)}">Modifier</button></div>
        </div>`).join('')}
      <button data-new style="width:100%">+ Nouvelle séance</button>`;
  },

  edit() {
    const s = editing;
    const opts = (k) => Object.entries(KINDS).map(([id, v]) => `<option value="${id}" ${id === k ? 'selected' : ''}>${v.label}</option>`).join('');
    return `
      <h1>${s.isNew ? 'Nouvelle séance' : 'Modifier la séance'}</h1>
      <div class="card">
        <label for="name">Nom</label>
        <input id="name" value="${esc(s.name)}" maxlength="60">
        <label>Étapes <span class="muted small">(activité · min · s)</span></label>
        ${s.steps.map((st, i) => `
          <div class="edit-step">
            <select data-kind="${i}">${opts(st.kind)}</select>
            <input data-min="${i}" type="number" inputmode="numeric" min="0" max="240" value="${Math.floor(st.duration / 60)}">
            <input data-sec="${i}" type="number" inputmode="numeric" min="0" max="59" step="5" value="${st.duration % 60}">
            <button data-del="${i}" aria-label="Supprimer l'étape">✕</button>
          </div>`).join('')}
        <button data-add style="width:100%;margin-top:6px">+ Ajouter une étape</button>
        <p class="muted small" style="margin-top:10px">Total : ${minutesLabel(total(s.steps))}. Chaque étape dure au moins 10 secondes. Les durées rondes (minutes entières, 30 s, 1 min 30, 2 min 30) sont annoncées à voix haute.</p>
      </div>
      <div class="row"><button data-cancel>Annuler</button><button class="btn-dark" data-save>Enregistrer</button></div>
      ${s.isNew ? '' : '<p style="margin-top:10px"><button class="btn-danger" data-remove style="width:100%">Supprimer cette séance</button></p>'}`;
  },

  live() {
    const playing = !audio.paused;
    return `
      <div class="card dark live" style="margin-top:20px">
        <p class="muted small" id="stepno"></p>
        <p class="now" id="now"></p>
        <p class="count" id="count"></p>
        <p class="next muted" id="next"></p>
        <div class="bar"><div id="progress"></div></div>
        <p class="muted small" id="elapsed"></p>
        <p class="gpsline" id="gps"></p>
      </div>
      <div class="live-controls">
        <button class="btn-dark" data-toggle>${playing ? 'Pause' : 'Reprendre'}</button>
        <button data-skip>Étape suivante</button>
      </div>
      <p style="margin-top:10px"><button class="btn-primary" data-touchlock>Verrouiller l'écran (poche)</button></p>
      <p style="margin-top:10px"><button data-finish style="width:100%">Terminer et faire le bilan</button></p>
      <p class="muted small" style="margin-top:12px">Garde l'écran allumé pour mesurer la distance. Si l'iPhone se verrouille, la voix continue mais le GPS s'arrête.</p>`;
  },

  bilan() {
    const b = bilan;
    const scale = (field, labels) => `<div class="scale">${[1, 2, 3, 4, 5].map((n) => `<button data-scale="${field}" data-v="${n}" class="${b[field] === n ? 'on' : ''}">${n}</button>`).join('')}</div><p class="muted small">${labels}</p>`;
    return `
      <h1>Bilan de la séance</h1>
      <div class="card">
        <p><strong>${esc(b.sessionName)}</strong></p>
        <p class="muted">${mmss(b.elapsedSec)} de séance · ${b.completedSteps} étape(s) sur ${b.steps.length}${b.skipped.length ? ` · ${b.skipped.length} passée(s)` : ''}</p>
        ${b.distanceSource === 'gps' ? `<p class="small">GPS : ${b.distanceKm.toLocaleString('fr-FR')} km${b.allureSecKm ? ` · ${allure(b.allureSecKm)}` : ''}${b.gpsIncomplet ? ' · <strong>incomplet</strong> (écran verrouillé un moment)' : ''}</p>` : ''}
        <label for="dist">Distance (km${b.distanceSource === 'gps' ? ', corrige si besoin' : ', facultatif'})</label>
        <input id="dist" type="number" inputmode="decimal" step="0.01" min="0" value="${b.distanceKm ?? ''}">
        <label style="font-weight:400"><input id="estim" type="checkbox" style="width:auto" ${b.distanceEstimee ? 'checked' : ''}> C'est une estimation</label>
        <label>Difficulté</label>
        ${scale('difficulte', '1 = très facile · 5 = très dur')}
        <label>Fatigue</label>
        ${scale('fatigue', '1 = en forme · 5 = épuisé')}
        <label for="douleur">Une douleur ?</label>
        <input id="douleur" placeholder="Ex. : mollet droit, légère" value="${esc(b.douleur)}">
        <label for="comm">Ton ressenti</label>
        <textarea id="comm" placeholder="Ex. : assez essoufflé à la fin, mais j'aurais pu continuer deux minutes.">${esc(b.commentaire)}</textarea>
      </div>
      <button class="btn-primary" data-savebilan>Enregistrer</button>
      <p class="muted small" style="margin-top:10px">La douleur et ton ressenti restent privés.</p>`;
  },

  journal() {
    const d = load();
    const sorted = [...d.history].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return `
      <h1>Journal</h1>
      <div class="row" style="margin-bottom:14px"><button data-manual="natation">+ Natation</button><button data-manual="course">+ Course libre</button></div>
      ${sorted.length === 0 ? '<p class="muted">Aucune séance pour l\'instant.</p>' : ''}
      ${sorted.map(journalCard).join('')}
      ${sorted.length ? '<button data-export style="width:100%">Exporter mes données (JSON)</button>' : ''}`;
  },

  saisie() {
    const b = bilan;
    const swim = b.sport === 'natation';
    const scale = (field, labels) => `<div class="scale">${[1, 2, 3, 4, 5].map((n) => `<button data-scale="${field}" data-v="${n}" class="${b[field] === n ? 'on' : ''}">${n}</button>`).join('')}</div><p class="muted small">${labels}</p>`;
    const nages = ['crawl', 'brasse', 'dos', 'papillon'];
    return `
      <h1>${swim ? 'Séance de natation' : 'Course libre'}</h1>
      <div class="card">
        <label for="date">Date</label>
        <input id="date" type="date" value="${esc(b.date)}">
        <label for="duree">Durée (minutes)</label>
        <input id="duree" type="number" inputmode="numeric" min="1" max="600" value="${b.elapsedSec ? Math.round(b.elapsedSec / 60) : ''}">
        ${swim ? `
          <label for="bassin">Longueur du bassin (m)</label>
          <select id="bassin">${[25, 50, 33].map((m) => `<option value="${m}" ${b.swim.bassinM === m ? 'selected' : ''}>${m} m</option>`).join('')}</select>
          <label for="longueurs">Nombre de longueurs</label>
          <input id="longueurs" type="number" inputmode="numeric" min="0" max="400" value="${b.swim.longueurs ?? ''}">
          <p class="muted small" id="swimdist">${b.swim.longueurs ? `Distance : ${b.swim.longueurs * b.swim.bassinM} m` : ''}</p>
          <label>Nages</label>
          ${nages.map((n) => `<label style="font-weight:400;margin:4px 0"><input type="checkbox" data-nage="${n}" style="width:auto" ${b.swim.nages.includes(n) ? 'checked' : ''}> ${n}</label>`).join('')}
          <label for="detail">Détail (nages, éducatifs, pauses)</label>
          <textarea id="detail" placeholder="Ex. : les 10 dernières longueurs en dos, pauses de 30 s au bord">${esc(b.swim.detail)}</textarea>
        ` : `
          <label for="structure">Déroulé</label>
          <textarea id="structure" placeholder="Ex. : 5 min marche, 6 × (3 min course + 2 min marche), 6 min marche">${esc(b.structure)}</textarea>
          <label for="dist">Distance (km)</label>
          <input id="dist" type="number" inputmode="decimal" step="0.01" min="0" value="${b.distanceKm ?? ''}">
          <label style="font-weight:400"><input id="estim" type="checkbox" style="width:auto" ${b.distanceEstimee ? 'checked' : ''}> C'est une estimation</label>
        `}
        <label>Difficulté</label>
        ${scale('difficulte', '1 = très facile · 5 = très dur')}
        <label>Essoufflement</label>
        ${scale('essoufflement', '1 = je pouvais parler · 5 = à bout de souffle')}
        <label>Fatigue</label>
        ${scale('fatigue', '1 = en forme · 5 = épuisé')}
        <label for="douleur">Une douleur ?</label>
        <input id="douleur" placeholder="Ex. : épaule gauche, légère" value="${esc(b.douleur)}">
        <label for="comm">Ton ressenti</label>
        <textarea id="comm">${esc(b.commentaire)}</textarea>
      </div>
      <div class="row"><button data-tab="journal">Annuler</button><button class="btn-dark" data-savemanual>Enregistrer</button></div>`;
  },

  reglages() {
    const d = load();
    const supported = 'audioSession' in navigator;
    return `
      <h1>Réglages</h1>
      <div class="card">
        <label for="prenom">Ton prénom</label>
        <input id="prenom" value="${esc(d.profile.prenom)}" maxlength="40">
      </div>
      <div class="card">
        <h2>Signal de changement d'étape</h2>
        <label style="font-weight:400"><input type="radio" name="annonces" value="signaux" style="width:auto" ${d.settings.annonces !== 'voix' ? 'checked' : ''}> <strong>Signaux sonores</strong> : notes qui montent = cours, notes qui descendent = marche, 3 bips avant chaque changement.</label>
        <label style="font-weight:400"><input type="radio" name="annonces" value="voix" style="width:auto" ${d.settings.annonces === 'voix' ? 'checked' : ''}> <strong>Voix</strong> : annonce chaque étape et sa durée.</label>
      </div>
      <div class="card">
        <h2>Son pendant la séance</h2>
        <label style="font-weight:400"><input type="radio" name="mode" value="exclusif" style="width:auto" ${d.settings.audioMode !== 'melange' ? 'checked' : ''}> <strong>Guidage prioritaire</strong> : continue écran verrouillé, met ta musique en pause.</label>
        <label style="font-weight:400"><input type="radio" name="mode" value="melange" style="width:auto" ${d.settings.audioMode === 'melange' ? 'checked' : ''}> <strong>Avec ma musique</strong> (à tester) : se mélange à ta musique, peut s'arrêter écran verrouillé.</label>
        ${supported ? '' : '<p class="muted small">Ce navigateur ne permet pas de choisir : le mode par défaut s\'applique.</p>'}
      </div>
      <div class="card">
        <h2>Mes données</h2>
        <p class="muted small">Importer un fichier d'export Foulée ou un historique préparé. Les séances déjà présentes ne sont pas dupliquées.</p>
        <button data-import style="width:100%">Importer des données (JSON)</button>
        <input id="importfile" type="file" accept="application/json,.json" hidden>
      </div>
      <p class="muted small">Voix : modèle libre « siwis » (Piper, licence CC-BY 4.0, Université d'Édimbourg).</p>`;
  },
};

function render() {
  app.innerHTML = screens[current]();
  for (const b of document.querySelectorAll('#tabs button')) {
    const tab = b.dataset.tab;
    b.classList.toggle('on', tab === current || (tab === 'seance' && ['edit', 'live', 'bilan'].includes(current)));
  }
  if (current === 'live') requestAnimationFrame(tick);
}

function go(screen) {
  if (screen === 'bilan' && live) {
    audio.pause();
    const { starts, end } = live.track;
    const steps = live.session.steps;
    const reached = Math.min(live.maxTime, end);
    const lastIdx = stepAt(starts, end, reached);
    const completed = lastIdx >= steps.length ? steps.length : Math.max(0, lastIdx);
    const elapsedSec = Math.round(Math.max(0, reached - starts[0]));
    const gps = summary(live.gps, elapsedSec);
    stopLiveExtras();
    renderTouchLock();
    bilan = {
      id: uid(),
      sport: 'course',
      source: 'guidee',
      date: live.startedAt,
      sessionName: live.session.name,
      steps: steps,
      plannedSec: total(steps),
      elapsedSec,
      completedSteps: completed,
      skipped: [...live.skipped],
      distanceKm: gps.distanceKm,
      distanceEstimee: false,
      distanceSource: gps.distanceKm ? 'gps' : null,
      allureSecKm: gps.allureSecKm,
      gpsIncomplet: gps.gpsIncomplet,
      gpsPoints: gps.points,
      difficulte: null,
      fatigue: null,
      douleur: '',
      commentaire: '',
    };
  }
  current = screen;
  render();
  window.scrollTo(0, 0);
}

// --- Actions ------------------------------------------------------------------

const findSession = (id) => load().sessions.find((s) => s.id === id);

function readEditor() {
  const name = document.getElementById('name');
  if (name) editing.name = name.value.trim() || 'Séance sans nom';
  editing.steps = editing.steps.map((st, i) => {
    const kind = document.querySelector(`[data-kind="${i}"]`)?.value ?? st.kind;
    const m = parseInt(document.querySelector(`[data-min="${i}"]`)?.value, 10) || 0;
    const s = parseInt(document.querySelector(`[data-sec="${i}"]`)?.value, 10) || 0;
    return { kind, duration: Math.max(10, Math.min(4 * 3600, m * 60 + Math.min(59, s))) };
  });
}

function newManual(sport) {
  return {
    id: uid(), sport, source: 'manuelle', date: today(), sessionName: sport === 'natation' ? 'Natation' : 'Course libre',
    elapsedSec: null, distanceKm: null, distanceEstimee: false, structure: '',
    swim: { bassinM: 25, longueurs: null, nages: [], detail: '' },
    difficulte: null, essoufflement: null, fatigue: null, douleur: '', commentaire: '',
  };
}

function readSaisie() {
  const v = (id) => document.getElementById(id);
  if (!v('date')) return;
  bilan.date = v('date').value || today();
  const min = parseInt(v('duree').value, 10);
  bilan.elapsedSec = Number.isFinite(min) && min > 0 ? min * 60 : null;
  bilan.douleur = v('douleur').value.trim();
  bilan.commentaire = v('comm').value.trim();
  if (bilan.sport === 'natation') {
    bilan.swim.bassinM = Number(v('bassin').value);
    const n = parseInt(v('longueurs').value, 10);
    bilan.swim.longueurs = Number.isFinite(n) && n >= 0 ? n : null;
    bilan.swim.nages = [...document.querySelectorAll('[data-nage]')].filter((c) => c.checked).map((c) => c.dataset.nage);
    bilan.swim.detail = v('detail').value.trim();
    bilan.distanceKm = bilan.swim.longueurs ? (bilan.swim.longueurs * bilan.swim.bassinM) / 1000 : null;
  } else {
    bilan.structure = v('structure').value.trim();
    const dist = parseFloat(String(v('dist').value).replace(',', '.'));
    bilan.distanceKm = Number.isFinite(dist) && dist > 0 ? Math.round(dist * 100) / 100 : null;
    bilan.distanceEstimee = v('estim').checked;
  }
}

// Fusionne un export (ou un historique préparé) avec les données du téléphone, sans doublon.
function mergeImport(d, data) {
  const ids = new Set(d.history.map((h) => h.id));
  let added = 0;
  for (const h of data.history || []) {
    if (h && h.id && !ids.has(h.id)) { d.history.push(h); ids.add(h.id); added++; }
  }
  if (data.profile) {
    if (!d.profile.prenom && data.profile.prenom) d.profile.prenom = data.profile.prenom;
    if (data.profile.objectifs) d.profile.objectifs = data.profile.objectifs;
  }
  return added;
}

function readBilan() {
  const v = (id) => document.getElementById(id);
  if (!v('dist')) return;
  const dist = parseFloat(String(v('dist').value).replace(',', '.'));
  const km = Number.isFinite(dist) && dist > 0 ? Math.round(dist * 100) / 100 : null;
  if (km !== bilan.distanceKm) {
    bilan.distanceKm = km;
    bilan.distanceSource = km ? 'manuelle' : null;
    bilan.allureSecKm = km && bilan.elapsedSec ? Math.round(bilan.elapsedSec / km) : null;
  }
  bilan.distanceEstimee = v('estim').checked;
  bilan.douleur = v('douleur').value.trim();
  bilan.commentaire = v('comm').value.trim();
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const ds = t.dataset;
  if (ds.tab) {
    if (current === 'live' && !audio.paused && !confirm('La séance continue en arrière-plan. Quitter l\'écran ?')) return;
    go(ds.tab);
  } else if (ds.start) {
    startSession(findSession(ds.start));
  } else if (ds.edit) {
    editing = structuredClone(findSession(ds.edit));
    go('edit');
  } else if ('new' in ds) {
    editing = { id: uid(), name: 'Ma séance', isNew: true, steps: [{ kind: 'echauffement', duration: 300 }, { kind: 'course_lente', duration: 120 }, { kind: 'recuperation', duration: 300 }] };
    go('edit');
  } else if ('add' in ds) {
    readEditor();
    editing.steps.push({ kind: 'marche', duration: 120 });
    render();
  } else if (ds.del !== undefined) {
    readEditor();
    if (editing.steps.length > 1) editing.steps.splice(Number(ds.del), 1);
    render();
  } else if ('cancel' in ds) {
    go('seance');
  } else if ('save' in ds) {
    readEditor();
    const { isNew, ...s } = editing;
    update((d) => {
      const i = d.sessions.findIndex((x) => x.id === s.id);
      if (i >= 0) d.sessions[i] = s;
      else d.sessions.push(s);
    });
    go('seance');
  } else if ('remove' in ds) {
    if (!confirm('Supprimer cette séance ?')) return;
    update((d) => { d.sessions = d.sessions.filter((x) => x.id !== editing.id); });
    if (load().sessions.length === 0) update((d) => { d.sessions = structuredClone(PRESETS); });
    go('seance');
  } else if ('toggle' in ds) {
    if (audio.paused) audio.play(); else audio.pause();
  } else if ('skip' in ds) {
    nextStep();
  } else if ('touchlock' in ds) {
    touchLocked = true;
    renderTouchLock();
  } else if ('finish' in ds) {
    go('bilan');
  } else if (ds.manual) {
    bilan = newManual(ds.manual);
    go('saisie');
  } else if ('savemanual' in ds) {
    readSaisie();
    const entry = bilan;
    update((d) => { d.history.push(entry); });
    bilan = null;
    go('journal');
  } else if ('import' in ds) {
    document.getElementById('importfile').click();
  } else if (ds.scale) {
    if (current === 'saisie') readSaisie(); else readBilan();
    bilan[ds.scale] = Number(ds.v);
    render();
  } else if ('savebilan' in ds) {
    readBilan();
    const entry = bilan;
    update((d) => { d.history.unshift(entry); });
    if (live) URL.revokeObjectURL(live.url);
    live = null;
    audio.removeAttribute('src');
    audio.load();
    bilan = null;
    go('journal');
  } else if ('export' in ds) {
    const blob = new Blob([JSON.stringify(load(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `foulee-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }
});

document.addEventListener('change', (e) => {
  if (e.target.name === 'annonces') {
    update((d) => { d.settings.annonces = e.target.value; });
  } else if (e.target.name === 'mode') {
    update((d) => { d.settings.audioMode = e.target.value; });
    applyAudioMode();
  } else if (e.target.id === 'importfile') {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((txt) => {
      let added = 0;
      try {
        const data = JSON.parse(txt);
        update((d) => { added = mergeImport(d, data); });
      } catch {
        alert('Fichier illisible.');
        return;
      }
      alert(`${added} séance(s) ajoutée(s).`);
      go('journal');
    });
  } else if (current === 'saisie') {
    readSaisie();
    if (e.target.id === 'longueurs' || e.target.id === 'bassin') render();
  } else if (e.target.id === 'prenom') {
    update((d) => { d.profile.prenom = e.target.value.trim(); });
  } else if (current === 'edit') {
    readEditor();
    render();
  }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
navigator.storage?.persist?.().catch(() => {});
render();
