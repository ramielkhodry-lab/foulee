import { KINDS } from './phrases.js';
import { assemble, stepAt } from './track.js';
import { load, update, uid, PRESETS, onSave, replace, empty } from './store.js';
import * as account from './account.js';
import { createTrack, addPoint, markGap, summary, encodeTrace, decodeTrace } from './gps.js';
import { drawTrace } from './map.js';
import { iaInput, pendingIA, failedIA, failureMessage } from './ia.js';
import { tipsOf, tipsSource, hasIA } from './conseils.js';
import { GOALS_MUSCU, LIEUX, NIVEAUX_MUSCU, MUSCLES, alternatives, byId, muscuPlan, nextSeance, nextLoad, tonnage } from './muscu.js';
import { upcoming, planOptions, nextRunLevel, runLevel, afterBilan, HORIZON, GOALS_RUN, START_RUN, GOALS_SWIM, START_SWIM, LEVELS } from './plan.js';

const app = document.getElementById('app');
const audio = document.getElementById('player');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mmss = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const minutesLabel = (sec) => (sec < 60 ? `${sec} s` : sec % 60 ? `${Math.floor(sec / 60)} min ${sec % 60} s` : `${sec / 60} min`);
const total = (steps) => steps.reduce((a, s) => a + s.duration, 0);
const JOURS = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
const today = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ, heure locale
const dateLabel = (d) => new Date(String(d).length === 10 ? `${d}T12:00` : d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
// Programme de ce profil, d'après son historique et son questionnaire. Sans date de fin :
// recalculé à chaque affichage sur les 12 semaines qui viennent.
const planFor = (d, days = HORIZON) => upcoming(d.history, d.settings, today(), days, d.profile.questionnaire);
const practiced = (d, sport) => planOptions(d.profile.questionnaire).sports.includes(sport);
const allure = (secKm) => `${Math.floor(secKm / 60)}'${String(Math.round(secKm % 60)).padStart(2, '0')}/km`;

// Résumé court d'une séance : « 5 min marche · 6 × (3 min course + 2 min marche) · 5 min marche ».
function stepsSummary(steps) {
  const runs = steps.filter((s) => KINDS[s.kind].effort === 'course');
  const first = steps[0];
  const lastStep = steps.at(-1);
  const middle = steps.slice(1, -1);
  const body = runs.length > 1 && new Set(runs.map((r) => r.duration)).size === 1
    ? `${runs.length} × ${minutesLabel(runs[0].duration)} de course`
    : middle.map((s) => `${minutesLabel(s.duration)} ${KINDS[s.kind].effort}`).join(', ');
  return `${minutesLabel(first.duration)} marche · ${body} · ${minutesLabel(lastStep.duration)} marche`;
}

// --- Éléments visuels ---------------------------------------------------------

const ICONS = {
  course: '<path d="M5 6l6 6-6 6M13 6l6 6-6 6"/>',
  natation: '<path d="M2 9c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0M2 15c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0"/>',
  muscu: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  repos: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
};
const icon = (sport) => `<span class="ico ${sport}"><svg viewBox="0 0 24 24">${ICONS[sport] || ICONS.course}</svg></span>`;
const SPORT_LABEL = { course: 'Course', natation: 'Natation', muscu: 'Musculation' };
const kgLabel = (kg) => `${String(kg).replace('.', ',')} kg`;
// « 3 × 8-12 · 40 kg » : la dose d'un exercice prévu.
const dose = (x) => `${x.series} × ${x.min}–${x.max}${x.unite === 's' ? ' s' : ''}${x.poids ? ` · ${kgLabel(x.poids)}` : x.materiel === 'corps' ? '' : ' · charge à trouver'}`;
const exoList = (p) => `<ol class="exos">${p.exercices.map((x) => `<li><b>${esc(x.nom)}</b><span class="dose">${dose(x)}</span><span class="why">${esc(x.muscle)} · ${esc(x.reason)}</span></li>`).join('')}</ol>`;
const shortDate = (d) => new Date(`${String(d).slice(0, 10)}T12:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

// Pourquoi cette séance, et les conseils tirés du dernier bilan du même sport.
const whyTips = (p) => `
  <div class="why-tips ${p.sport}">
    <p>${esc(p.reason)}</p>
    ${p.tips?.length ? `<p class="tips-head">${p.tipsSource === 'ia' ? 'Conseils de l’IA sur ton dernier bilan' : 'Conseils de ton dernier bilan · règles'}</p><ul>${p.tips.slice(0, 3).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
  </div>`;

// Séance du jour : le seul bloc mis en vedette de l'accueil et du programme.
function todayHero(p) {
  const isToday = p.date === today();
  const when = isToday ? "Aujourd'hui" : dateLabel(p.date);
  if (p.sport === 'natation') {
    return `
      <section class="hero natation">
        <p class="eyebrow">${when} · natation</p>
        <p class="hero-num">${p.longueurs}<small>longueurs</small></p>
        <p class="hero-sub">${p.distance} m en bassin de ${p.bassin} m</p>
        <ol class="hero-steps">${p.plan.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
        ${whyTips(p)}
        ${isToday ? '<button class="btn-swim" data-logplan="natation">Noter ma séance</button>' : ''}
      </section>`;
  }
  if (p.sport === 'muscu') {
    return `
      <section class="hero muscu">
        <p class="eyebrow">${when} · musculation</p>
        <p class="hero-num">${p.exercices.length}<small>exercices</small></p>
        <p class="hero-sub">${esc(p.title)} · ${p.repos} s de repos entre les séries</p>
        ${exoList(p)}
        ${whyTips(p)}
        ${isToday ? '<button class="cta muscu" data-logplan="muscu"><span>Noter ma séance</span><i>›</i></button>' : ''}
      </section>`;
  }
  const mins = Math.round(total(p.steps) / 60);
  const runs = p.steps.filter((s) => KINDS[s.kind].effort === 'course');
  return `
    <section class="hero course">
      <p class="eyebrow">${when} · course · palier ${p.level}/${p.max}</p>
      <p class="hero-num">${mins}<small>min</small></p>
      <p class="hero-sub">${esc(p.title)}</p>
      <div class="effort-bar">${p.steps.map((s) => `<i class="${KINDS[s.kind].effort}" style="flex:${s.duration}"></i>`).join('')}</div>
      <p class="muted small">${runs.length} fois en course, ${Math.round(runs.reduce((a, s) => a + s.duration, 0) / 60)} min au total.</p>
      ${whyTips(p)}
      ${isToday ? `<button class="btn-primary" data-startplan="${esc(p.date)}">Démarrer la séance</button>
      <button class="btn-ghost" data-logplan="course" style="width:100%;margin-top:6px">Faite sans l'app : la noter</button>` : `<button data-startplan="${esc(p.date)}" style="width:100%">La faire maintenant</button>`}
    </section>`;
}

// Séance à venir : une ligne légère, sans cadre.
function planRow(p, showNow = false) {
  if (p.sport === 'repos') {
    return `<div class="li">${icon('repos')}<div class="li-main"><b>${shortDate(p.date)} · repos</b><span>${esc(p.reason)}</span></div></div>`;
  }
  const main = p.sport === 'natation'
    ? `<b>${shortDate(p.date)}</b><span>${p.longueurs} longueurs · ${p.distance} m</span>`
    : p.sport === 'muscu'
      ? `<b>${shortDate(p.date)} <em>${esc(p.title)}</em></b><span>${esc(p.exercices.map((x) => x.nom.split(' (')[0]).join(', '))}</span>`
      : `<b>${shortDate(p.date)} <em>palier ${p.level}/${p.max}</em></b><span>${esc(p.title)}</span>`;
  const side = p.sport === 'natation' ? `${p.distance}<small>m</small>` : p.sport === 'muscu' ? `${p.exercices.length}<small>exos</small>` : `${Math.round(total(p.steps) / 60)}<small>min</small>`;
  // Détail à un toucher : longueur par longueur, exercices, ou déroulé de la course.
  const more = p.sport === 'natation' ? `<ol class="hero-steps">${p.plan.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`
    : p.sport === 'muscu' ? exoList(p)
      : `<p class="small">${esc(stepsSummary(p.steps))}</p>`;
  return `
    <details class="hist plan-row"><summary class="li">${icon(p.sport)}<div class="li-main">${main}</div><span class="li-side ${p.sport}">${side}</span></summary>
      <div class="li-more">${more}<p class="muted small">${esc(p.reason)}</p></div></details>
    ${showNow ? `<button class="btn-ghost small-btn" data-startplan="${esc(p.date)}">La faire maintenant ›</button>` : ''}`;
}

// Tracé GPS d'une séance (les toutes premières séances gardaient les points bruts).
const traceOf = (h) => (h?.trace ? decodeTrace(h.trace) : h?.gpsPoints?.length ? decodeTrace(encodeTrace(h.gpsPoints)) : []);

// Cartes de l'écran : dessinées une fois visibles (une ligne d'historique fermée attend d'être dépliée).
function mountMaps() {
  for (const el of document.querySelectorAll('.map[data-map]')) {
    if (el.closest('details:not([open])')) continue;
    const id = el.dataset.map;
    drawTrace(el, traceOf(id === 'bilan' ? bilan : load().history.find((h) => h.id === id)));
  }
}
document.addEventListener('toggle', (e) => { if (e.target.open) mountMaps(); }, true);

// Conseils du coach sur une séance faite : ceux de l'IA s'ils existent, sinon ceux des règles.
function coachTips(h) {
  const tips = tipsOf(h);
  if (!tips.length) return '';
  const ia = tipsSource(h) === 'ia';
  return `
    <details class="coach ${sportOf(h)}">
      <summary>Conseils du coach suite à ta séance <i>›</i></summary>
      <p class="coach-src">${ia ? 'Écrits par l’IA à partir de ton ressenti' : 'Conseils des règles de Foulée'}</p>
      <ul>${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    </details>`;
}

// Séance passée : ligne dépliable, le détail reste à un toucher.
function historyRow(h, open = false) {
  const sport = sportOf(h);
  const parts = [];
  if (h.elapsedSec) parts.push(`${Math.round(h.elapsedSec / 60)} min`);
  if (sport === 'natation' && h.swim?.longueurs) parts.push(`${h.swim.longueurs} × ${h.swim.bassinM} m = ${h.swim.longueurs * h.swim.bassinM} m`);
  if (h.distanceKm && sport !== 'natation') parts.push(`${h.distanceKm.toLocaleString('fr-FR')} km${h.distanceEstimee ? ' (estimé)' : ''}`);
  if (h.allureSecKm) parts.push(`allure ${allure(h.allureSecKm)}`);
  if (h.gpsIncomplet) parts.push('GPS incomplet');
  if (h.steps && h.source === 'guidee') parts.push(`${h.completedSteps}/${h.steps.length} étapes`);
  if (sport === 'muscu' && h.exercices?.length) parts.unshift(`${h.sessionName} · ${h.exercices.length} exercices`);
  const feel = [
    h.difficulte && `difficulté ${h.difficulte}/5`,
    h.essoufflement && `essoufflement ${h.essoufflement}/5`,
    h.fatigue && `fatigue ${h.fatigue}/5`,
    h.douleur && `douleur : ${esc(h.douleur)}`,
  ].filter(Boolean);
  const side = sport === 'muscu'
    ? (tonnage(h) ? `${Math.round(tonnage(h)).toLocaleString('fr-FR')}<small>kg</small>` : '')
    : sport === 'natation'
    ? (swimMeters(h) ? `${swimMeters(h)}<small>m</small>` : '')
    : h.distanceKm ? `${h.distanceKm.toLocaleString('fr-FR')}<small>km</small>` : h.elapsedSec ? `${Math.round(h.elapsedSec / 60)}<small>min</small>` : '';
  return `
    <details class="hist"${open ? ' open' : ''}>
      <summary class="li">${icon(sport)}<div class="li-main"><b>${dateLabel(h.date)}</b><span>${parts.length ? parts.join(' · ') : esc(h.structure || h.sessionName || SPORT_LABEL[sport])}</span></div><span class="li-side ${sport}">${side}</span></summary>
      <div class="li-more">
        ${traceOf(h).length ? `<div class="map" data-map="${esc(h.id)}"></div>` : ''}
        ${sport === 'muscu' && h.exercices?.length ? `<ul class="steps">${h.exercices.map((x) => `<li><span>${esc(x.nom)}</span><span class="muted small">${x.poids ? `${kgLabel(x.poids)} · ` : ''}${(x.reps || []).filter((r) => r > 0).join(' / ')}${x.unite === 's' ? ' s' : ''}</span></li>`).join('')}</ul>${tonnage(h) ? '<p class="muted small">Total soulevé : charge × répétitions, hors poids du corps.</p>' : ''}` : ''}
        ${sport === 'natation' && h.swim?.nages?.length ? `<p class="small">${esc(h.swim.nages.join(', '))}${h.swim.detail ? ` · ${esc(h.swim.detail)}` : ''}</p>` : ''}
        ${h.structure ? `<p class="small">${esc(h.structure)}</p>` : ''}
        ${feel.length ? `<p class="muted small">${feel.join(' · ')}</p>` : ''}
        ${h.commentaire ? `<p class="small">« ${esc(h.commentaire)} »</p>` : ''}
        ${!feel.length && !h.commentaire && !h.structure ? '<p class="muted small">Pas de ressenti noté.</p>' : ''}
        ${coachTips(h)}
      </div>
    </details>`;
}

// --- Chiffres de progression ---------------------------------------------------

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
};
const mondayOf = (iso) => addDays(iso, -((new Date(`${iso}T12:00:00`).getDay() + 6) % 7));
const sportOf = (h) => h.sport || 'course';
const swimMeters = (h) => (h.swim?.longueurs ? h.swim.longueurs * (h.swim.bassinM || 25) : Math.round((h.distanceKm || 0) * 1000));
const fmtKm = (km) => (Math.round(km * 10) / 10).toLocaleString('fr-FR');

// Totaux d'une semaine (lundi → dimanche) : km de course, mètres nagés, nombre de séances.
function weekTotals(history, monday) {
  const end = addDays(monday, 7);
  const inWeek = history.filter((h) => { const d = String(h.date).slice(0, 10); return d >= monday && d < end; });
  return {
    km: inWeek.filter((h) => sportOf(h) === 'course').reduce((a, h) => a + (h.distanceKm || 0), 0),
    m: inWeek.filter((h) => sportOf(h) === 'natation').reduce((a, h) => a + swimMeters(h), 0),
    kg: inWeek.filter((h) => sportOf(h) === 'muscu').reduce((a, h) => a + tonnage(h), 0),
    n: inWeek.length,
  };
}

// Calendrier : 2 semaines passées → 12 à venir, une semaine par écran, chaque jour se touche.
function weekStrip(history, plan, sel) {
  const t = today();
  const first = addDays(mondayOf(t), -14);
  const days = Array.from({ length: 14 * 7 }, (_, i) => addDays(first, i));
  return `<div class="week" id="week">${days.map((d, i) => {
    const done = history.filter((h) => String(h.date).slice(0, 10) === d).map(sportOf);
    const planned = plan.filter((p) => p.date === d && p.sport !== 'repos').map((p) => p.sport);
    const dots = [...new Set([...done, ...planned])].map((sp) => `<span class="dot ${sp}${done.includes(sp) ? ' done' : ''}"></span>`).join('');
    const cls = [d === t && 'today', d < t && 'past', d === sel && 'sel', i % 7 === 0 && 'monday'].filter(Boolean).join(' ');
    return `<button data-pickday="${d}" class="${cls}">${'LMMJVSD'[i % 7]}<b>${Number(d.slice(8))}</b><span class="dots">${dots}</span></button>`;
  }).join('')}</div>`;
}

// Exercices de musculation par muscle, avec la dernière charge notée pour chacun.
function muscuLibrary(d) {
  const lieu = d.profile.questionnaire?.lieu || 'salle';
  const last = {};
  for (const h of [...d.history].filter((x) => x.sport === 'muscu').sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    for (const x of h.exercices || []) if (x.poids || x.reps?.some((r) => r > 0)) last[x.id] = x;
  }
  const info = (e) => {
    const x = last[e.id];
    if (!x) return e.materiel === 'corps' ? 'poids du corps' : { machine: 'machine', poulie: 'poulie', barre: 'barre', halteres: 'haltères' }[e.materiel];
    return `dernière fois : ${x.poids ? `${kgLabel(x.poids)} × ` : ''}${Math.max(...x.reps)}${x.unite === 's' ? ' s' : ''}`;
  };
  return `
    <h3>Exercices par muscle</h3>
    <p class="muted small">${esc(LIEUX[lieu].label)}. Pour changer un exercice du programme, choisis-en un autre du même muscle quand tu notes ta séance.</p>
    <div class="lib">${MUSCLES.map((m) => {
      const list = alternatives(m, lieu);
      if (!list.length) return '';
      return `<details><summary>${esc(m[0].toUpperCase() + m.slice(1))} <span class="muted small" style="margin-left:auto;margin-right:8px">${list.length}</span></summary><ul>${list.map((e) => `<li>${esc(e.nom)}<span>${esc(info(e))}</span></li>`).join('')}</ul></details>`;
    }).join('')}</div>`;
}

// En-tête d'une partie du questionnaire : un sport, sa couleur.
const qPartHead = (sport) => `<div class="q-part-head">${icon(sport)}<h2>${SPORT_LABEL[sport]}</h2></div>`;

// Invitation à répondre au questionnaire, tant que ce profil ne l'a pas fait.
const questionnaireBanner = () => `
  <button class="q-banner" data-questionnaire>
    <span><b>Personnalise ton programme</b><span>Pour l'instant, c'est le programme par défaut. Tes sports, ton objectif, ton niveau, tes jours : 1 minute.</span></span><i>›</i>
  </button>`;

// « + Natation » / « + Course » : seulement les sports de ce profil.
function manualButtons(d, cls, date = null, style = '', courseSuffix = '') {
  const b = (sport, label, color) => (practiced(d, sport) ? `<button data-manual="${sport}"${date ? ` data-mdate="${date}"` : ''} class="${cls}" style="color:var(${color})">+ ${label}</button>` : '');
  return `<div class="row"${style ? ` style="${style}"` : ''}>${b('natation', 'Natation', '--swim')}${b('course', `Course${courseSuffix}`, '--run')}${b('muscu', 'Muscu', '--muscu')}</div>`;
}

// Ce que montre le jour choisi : la séance faite, la séance prévue, ou rien.
function dayPanel(history, plan, sel) {
  const t = today();
  if (sel < t) {
    const done = history.filter((h) => String(h.date).slice(0, 10) === sel);
    if (done.length) return `<div class="list">${done.map((h) => historyRow(h, true)).join('')}</div>`;
    return `<section class="hero rest"><p class="eyebrow">${dateLabel(sel)}</p><p class="hero-num">Rien</p><p class="muted">Aucune séance notée ce jour-là.</p>
      ${manualButtons(load(), 'btn-ghost', sel)}</section>`;
  }
  const p = plan.find((x) => x.date === sel);
  if (p && p.sport !== 'repos') return sessionCard(p);
  const doneToday = sel === t ? history.filter((h) => String(h.date).slice(0, 10) === sel) : [];
  if (doneToday.length) return `<h3 style="margin-top:0">Aujourd'hui</h3><div class="list">${doneToday.map((h) => historyRow(h, true)).join('')}</div>`;
  return `
    <section class="day-card repos">
      <div class="stripes" aria-hidden="true"></div>
      <p class="day-kicker">${sel === t ? 'Ta journée' : dateLabel(sel)}</p>
      <h2 class="day-title">Repos</h2>
      <p class="day-sub">${p ? esc(p.reason) : "C'est là que le corps progresse"}</p>
    </section>`;
}

const FACT_ICONS = {
  temps: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  effort: '<path d="M2 12h4l2-5 4 10 2-5h8"/>',
  niveau: '<path d="M5 20v-5M10 20v-9M15 20v-13M20 20V4"/>',
};
const fact = (k, text) => `<li><svg viewBox="0 0 24 24">${FACT_ICONS[k]}</svg>${text}</li>`;

// Séance du jour choisi, façon affiche : titre géant, trois repères, un seul bouton.
function sessionCard(p) {
  const isToday = p.date === today();
  const kicker = isToday ? 'Ta séance du jour' : `Prévue ${dateLabel(p.date)}`;
  if (p.sport === 'natation') {
    return `
      <section class="day-card natation">
        <div class="stripes" aria-hidden="true"></div>
        <p class="day-kicker">${kicker}</p>
        <h2 class="day-title">Natation</h2>
        <p class="day-sub">${p.longueurs} longueurs · ${p.distance} m</p>
        <ul class="day-facts">
          ${fact('temps', `Bassin de ${p.bassin} m`)}
          ${fact('effort', 'Crawl, brasse et dos en alternance')}
          ${fact('niveau', p.focus === 'respiration' ? '4 longueurs pour travailler ta respiration' : 'Pauses de 30 s entre les blocs')}
        </ul>
        ${whyTips(p)}
        ${isToday ? '<button class="cta swim" data-logplan="natation"><span>Noter ma séance</span><i>›</i></button>' : ''}
        <details class="day-detail natation"><summary>Le détail longueur par longueur <i>›</i></summary>
          <ol class="hero-steps">${p.plan.map((l) => `<li>${esc(l)}</li>`).join('')}</ol></details>
      </section>`;
  }
  if (p.sport === 'muscu') {
    const muscles = [...new Set(p.exercices.map((x) => x.muscle))];
    return `
      <section class="day-card muscu">
        <div class="stripes" aria-hidden="true"></div>
        <p class="day-kicker">${kicker}</p>
        <h2 class="day-title">Muscu</h2>
        <p class="day-sub">${esc(p.title)}</p>
        <ul class="day-facts">
          ${fact('effort', `${p.exercices.length} exercices · ${p.exercices[0].series} séries chacun`)}
          ${fact('niveau', esc(muscles.slice(0, 4).join(', ') + (muscles.length > 4 ? '…' : '')))}
          ${fact('temps', `${p.repos} s de repos entre les séries`)}
        </ul>
        ${whyTips(p)}
        ${isToday ? '<button class="cta muscu" data-logplan="muscu"><span>Noter ma séance</span><i>›</i></button>' : ''}
        <details class="day-detail muscu"><summary>Exercices, charges et répétitions <i>›</i></summary>${exoList(p)}</details>
      </section>`;
  }
  const mins = Math.round(total(p.steps) / 60);
  const runs = p.steps.filter((s) => KINDS[s.kind].effort === 'course');
  const runText = runs.length === 1 ? `${minutesLabel(runs[0].duration)} de course sans t'arrêter` : `${runs.length} × ${minutesLabel(runs[0].duration)} de course, marche entre`;
  return `
    <section class="day-card course">
      <div class="stripes" aria-hidden="true"></div>
      <p class="day-kicker">${kicker}</p>
      <h2 class="day-title">Course</h2>
      <p class="day-sub">Palier ${p.level}/${p.max} · ${runs.length === 1 ? 'continu' : 'marche-course'}</p>
      <ul class="day-facts">
        ${fact('temps', `${mins} min, échauffement compris`)}
        ${fact('effort', runText)}
        ${fact('niveau', 'Allure où tu peux encore parler')}
      </ul>
      ${whyTips(p)}
      ${isToday
        ? `<button class="cta" data-startplan="${esc(p.date)}"><span>Démarrer ma séance</span><i>›</i></button>
           <button class="day-link" data-logplan="course">Faite sans l'app : la noter ›</button>`
        : `<button class="cta ghost" data-startplan="${esc(p.date)}"><span>La faire maintenant</span><i>›</i></button>`}
    </section>`;
}

// « Mes indicateurs » : la semaine en cours comparée à la précédente.
function miniBars(vals, cls) {
  const max = Math.max(...vals) || 1;
  return `<span class="mini-bars ${cls}">${vals.map((v, i) => `<i class="${i === vals.length - 1 ? 'cur' : ''}" style="height:${Math.max(12, (v / max) * 100)}%"></i>`).join('')}</span>`;
}
function spark(vals) {
  if (vals.length < 2) return '';
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 60},${4 + (max === min ? 10 : ((v - min) / (max - min)) * 20)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 60 28" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}
function pct(cur, prev) {
  if (!prev) return cur ? '<em class="up">nouveau</em>' : '<em>–</em>';
  const v = Math.round(((cur - prev) / prev) * 100);
  return `<em class="${v > 0 ? 'up' : ''}">${v > 0 ? '+' : ''}${v} %</em>`;
}
function indicators(history) {
  const monday = mondayOf(today());
  const weeks = Array.from({ length: 5 }, (_, i) => addDays(monday, (i - 4) * 7));
  const km = weeks.map((w) => weekTotals(history, w).km);
  const time = weeks.map((w) => {
    const end = addDays(w, 7);
    return history.filter((h) => { const d = String(h.date).slice(0, 10); return d >= w && d < end; }).reduce((a, h) => a + (h.elapsedSec || 0), 0);
  });
  const t = time.at(-1);
  // Allure : les dernières courses mesurées (marche comprise), de la plus ancienne à la plus récente.
  const paces = history.filter((h) => sportOf(h) === 'course')
    .map((h) => ({ d: String(h.date), v: h.allureSecKm || (h.distanceKm && h.elapsedSec && !h.distanceEstimee ? h.elapsedSec / h.distanceKm : 0) }))
    .filter((x) => x.v).sort((a, b) => a.d.localeCompare(b.d)).slice(-6).map((x) => x.v);
  const lastPace = paces.at(-1);
  const gain = paces.length > 1 ? Math.round(paces.at(-2) - lastPace) : null;
  return `
    <div class="ind-head"><h3>Mes indicateurs</h3><button class="day-link" data-tab="progression">Voir tout ›</button></div>
    <div class="ind">
      <div><span class="ind-label">Semaine</span><b>${fmtKm(km.at(-1))}<small>km</small></b><span class="ind-foot">${miniBars(km, 'course')}${pct(km.at(-1), km.at(-2))}</span></div>
      <div><span class="ind-label">Temps d'activité</span><b>${t >= 3600 ? `${Math.floor(t / 3600)}<small>h</small>` : ''}${Math.round((t % 3600) / 60)}<small>min</small></b><span class="ind-foot">${miniBars(time, 'neutral')}${pct(t, time.at(-2))}</span></div>
      <div><span class="ind-label">Dernière allure</span><b>${lastPace ? allure(lastPace).replace('/km', '') : '–'}<small>/km</small></b><span class="ind-foot">${spark(paces)}${gain === null ? '<em>–</em>' : `<em class="${gain > 0 ? 'up' : ''}">${gain > 0 ? '−' : '+'}${Math.abs(gain)} s</em>`}</span></div>
    </div>`;
}

// Courbe des 8 dernières semaines (km de course ou mètres nagés).
function weekCurve(history, kind) {
  const monday = mondayOf(today());
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(monday, (i - 7) * 7));
  const unit = { course: 'km', natation: 'm', muscu: 'kg' }[kind];
  const vals = weeks.map((w) => weekTotals(history, w)[unit]);
  const max = Math.max(...vals) || 1;
  const W = 320;
  const H = 130;
  const pts = vals.map((v, i) => [12 + (i * (W - 24)) / 7, 112 - (v / max) * 92]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  const color = { course: 'var(--run)', natation: 'var(--swim)', muscu: 'var(--muscu)' }[kind];
  const [lx, ly] = pts.at(-1);
  return `
    <svg class="curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="area-${kind}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${d} L${lx},${H} L${pts[0][0]},${H} Z" fill="url(#area-${kind})"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
      ${pts.map(([x, y], i) => (vals[i] ? `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}"/>` : '')).join('')}
      <circle cx="${lx}" cy="${ly}" r="9" fill="${color}" opacity="0.25"/>
    </svg>
    <div class="curve-x">${weeks.map((w, i) => `<span>${vals[i] ? `<b>${kind === 'course' ? fmtKm(vals[i]) : kind === 'muscu' && vals[i] >= 1000 ? `${fmtKm(vals[i] / 1000)}t` : Math.round(vals[i])}</b>` : '<b>·</b>'}${Number(w.slice(8))}/${Number(w.slice(5, 7))}</span>`).join('')}</div>`;
}

// --- Sons -------------------------------------------------------------------

// À changer à chaque régénération des clips : l'URL change, donc aucun ancien cache ne sert.
const AUDIO_VERSION = '3';
let audioAssets = null;
async function loadAudio() {
  if (audioAssets) return audioAssets;
  const get = (f) => fetch(`audio/${f}?v=${AUDIO_VERSION}`).then((r) => {
    if (!r.ok) throw new Error(`${f} : ${r.status}`);
    return r;
  });
  const [index, pack] = await Promise.all([
    get('index.json').then((r) => r.json()),
    get('pack.mp3').then((r) => r.arrayBuffer()),
  ]);
  audioAssets = { index, pack: new Uint8Array(pack) };
  return audioAssets;
}
loadAudio().catch(() => {});

function applyAudioMode() {
  // Musique (défaut) : se superpose à la musique ; écran allumé requis.
  // Exclusif : continue écran verrouillé mais met la musique en pause.
  if (!('audioSession' in navigator)) return;
  try {
    navigator.audioSession.type = load().settings.son === 'exclusif' ? 'playback' : 'ambient';
  } catch {}
}

// --- Séance en cours ----------------------------------------------------------

let live = null; // { session, track, url, skipped:Set, maxTime, lastStep }

const localNow = () => new Date().toLocaleString('sv-SE').replace(' ', 'T'); // AAAA-MM-JJTHH:MM:SS, heure locale

function startSession(session, resume = null) {
  if (!audioAssets) {
    alert('Les sons ne sont pas encore chargés. Vérifie ta connexion et réessaie dans quelques secondes.');
    loadAudio().catch(() => {});
    return;
  }
  // Tout se fait sans attente pour rester dans le geste de l'utilisateur :
  // iOS refuse de lancer l'audio sinon.
  let track;
  try {
    track = assemble(session.steps, audioAssets.index, audioAssets.pack, { voice: load().settings.annonces === 'voix' });
  } catch (e) {
    alert(`Impossible de préparer la séance : ${e.message}. Ferme et rouvre Foulée pour la mettre à jour.`);
    return;
  }
  if (live) URL.revokeObjectURL(live.url);
  const url = URL.createObjectURL(new Blob([track.bytes], { type: 'audio/mpeg' }));
  stopLiveExtras();
  live = {
    session, track, url, skipped: new Set(resume?.skipped || []), maxTime: resume?.pos || 0, lastStep: null,
    startedAt: resume?.startedAt || localNow(), gps: createTrack(), gpsError: null, userPaused: false,
  };
  if (resume) live.gps.gaps = 1; // la mesure d'avant l'interruption est perdue
  applyAudioMode();
  audio.src = url;
  audio.currentTime = resume?.pos || 0;
  audio.play().catch((e) => alert(`Lecture impossible : ${e.message}`));
  if (load().settings.son === 'exclusif') setupMediaSession();
  startGps();
  keepAwake();
  saveLive();
  go('live');
}

// Si iOS ferme l'app pendant la séance (mémoire, appel, fausse manip), on peut reprendre.
const LIVE_KEY = 'foulee.live';
let lastLiveSave = 0;
function saveLive() {
  if (!live) return;
  lastLiveSave = Date.now();
  try {
    localStorage.setItem(LIVE_KEY, JSON.stringify({
      session: live.session, startedAt: live.startedAt, pos: audio.currentTime || live.maxTime, skipped: [...live.skipped], savedAt: Date.now(),
    }));
  } catch {}
}
function clearLive() {
  try { localStorage.removeItem(LIVE_KEY); } catch {}
}
function savedLive() {
  try {
    const s = JSON.parse(localStorage.getItem(LIVE_KEY));
    return s && Date.now() - s.savedAt < 3 * 3600 * 1000 ? s : null;
  } catch {
    return null;
  }
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
// Repli (anciennes versions d'iOS, webapp d'écran d'accueil) : une vidéo muette en boucle
// empêche aussi la mise en veille, sans toucher à la musique.
let wakeLock = null;
let wakeVideo = null;
async function keepAwake() {
  if (document.visibilityState !== 'visible') return;
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      return;
    }
  } catch {}
  if (!wakeVideo) {
    wakeVideo = document.createElement('video');
    Object.assign(wakeVideo, { src: 'media/veille.mp4', muted: true, loop: true, playsInline: true });
    wakeVideo.setAttribute('playsinline', '');
    wakeVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.01;pointer-events:none;bottom:0;left:0';
    document.body.appendChild(wakeVideo);
  }
  wakeVideo.play().catch(() => {});
}

function stopLiveExtras() {
  if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
  gpsWatch = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  wakeVideo?.pause();
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
      artwork: [{ src: 'icons/f-512.png', sizes: '512x512', type: 'image/png' }],
    });
  } catch {}
}

audio.addEventListener('timeupdate', () => {
  if (!live) return;
  live.maxTime = Math.max(live.maxTime, audio.currentTime);
  if (Date.now() - lastLiveSave > 5000) saveLive();
  const i = stepAt(live.track.starts, live.track.end, audio.currentTime);
  if (i !== live.lastStep) {
    live.lastStep = i;
    updateMediaMetadata(i);
  }
});
audio.addEventListener('ended', () => {
  if (live && current === 'live') go('bilan');
});
audio.addEventListener('pause', () => {
  saveLive();
  if (current === 'live') render();
});
audio.addEventListener('play', () => {
  if (live) live.userPaused = false;
  if (current === 'live') render();
});

// Affichage du lecteur : relu à chaque image depuis la position de la piste, donc sans dérive.
function tick() {
  if (current !== 'live' || !live) return;
  const { starts, end } = live.track;
  const steps = live.session.steps;
  const t = audio.currentTime;
  const i = stepAt(starts, end, t);
  const el = (id) => document.getElementById(id);
  if (!el('count')) return;
  // Changement d'étape : l'écran clignote (vert = course, blanc = marche).
  if (live.shownStep !== undefined && i !== live.shownStep && i >= 0 && i < steps.length) {
    const flash = KINDS[steps[i].kind].effort === 'course' ? 'flash-course' : 'flash-marche';
    document.body.classList.remove('flash-course', 'flash-marche');
    void document.body.offsetWidth;
    document.body.classList.add(flash);
    setTimeout(() => document.body.classList.remove(flash), 1500);
  }
  live.shownStep = i;
  const effort = i >= 0 && i < steps.length ? KINDS[steps[i].kind].effort : 'marche';
  el('live').dataset.effort = effort;
  if (i < 0) {
    el('now').textContent = 'Prépare-toi';
    el('count').textContent = mmss(starts[0] - t);
    el('next').innerHTML = `<span class="muted">Ensuite</span> ${esc(KINDS[steps[0].kind].label)}`;
  } else if (i >= steps.length) {
    el('now').textContent = 'Terminé !';
    el('count').textContent = '0:00';
    el('next').textContent = '';
  } else {
    el('now').textContent = effort === 'course' ? 'Cours' : 'Marche';
    el('count').textContent = mmss(starts[i] + steps[i].duration - t);
    const n = steps[i + 1];
    el('next').innerHTML = n ? `<span class="muted">Ensuite</span> ${esc(KINDS[n.kind].label)} · ${minutesLabel(n.duration)}` : 'Dernière étape';
  }
  el('stepno').textContent = i < 0 ? 'Départ' : i >= steps.length ? 'Fin' : `Étape ${i + 1}/${steps.length} · ${KINDS[steps[i].kind].label}`;
  el('progress').style.width = `${Math.min(100, ((t - starts[0]) / (end - starts[0])) * 100)}%`;
  el('elapsed').textContent = mmss(Math.max(0, t - starts[0]));
  const g = summary(live.gps, Math.max(0, t - starts[0]));
  el('dist').textContent = g.distanceKm ? g.distanceKm.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '0,00';
  el('pace').textContent = g.allureSecKm ? allure(g.allureSecKm).replace('/km', '') : '–';
  el('gpsdot').classList.toggle('ok', !live.gpsError && Boolean(g.distanceKm));
  el('gpsstate').textContent = live.gpsError || (g.distanceKm ? 'GPS' : 'GPS…');
  el('gps').textContent = live.gpsError
    ? `${live.gpsError} : la distance ne sera pas mesurée.`
    : g.gpsIncomplet ? 'GPS coupé un moment : distance incomplète.' : '';
  requestAnimationFrame(tick);
}

// --- Questionnaire de chaque profil -------------------------------------------

let qDraft = null; // réponses en cours (copie), null hors du questionnaire

const sameLevelOpts = { maxLevel: LEVELS.length };
function openQuestionnaire() {
  const d = load();
  const q = d.profile.questionnaire;
  const lastSwim = d.history.filter((h) => sportOf(h) === 'natation' && h.swim?.bassinM).sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1);
  const bassin = q?.bassin || lastSwim?.swim.bassinM || 25;
  // Sans réponse : les sports déjà pratiqués d'après l'historique, sinon rien de coché.
  const fromHistory = [...new Set(d.history.map(sportOf))].filter((x) => SPORTS_ORDER.includes(x));
  qDraft = {
    sports: [...(q?.sports ?? fromHistory)],
    objectifCourse: q?.objectifCourse ?? null,
    niveauCourse: q?.niveauCourse ?? null,
    joursCourse: [...(q?.joursCourse ?? d.settings.joursCourse ?? [1, 5])],
    bassin,
    objectifNatation: q?.objectifNatation ?? null,
    niveauNatation: q?.niveauNatation ?? null,
    joursNatation: [...(q?.joursNatation ?? d.settings.joursNatation ?? [3])],
    objectifMuscu: q?.objectifMuscu ?? null,
    lieu: q?.lieu ?? null,
    niveauMuscu: q?.niveauMuscu ?? null,
    joursMuscu: [...(q?.joursMuscu ?? [])],
    error: null,
  };
  go('questionnaire');
}

// Niveau déjà connu par l'historique : on ne le redemande pas (et on ne l'écrase pas).
const hasRuns = (d) => d.history.some((h) => sportOf(h) === 'course' && runLevel(h));
const hasSwims = (d) => d.history.some((h) => sportOf(h) === 'natation' && h.swim?.longueurs);

function questionnaireErrors(q, d) {
  if (!q.sports.length) return 'Choisis au moins un sport.';
  if (q.sports.includes('course')) {
    if (!q.objectifCourse) return 'Choisis ton objectif de course.';
    if (!hasRuns(d) && !q.niveauCourse) return 'Dis combien de temps tu cours sans t’arrêter aujourd’hui.';
    if (!q.joursCourse.length) return 'Choisis au moins un jour de course.';
  }
  if (q.sports.includes('natation')) {
    if (!q.objectifNatation) return 'Choisis ton objectif de natation.';
    if (!hasSwims(d) && !q.niveauNatation) return 'Dis combien de longueurs tu nages aujourd’hui.';
    if (!q.joursNatation.length) return 'Choisis au moins un jour de natation.';
  }
  if (q.sports.includes('muscu')) {
    if (!q.objectifMuscu) return 'Choisis ton objectif en musculation.';
    if (!q.lieu) return 'Dis où tu fais ta musculation.';
    if (!q.niveauMuscu) return 'Dis où tu en es en musculation.';
    if (!q.joursMuscu.length) return 'Choisis au moins un jour de musculation.';
  }
  const jours = q.sports.flatMap((x) => q[DAYS_KEY[x]]);
  if (new Set(jours).size !== jours.length) return 'Un seul sport par jour : un jour est coché pour deux sports.';
  return null;
}

// Les réponses gardées : celles des sports choisis seulement.
function cleanAnswers(q, d) {
  const out = { v: 1, answeredAt: Date.now(), sports: SPORTS_ORDER.filter((x) => q.sports.includes(x)) };
  if (out.sports.includes('course')) {
    Object.assign(out, { objectifCourse: q.objectifCourse, joursCourse: [...q.joursCourse].sort() });
    if (!hasRuns(d)) out.niveauCourse = q.niveauCourse;
  }
  if (out.sports.includes('natation')) {
    Object.assign(out, { bassin: q.bassin, objectifNatation: q.objectifNatation, joursNatation: [...q.joursNatation].sort() });
    if (!hasSwims(d)) out.niveauNatation = q.niveauNatation;
  }
  if (out.sports.includes('muscu')) {
    Object.assign(out, { objectifMuscu: q.objectifMuscu, lieu: q.lieu, niveauMuscu: q.niveauMuscu, joursMuscu: [...q.joursMuscu].sort() });
  }
  return out;
}
const SPORTS_ORDER = ['course', 'natation', 'muscu'];
const DAYS_KEY = { course: 'joursCourse', natation: 'joursNatation', muscu: 'joursMuscu' };

const radio = (name, value, cur, label, detail) => `<label class="choice"><input type="radio" name="${name}" value="${value}" ${String(cur) === String(value) ? 'checked' : ''}><span><strong>${esc(label)}</strong>${detail ? ` : ${esc(detail)}` : ''}</span></label>`;
// Jours d'un sport ; ceux déjà pris par un autre sport choisi sont grisés (un sport par jour).
const qDays = (key, sel, cls = '') => {
  const taken = new Set(qDraft.sports.map((x) => DAYS_KEY[x]).filter((k) => k !== key).flatMap((k) => qDraft[k]));
  return `<div class="days ${cls}">${JOURS.map(([n, l]) => `<button data-qday="${key}" data-v="${n}" class="${sel.includes(n) ? 'on' : ''}" ${taken.has(n) && !sel.includes(n) ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
};

// Résumé des réponses pour le Profil.
function answersSummary(q) {
  const jours = (list) => JOURS.filter(([n]) => list.includes(n)).map(([n]) => ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][n]).join(', ');
  const lines = [];
  if (q.sports.includes('course')) lines.push(['course', `${GOALS_RUN[q.objectifCourse]?.label ?? 'Course'} · ${jours(q.joursCourse)}`]);
  if (q.sports.includes('natation')) lines.push(['natation', `${(q.objectifNatation / 1000).toLocaleString('fr-FR')} km par séance, bassin de ${q.bassin} m · ${jours(q.joursNatation)}`]);
  if (q.sports.includes('muscu')) lines.push(['muscu', `${GOALS_MUSCU[q.objectifMuscu]?.label ?? 'Musculation'}, ${LIEUX[q.lieu]?.label.toLowerCase() ?? ''} · ${jours(q.joursMuscu)}`]);
  return lines;
}

// --- Écrans -------------------------------------------------------------------

let current = 'accueil';
let progSport = 'course'; // courbe affichée dans Progression
let selDay = today(); // jour choisi dans le calendrier de l'accueil
let weekScroll = null; // position du calendrier, gardée entre deux affichages
let editing = null; // séance en cours d'édition (copie)
let bilan = null; // formulaire de bilan en cours
let suite = null; // ce que change le bilan qu'on vient d'enregistrer
let progDays = 14; // jours affichés dans la liste du programme

const screens = {
  accueil() {
    const d = load();
    const last = [...d.history].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const installed = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    const plan = planFor(d);
    const todayItem = plan.find((p) => p.date === today());
    const resumable = live ? null : savedLive();
    const next = plan.filter((p) => p.sport !== 'repos' && p.date !== today()).slice(0, 3);
    const prenom = d.profile.prenom || account.session()?.user?.prenom || '';
    return `
      <header class="hello">
        <button class="avatar" data-tab="profil" aria-label="Profil">${esc((prenom[0] || '?').toUpperCase())}</button>
        <div><span>Bonjour</span><b>${esc(prenom) || 'à toi'}</b></div>
      </header>
      <p class="motto">Discipline aujourd'hui<br>Progrès demain</p>
      ${d.profile.questionnaire ? '' : questionnaireBanner()}
      ${iaAlert(d.history)}
      ${installed ? '' : '<div class="notice"><strong>Installe Foulée :</strong> dans Safari, touche Partager puis « Sur l\'écran d\'accueil », et ouvre l\'app depuis son icône. Le guidage est plus fiable ainsi.</div>'}
      ${resumable ? `<div class="alert">Séance interrompue : « ${esc(resumable.session.name)} », arrêtée à ${mmss(resumable.pos)}.
        <div class="row" style="margin-top:10px"><button class="btn-dark" data-resume>Reprendre</button><button data-dropresume>Abandonner</button></div></div>` : ''}
      ${weekStrip(d.history, plan, selDay)}
      ${dayPanel(d.history, plan, selDay)}
      ${indicators(d.history)}
      ${next.length ? `<h3>Ensuite</h3><div class="list">${next.map((p) => planRow(p, !todayItem?.steps && p === next.find((x) => x.sport === 'course'))).join('')}</div>` : ''}
      ${last ? `<h3>Dernière séance</h3><div class="list">${historyRow(last)}</div>` : ''}`;
  },

  programme() {
    const d = load();
    const plan = planFor(d);
    const todayItem = plan.find((p) => p.date === today() && p.sport !== 'repos');
    const firstRun = todayItem?.sport === 'course' ? null : plan.find((p) => p.sport === 'course');
    const rest = plan.filter((p) => p !== todayItem && p.date < addDays(today(), progDays));
    const run = plan.find((p) => p.sport === 'course');
    return `
      <h1>Programme</h1>
      ${d.profile.questionnaire ? '' : questionnaireBanner()}
      ${run ? `<section class="level">
        <p class="eyebrow" style="margin:0">Ton palier de course</p>
        <p class="level-num">${run.level}<small>/${run.max}</small></p>
        <div class="level-track" style="grid-template-columns:repeat(${run.max},1fr)">${Array.from({ length: run.max }, (_, i) => `<i class="${i < run.level ? 'on' : ''}"></i>`).join('')}</div>
        <p class="muted small" style="margin:8px 0 0">Palier ${run.max} = ${esc(LEVELS[run.max - 1].label.replace(' de course continue', ''))} de course sans marcher. Recalculé après chaque bilan selon ta difficulté, ta fatigue et tes douleurs : des règles fixes, pas un coach humain.</p>
      </section>` : ''}
      ${todayItem ? todayHero(todayItem) : ''}
      <h3>Les ${progDays / 7} prochaines semaines</h3>
      ${rest.length ? `<div class="timeline">${rest.map((p) => planRow(p, p === firstRun)).join('')}</div>
        ${progDays < HORIZON ? '<button class="btn-ghost" data-moreplan style="width:100%;margin-top:8px">Voir 2 semaines de plus</button>' : ''}
        <p class="muted small">Le programme n'a pas de fin : il se recalcule après chaque bilan, et les semaines suivantes partent de là où tu en es.</p>` : '<p class="muted">Aucune séance prévue : choisis tes jours dans Profil > Mon programme.</p>'}
      ${practiced(d, 'muscu') ? muscuLibrary(d) : ''}
      ${practiced(d, 'course') ? `<h3>Mes séances</h3>
      <p class="muted small">Des séances guidées à faire quand tu veux, en dehors du plan.</p>
      ${screens.seance(true)}` : ''}`;
  },

  demarrer() {
    const d = load();
    const todayItem = planFor(d, 1).find((p) => p.date === today() && p.sport !== 'repos');
    const resumable = savedLive();
    return `
      <h1>Démarrer</h1>
      ${resumable ? `<button class="option" data-resume><span><span>Reprendre « ${esc(resumable.session.name)} »</span><span class="muted">Arrêtée à ${mmss(resumable.pos)}</span></span><span class="go">▶</span></button>` : ''}
      ${todayItem?.sport === 'course' ? `<h3 style="margin-top:0">Prévu aujourd'hui</h3>
        <button class="option" data-startplan="${esc(todayItem.date)}"><span><span>Palier ${todayItem.level} · ${Math.round(total(todayItem.steps) / 60)} min</span><span class="muted">${esc(todayItem.title)}</span></span><span class="go">▶</span></button>` : ''}
      ${todayItem?.sport === 'natation' ? `<h3 style="margin-top:0">Prévu aujourd'hui</h3>
        <button class="option natation" data-logplan="natation"><span><span>Natation · ${todayItem.longueurs} longueurs</span><span class="muted">Pas de téléphone dans l'eau : note-la en sortant.</span></span><span class="go">+</span></button>` : ''}
      ${todayItem?.sport === 'muscu' ? `<h3 style="margin-top:0">Prévu aujourd'hui</h3>
        <button class="option muscu" data-logplan="muscu"><span><span>${esc(todayItem.title)} · ${todayItem.exercices.length} exercices</span><span class="muted">Note charges et répétitions au fil des séries.</span></span><span class="go">+</span></button>` : ''}
      <h3>Course guidée</h3>
      ${d.sessions.map((x) => `<button class="option" data-start="${esc(x.id)}"><span><span>${esc(x.name)}</span><span class="muted">${minutesLabel(total(x.steps))} · ${x.steps.length} étapes</span></span><span class="go">▶</span></button>`).join('')}
      <h3>Noter une séance faite</h3>
      ${manualButtons(d, '')}`;
  },

  seance(embedded) {
    const d = load();
    return `
      ${embedded ? '' : '<h1>Séances</h1>'}
      <div class="list">
      ${d.sessions.map((s) => `
        <div class="li">
          <button class="ico course play" data-start="${esc(s.id)}" aria-label="Démarrer ${esc(s.name)}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
          <div class="li-main"><b>${esc(s.name)}</b><span>${minutesLabel(total(s.steps))} · ${s.steps.length} étapes</span></div>
          <button class="btn-ghost small-btn" data-edit="${esc(s.id)}">Modifier</button>
        </div>`).join('')}
      </div>
      <button data-new class="btn-ghost" style="width:100%;margin-top:8px">+ Nouvelle séance</button>`;
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
    const interrupted = !playing && live && !live.userPaused && audio.currentTime < live.track.end;
    return `
      <div class="live" id="live" data-effort="marche">
        <div class="live-top"><span id="stepno"></span><span><span class="gpsdot" id="gpsdot"></span><span id="gpsstate"></span></span></div>
        ${interrupted ? '<div class="alert">Séance interrompue (appel, Siri ou autre app). Touche « Reprendre ».</div>' : ''}
        <p class="now" id="now"></p>
        <p class="count" id="count"></p>
        <p class="next" id="next"></p>
        <div class="bar"><div id="progress"></div></div>
        <div class="live-stats">
          <div><b id="dist">0,00</b><span>km</span></div>
          <div><b id="pace">–</b><span>allure /km</span></div>
          <div><b id="elapsed">0:00</b><span>temps</span></div>
        </div>
        <p class="gpsline" id="gps"></p>
        ${load().settings.son !== 'exclusif' ? '<p class="muted small" style="margin:0">Mode musique : iPhone hors silencieux, sinon pas de signaux.</p>' : ''}
        <div class="live-controls">
          <button class="toggle${playing ? '' : ' paused'}" data-toggle>${playing ? 'Pause' : 'Reprendre'}</button>
          <button data-skip>Étape suivante</button>
        </div>
        <div class="live-extra">
          <button data-touchlock>Verrouiller (poche)</button>
          <button data-finish>Terminer</button>
        </div>
      </div>`;
  },

  bilan() {
    const b = bilan;
    const scale = (field, labels) => `<div class="scale">${[1, 2, 3, 4, 5].map((n) => `<button data-scale="${field}" data-v="${n}" class="${b[field] === n ? 'on' : ''}">${n}</button>`).join('')}</div><p class="muted small">${labels}</p>`;
    return `
      <h1>Bilan de la séance</h1>
      <div class="card">
        <p><strong>${esc(b.sessionName)}</strong></p>
        <p class="muted">${mmss(b.elapsedSec)} de séance · ${b.completedSteps} étape(s) sur ${b.steps.length}${b.skipped.length ? ` · ${b.skipped.length} passée(s)` : ''}</p>
        ${b.trace ? `<div class="map" data-map="bilan"></div>${b.gpsIncomplet ? '<p class="muted small">En pointillés : écran verrouillé, le GPS ne suivait plus.</p>' : ''}` : ''}
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

  // Juste après un bilan : ce qui change pour la suite, et pourquoi.
  suite() {
    const r = suite;
    const tag = { monte: '▲ ça monte', garde: '= on consolide', recul: '▼ on lève le pied', suite: 'la suite' }[r.verdict] || '';
    return `
      <h1>Et maintenant ?</h1>
      <section class="hero ${r.sport === 'repos' ? 'rest' : r.sport}">
        <p class="eyebrow">${esc(SPORT_LABEL[r.sport])} · ${esc(tag)}</p>
        <p class="hero-sub" style="font-size:26px;margin:8px 0 6px">${esc(r.titre)}</p>
        <p class="muted small" style="margin:0">${esc(r.detail)}</p>
      </section>
      <h3>Pour la prochaine séance</h3>
      ${r.ia === 'loading' ? '<p class="ia-wait">L’IA lit ton ressenti… En attendant, les conseils des règles :</p>' : ''}
      ${r.ia?.code ? `<div class="alert ia-fail"><strong>Conseils de secours (règles).</strong> ${esc(failureMessage(r.ia))}</div>` : ''}
      ${r.source === 'ia' ? '<p class="ia-ok">Conseils de l’IA, à partir de ton ressenti</p>' : ''}
      <ul class="conseils ${r.sport}">${r.conseils.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      ${r.next ? `<h3>Prochaine ${r.sport === 'natation' ? 'natation' : r.sport === 'muscu' ? 'muscu' : 'course'}</h3><div class="list">${planRow(r.next)}</div>` : ''}
      <p class="muted small">${r.source === 'ia'
        ? 'La suite du programme est décidée par les règles de Foulée. Les conseils sont écrits par une IA gratuite (Llama, via Cloudflare) : elle peut se tromper, ce n’est pas un coach ni un médecin.'
        : 'Règles fixes de Foulée, pas un coach : difficulté, essoufflement, fatigue, douleur et les mots de ton ressenti décident.'} Tes conseils restent affichés sur la carte de la prochaine séance.</p>
      <div class="row" style="margin-top:14px"><button data-tab="progression">Mon historique</button><button class="btn-dark" data-tab="programme">Mon programme</button></div>`;
  },

  progression() {
    const d = load();
    const sorted = [...d.history].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const runs = d.history.filter((h) => sportOf(h) === 'course');
    const swims = d.history.filter((h) => sportOf(h) === 'natation');
    const longest = Math.max(0, ...runs.map((h) => h.distanceKm || 0));
    const paces = runs.map((h) => h.allureSecKm || (h.distanceKm && h.elapsedSec && !h.distanceEstimee ? h.elapsedSec / h.distanceKm : 0)).filter(Boolean);
    const bestSwim = Math.max(0, ...swims.map(swimMeters));
    const progSports = ['course', 'natation', 'muscu'].filter((x) => practiced(d, x) || d.history.some((h) => sportOf(h) === x));
    const sp = progSports.includes(progSport) ? progSport : progSports[0] || 'course';
    const key = { course: 'km', natation: 'm', muscu: 'kg' }[sp];
    const wk = weekTotals(d.history, mondayOf(today()))[key];
    const prev = weekTotals(d.history, addDays(mondayOf(today()), -7))[key];
    const diff = wk - prev;
    const fmt = (v) => (sp === 'course' ? fmtKm(v) : Math.round(v).toLocaleString('fr-FR'));
    // Musculation : meilleure charge par exercice (les 3 plus lourdes).
    const best = {};
    for (const h of d.history.filter((x) => sportOf(x) === 'muscu')) for (const x of h.exercices || []) if (x.poids > (best[x.id]?.poids || 0)) best[x.id] = x;
    const topLifts = Object.values(best).sort((a, b) => b.poids - a.poids).slice(0, 3);
    return `
      <h1>Progression</h1>
      ${d.history.length ? `
        ${progSports.length > 1 ? `<div class="seg">${progSports.map((x) => `<button data-progsport="${x}" class="${sp === x ? `on ${x}` : ''}">${SPORT_LABEL[x]}</button>`).join('')}</div>` : ''}
        <section class="prog ${sp}">
          <p class="eyebrow" style="margin:0">Cette semaine</p>
          <p class="hero-num">${fmt(wk)}<small>${key}</small></p>
          <p class="delta ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '▲' : diff < 0 ? '▼' : '='} ${fmt(Math.abs(diff))} ${key} par rapport à la semaine dernière</p>
          ${weekCurve(d.history, sp)}
        </section>
        ${sp === 'muscu' ? '<p class="muted small" style="margin-top:4px">Total soulevé = charge × répétitions de la semaine, hors poids du corps.</p>' : ''}
        <h3>Records</h3>
        ${sp === 'muscu' ? `<div class="records">${topLifts.length ? topLifts.map((x) => `<div class="muscu"><b>${String(x.poids).replace('.', ',')}<small>kg</small></b><span>${esc(x.nom.split(' (')[0])}</span></div>`).join('') : '<div class="muscu"><b>–</b><span>aucune charge notée</span></div>'}</div>` : `<div class="records">
          ${practiced(d, 'course') || runs.length ? `<div class="course"><b>${longest ? fmtKm(longest) : '–'}<small>km</small></b><span>plus longue course</span></div>
          <div class="course"><b>${paces.length ? allure(Math.min(...paces)).replace('/km', '') : '–'}</b><span>meilleure allure</span></div>` : ''}
          ${practiced(d, 'natation') || swims.length ? `<div class="natation"><b>${bestSwim || '–'}<small>m</small></b><span>plus longue nage</span></div>` : ''}
        </div>`}
        ${sp === 'course' ? '<p class="muted small" style="margin-top:8px">Allure moyenne marche comprise : elle baisse quand tu cours plus longtemps.</p>' : ''}` : ''}
      <h3>Historique</h3>
      ${manualButtons(d, 'btn-ghost', null, 'margin-bottom:10px', ' libre')}
      ${sorted.length === 0 ? '<p class="muted">Aucune séance pour l\'instant.</p>' : `<div class="list">${sorted.map(historyRow).join('')}</div>`}
      <h3>Proches</h3>
      <p class="muted small">Le partage de séances avec tes proches n'existe pas encore : pour l'instant, chacun a son compte et ses données. Inviter quelqu'un : Profil.</p>`;
  },

  saisie() {
    const b = bilan;
    const swim = b.sport === 'natation';
    const scale = (field, labels) => `<div class="scale">${[1, 2, 3, 4, 5].map((n) => `<button data-scale="${field}" data-v="${n}" class="${b[field] === n ? 'on' : ''}">${n}</button>`).join('')}</div><p class="muted small">${labels}</p>`;
    const nages = ['crawl', 'brasse', 'dos', 'papillon'];
    return `
      <h1>${b.sport === 'muscu' ? esc(b.sessionName) : swim ? 'Séance de natation' : b.fromPlan ? 'Course du programme' : 'Course libre'}</h1>
      ${b.fromPlan ? '<p class="muted">Prérempli avec le programme du jour. Corrige ce qui a changé, puis note ton ressenti.</p>' : ''}
      <div class="card">
        <label for="date">Date</label>
        <input id="date" type="date" value="${esc(b.date)}">
        <label for="duree">Durée (minutes)</label>
        <input id="duree" type="number" inputmode="numeric" min="1" max="600" value="${b.elapsedSec ? Math.round(b.elapsedSec / 60) : ''}">
        ${b.sport === 'muscu' ? '' : swim ? `
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
      </div>
      ${b.sport === 'muscu' ? muscuForm(b) : ''}
      <div class="card">
        <label style="margin-top:0">Difficulté</label>
        ${scale('difficulte', '1 = très facile · 5 = très dur')}
        ${b.sport === 'muscu' ? '' : `<label>Essoufflement</label>
        ${scale('essoufflement', '1 = je pouvais parler · 5 = à bout de souffle')}`}
        <label>Fatigue</label>
        ${scale('fatigue', '1 = en forme · 5 = épuisé')}
        <label for="douleur">Une douleur ?</label>
        <input id="douleur" placeholder="Ex. : épaule gauche, légère" value="${esc(b.douleur)}">
        <label for="comm">Ton ressenti</label>
        <textarea id="comm">${esc(b.commentaire)}</textarea>
      </div>
      <div class="row"><button data-tab="progression">Annuler</button><button class="btn-dark" data-savemanual>Enregistrer</button></div>`;
  },

  compte() {
    const sess = account.session();
    const a = accountUi;
    if (!account.serverEnabled()) {
      return `
        <h1>Mon compte</h1>
        <div class="card"><h2>Bientôt disponible</h2>
        <p>Les comptes sont prêts, mais le serveur n'est pas encore en service. En attendant, tes séances restent sur ce téléphone.</p></div>
        <button data-tab="profil" style="width:100%">Retour</button>`;
    }
    if (!account.passkeysSupported()) {
      return `<h1>Mon compte</h1><div class="alert">Ce navigateur ne gère pas les passkeys. Mets à jour ton téléphone ou ouvre Foulée dans Safari (iPhone) ou Chrome (Android).</div>`;
    }
    const msg = a.error ? `<div class="alert">${esc(a.error)}</div>` : a.info ? `<div class="notice">${esc(a.info)}</div>` : '';
    if (sess) {
      return `
        <h1>Mon compte</h1>
        ${msg}
        <div class="card">
          <p class="muted small">Connecté</p>
          <h2>${esc(sess.user?.prenom ?? '')}</h2>
          <p class="muted small">${a.sync ? esc(a.sync) : 'Tes séances sont sauvegardées sur ton compte.'}</p>
        </div>
        <div class="card">
          <h2>Inviter un proche</h2>
          <p class="muted small">Un lien à usage unique, valable 14 jours. La personne crée son propre compte : elle ne voit pas tes données.</p>
          <button class="btn-dark" data-invite="join" style="width:100%" ${a.busy ? 'disabled' : ''}>Créer un lien d'invitation</button>
          ${a.lastInvite ? `<p class="small" id="invite-link" style="margin-top:10px;word-break:break-all">${esc(a.lastInvite)}</p><button data-share style="width:100%">Envoyer le lien</button>` : ''}
          ${a.invites?.length ? `<ul class="steps" style="margin-top:10px">${a.invites.map((i) => `<li><span>${i.kind === 'recover' ? 'Nouvel appareil' : 'Invitation'} du ${new Date(i.created_at).toLocaleDateString('fr-FR')}</span><span class="muted small">${i.used_at ? `utilisée${i.used_by_prenom ? ` par ${esc(i.used_by_prenom)}` : ''}` : i.expires_at < Date.now() ? 'expirée' : 'en attente'}</span></li>`).join('')}</ul>` : ''}
        </div>
        <div class="card">
          <h2>Nouveau téléphone</h2>
          <p class="muted small">Sur iPhone, ta passkey passe d'un appareil à l'autre avec le trousseau iCloud. Sinon, crée ici un lien à ouvrir sur le nouvel appareil.</p>
          <button data-invite="recover" style="width:100%" ${a.busy ? 'disabled' : ''}>Lien pour un nouvel appareil</button>
        </div>
        <button class="btn-danger" data-logout style="width:100%">Se déconnecter</button>`;
    }
    const needsInvite = !a.firstAccount;
    return `
      <h1>${a.invite ? 'Bienvenue sur Foulée' : 'Mon compte'}</h1>
      ${msg}
      ${a.invite && a.inviteFrom ? `<p>${esc(a.inviteFrom)} t'invite à rejoindre Foulée.</p>` : ''}
      ${a.invite || a.firstAccount ? '' : `
        <div class="card">
          <h2>J'ai déjà un compte</h2>
          <button class="btn-primary" data-login ${a.busy ? 'disabled' : ''}>Me connecter</button>
          <p class="muted small" style="margin-top:8px">Avec Face ID, Touch ID ou ton empreinte. Pas de mot de passe.</p>
        </div>`}
      <div class="card">
        <h2>${a.invite?.kind === 'recover' ? 'Ajouter ce téléphone à mon compte' : 'Créer mon compte'}</h2>
        ${a.firstAccount ? '<p class="muted small">Premier compte : il sera administrateur et pourra inviter les autres.</p>' : ''}
        ${a.invite?.kind === 'recover' ? '' : `<label for="acc-prenom">Prénom</label><input id="acc-prenom" maxlength="40" value="${esc(load().profile.prenom)}">`}
        ${needsInvite && !a.invite ? `<label for="acc-invite">Code ou lien d'invitation</label><input id="acc-invite" autocapitalize="off" autocomplete="off">` : ''}
        <p style="margin-top:12px"><button class="btn-dark" data-register style="width:100%" ${a.busy ? 'disabled' : ''}>${a.invite?.kind === 'recover' ? 'Ajouter ce téléphone' : 'Créer mon compte'}</button></p>
        <p class="muted small">Ton téléphone crée une passkey protégée par Face ID ou ton empreinte. ${load().owner ? 'Les séances du compte déjà utilisé sur ce téléphone ne seront pas reprises : ton compte démarre vide.' : 'Tes séances déjà enregistrées ici rejoignent ton compte.'}</p>
      </div>`;
  },

  questionnaire() {
    const d = load();
    const q = qDraft;
    const runs = hasRuns(d);
    const swims = hasSwims(d);
    const runFromHistory = runs && nextRunLevel(d.history, sameLevelOpts);
    const errs = questionnaireErrors(q, d);
    const preview = errs ? [] : upcoming(d.history, d.settings, today(), 14, cleanAnswers(q, d));
    const firstRun = preview.find((p) => p.sport === 'course');
    const firstSwim = preview.find((p) => p.sport === 'natation');
    const firstMuscu = preview.find((p) => p.sport === 'muscu');
    const fresh = !d.profile.questionnaire;
    let n = 0;
    const num = () => `<span class="q-num">${++n}</span>`;
    return `
      ${accountUi.info && fresh ? `<div class="notice">${esc(accountUi.info)}</div>` : ''}
      <p class="eyebrow" style="margin-top:0">${fresh ? 'Avant de commencer' : 'Mon programme'}</p>
      <h1 class="q-title">Ton programme,<br>à ta mesure</h1>
      <p class="muted">Tes réponses ne servent qu'à calculer ton programme. Tu peux les changer quand tu veux dans Profil.</p>

      <h3>${num()}Ce que tu pratiques</h3>
      <div class="q-sports">
        <button data-qsport="course" class="${q.sports.includes('course') ? 'on course' : ''}">Course</button>
        <button data-qsport="natation" class="${q.sports.includes('natation') ? 'on natation' : ''}">Natation</button>
        <button data-qsport="muscu" class="${q.sports.includes('muscu') ? 'on muscu' : ''}">Musculation</button>
      </div>

      ${q.sports.includes('course') ? `<section class="q-part course">${qPartHead('course')}
        <h3>${num()}Ton objectif en course</h3>
        ${Object.entries(GOALS_RUN).map(([k, g]) => radio('q-objc', k, q.objectifCourse, g.label, g.detail)).join('')}
        <h3>${num()}Aujourd'hui, tu cours sans t'arrêter…</h3>
        ${runs ? `<p class="q-known">Déjà connu grâce à tes séances : <b>palier ${runFromHistory.level}</b>, ${esc(LEVELS[runFromHistory.level - 1].label)}. Le programme continue de là.</p>`
          : START_RUN.map((x) => radio('q-nivc', x.level, q.niveauCourse, x.label)).join('')}
        <h3>${num()}Tes jours de course</h3>
        ${qDays('joursCourse', q.joursCourse)}
        <p class="muted small" style="margin-top:8px">Garde un jour entre deux courses : sinon la seconde devient un jour de repos.</p></section>` : ''}

      ${q.sports.includes('natation') ? `<section class="q-part natation">${qPartHead('natation')}
        <h3>${num()}Ton bassin</h3>
        <div class="seg"><button data-qbassin="25" class="${q.bassin === 25 ? 'on natation' : ''}">25 m</button><button data-qbassin="50" class="${q.bassin === 50 ? 'on natation' : ''}">50 m</button></div>
        <h3>${num()}Ton objectif en natation</h3>
        ${GOALS_SWIM.map((m) => radio('q-objn', m, q.objectifNatation, `Nager ${(m / 1000).toLocaleString('fr-FR')} km par séance`, `${Math.round(m / q.bassin)} longueurs`)).join('')}
        <h3>${num()}Aujourd'hui, en une séance, tu nages…</h3>
        ${swims ? '<p class="q-known">Déjà connu grâce à tes séances : le programme repart de ta dernière nage.</p>'
          : START_SWIM.map((x) => radio('q-nivn', x.longueurs, q.niveauNatation, x.label)).join('')}
        <h3>${num()}Tes jours de natation</h3>
        ${qDays('joursNatation', q.joursNatation, 'natation')}</section>` : ''}

      ${q.sports.includes('muscu') ? `<section class="q-part muscu">${qPartHead('muscu')}
        <h3>${num()}Ton objectif en musculation</h3>
        ${Object.entries(GOALS_MUSCU).map(([k, g]) => radio('q-objm', k, q.objectifMuscu, g.label, `${g.series} séries de ${g.min} à ${g.max} répétitions`)).join('')}
        <h3>${num()}Où tu t'entraînes</h3>
        ${Object.entries(LIEUX).map(([k, l]) => radio('q-lieu', k, q.lieu, l.label, l.detail)).join('')}
        <h3>${num()}Où tu en es</h3>
        ${Object.entries(NIVEAUX_MUSCU).map(([k, n]) => radio('q-nivm', k, q.niveauMuscu, n.label, k === 'regulier' ? '' : 'une série de moins les 4 premières séances')).join('')}
        <h3>${num()}Tes jours de musculation</h3>
        ${qDays('joursMuscu', q.joursMuscu, 'muscu')}
        <p class="muted small" style="margin-top:8px">Jusqu'à 3 jours : corps entier, séances A et B en alternance. 4 jours ou plus : haut du corps et bas du corps.</p></section>` : ''}

      ${errs ? '' : `<section class="q-preview">
        <p class="eyebrow" style="margin:0">Ce que ça donne</p>
        ${firstRun ? `<p><b class="run">Course · ${shortDate(firstRun.date)}</b> Palier ${firstRun.level}/${firstRun.max}, ${esc(firstRun.title)}</p>` : ''}
        ${firstSwim ? `<p><b class="swim">Natation · ${shortDate(firstSwim.date)}</b> ${firstSwim.longueurs} longueurs, ${firstSwim.distance} m</p>` : ''}
        ${firstMuscu ? `<p><b class="muscu">Musculation · ${shortDate(firstMuscu.date)}</b> ${esc(firstMuscu.title)} : ${esc(firstMuscu.exercices.map((x) => x.nom.split(' (')[0]).join(', '))}</p>` : ''}
        <p class="muted small" style="margin:0">Des règles fixes, pas un coach humain : ça monte quand tes bilans sont bons, ça redescend si c'est trop dur ou douloureux.</p>
      </section>`}
      ${q.error ? `<div class="alert">${esc(q.error)}</div>` : ''}
      <button class="btn-primary" data-qsave style="margin-top:14px">${fresh ? 'Créer mon programme' : 'Enregistrer'}</button>
      ${fresh ? '<button class="btn-ghost" data-tab="accueil" style="width:100%;margin-top:6px">Plus tard</button>' : '<button class="btn-ghost" data-tab="profil" style="width:100%;margin-top:6px">Annuler</button>'}`;
  },

  profil() {
    const d = load();
    const sess = account.session();
    const supported = 'audioSession' in navigator;
    const prenom = d.profile.prenom || sess?.user?.prenom || '';
    return `
      <div class="profile-head">
        <div class="avatar">${esc((prenom[0] || '?').toUpperCase())}</div>
        <div><h1>${esc(prenom) || 'Profil'}</h1><p class="muted small" style="margin:4px 0 0">${!account.serverEnabled() ? 'Séances sur ce téléphone' : sess ? 'Compte connecté' : 'Non connecté : séances sur ce téléphone'}</p></div>
      </div>
      <div class="card">
        <h2>Compte et proches</h2>
        <p class="muted small">${sess ? 'Sauvegarde de tes séances, invitations, nouveau téléphone.' : 'Crée ton compte ou connecte-toi pour sauvegarder tes séances et inviter tes proches.'}</p>
        <button data-tab="compte" style="width:100%">${sess ? 'Gérer mon compte et inviter' : 'Connexion / créer mon compte'}</button>
      </div>
      <div class="card">
        <label for="prenom" style="margin-top:0">Ton prénom</label>
        <input id="prenom" value="${esc(d.profile.prenom)}" maxlength="40">
      </div>
      <div class="card">
        <h2>Mon programme</h2>
        ${d.profile.questionnaire
          ? `<ul class="q-summary">${answersSummary(d.profile.questionnaire).map(([sp, t]) => `<li class="${sp}">${esc(t)}</li>`).join('')}</ul>`
          : '<p class="muted small">Pas encore personnalisé : tu as le programme par défaut (course lundi et vendredi, natation mercredi).</p>'}
        <button data-questionnaire style="width:100%">${d.profile.questionnaire ? 'Modifier mes réponses' : 'Répondre au questionnaire'}</button>
      </div>
      <div class="card">
        <h2>Signal de changement d'étape</h2>
        <label class="choice"><input type="radio" name="annonces" value="signaux" ${d.settings.annonces !== 'voix' ? 'checked' : ''}><span><strong>Signaux sonores</strong> : notes qui montent = cours, notes qui descendent = marche, 3 bips avant chaque changement.</span></label>
        <label class="choice"><input type="radio" name="annonces" value="voix" ${d.settings.annonces === 'voix' ? 'checked' : ''}><span><strong>Voix</strong> : annonce chaque étape et sa durée.</span></label>
      </div>
      <div class="card">
        <h2>Son pendant la séance</h2>
        <label class="choice"><input type="radio" name="mode" value="musique" ${d.settings.son !== 'exclusif' ? 'checked' : ''}><span><strong>Avec ma musique</strong> : les signaux passent par-dessus ta musique. Garde l'écran allumé.</span></label>
        <label class="choice"><input type="radio" name="mode" value="exclusif" ${d.settings.son === 'exclusif' ? 'checked' : ''}><span><strong>Sans musique</strong> : continue même écran verrouillé, mais met ta musique en pause.</span></label>
        ${supported ? '' : '<p class="muted small">Ce navigateur ne permet pas de choisir : le mode par défaut s\'applique.</p>'}
      </div>
      <div class="card">
        <h2>Mes données</h2>
        <p class="muted small">Importer un fichier d'export Foulée ou un historique préparé. Les séances déjà présentes ne sont pas dupliquées.</p>
        <div class="row"><button data-import>Importer</button>${d.history.length ? '<button data-export>Exporter</button>' : ''}</div>
        <input id="importfile" type="file" accept="application/json,.json" hidden>
      </div>
      <p class="muted small">Voix : modèle libre « siwis » (Piper, licence CC-BY 4.0, Université d'Édimbourg).</p>`;
  },
};

// Calendrier : revient où il était, sinon s'ouvre sur la semaine en cours.
function placeWeek() {
  const strip = document.getElementById('week');
  if (!strip) return;
  const monday = strip.querySelector(`[data-pickday="${mondayOf(today())}"]`);
  strip.scrollLeft = weekScroll ?? monday.offsetLeft - strip.offsetLeft;
}

// Onglet allumé pour chaque écran.
const TAB_OF = { questionnaire: 'profil', edit: 'programme', live: 'demarrer', bilan: 'progression', saisie: 'progression', suite: 'programme', compte: 'profil' };

function render() {
  app.innerHTML = screens[current]();
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === (TAB_OF[current] || current));
  document.body.classList.toggle('is-live', current === 'live');
  mountMaps();
  placeWeek();
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
    live.done = true;
    bilan = {
      id: uid(),
      sport: 'course',
      source: 'guidee',
      date: live.startedAt,
      sessionName: live.session.name,
      level: live.session.level ?? null,
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
      trace: encodeTrace(gps.points),
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

function showSuite(entry) {
  const d = load();
  suite = afterBilan(d.history, entry, d.settings, today(), d.profile.questionnaire);
  go('suite');
  askIA(entry.id);
}

// --- Conseils de l'IA ---------------------------------------------------------

// Alerte de l'accueil : l'IA n'a pas lu un bilan récent, pourquoi, et quand elle reprend.
function iaAlert(history) {
  const failed = failedIA(history);
  if (!failed.length) return '';
  const h = failed[0];
  return `<div class="alert ia-fail"><strong>IA indisponible : conseils de secours.</strong> ${esc(failureMessage(h.iaEchec))}
    <div class="row" style="margin-top:10px"><button class="btn-dark" data-retryia="${esc(h.id)}">Réessayer maintenant</button></div></div>`;
}

const asking = new Set();
const OBJECTIFS = { '30min': 'courir 30 min sans s’arrêter', '5km': 'courir 5 km', '10km': 'réussir un 10 km' };

// Fait lire un bilan par l'IA. Réussite : conseils gardés sur la séance (et synchronisés).
// Échec : la raison et l'heure de reprise sont gardées pour l'alerte ; les règles restent.
async function askIA(id, { force = false } = {}) {
  if (asking.has(id)) return;
  const d = load();
  const entry = d.history.find((h) => h.id === id);
  if (!entry || (hasIA(entry) && !force)) return;
  const setState = (ia) => { if (suite?.entryId === id) { suite.ia = ia; if (current === 'suite') render(); } };
  if (!account.serverEnabled()) return; // pas de serveur : les règles seules, sans alerte
  if (!account.session()) { setState({ code: 'nonconnecte' }); return; }
  asking.add(id);
  setState('loading');
  const q = d.profile.questionnaire;
  const ctx = suite?.entryId === id ? suite : afterBilan(d.history, entry, d.settings, today(), q);
  try {
    const res = await account.askConseils(iaInput(entry, d.history, ctx, OBJECTIFS[q?.objectifCourse] || ''));
    update((dd) => { const h = dd.history.find((x) => x.id === id); if (h) { h.conseilsIA = res; delete h.iaEchec; } });
    if (suite?.entryId === id) Object.assign(suite, { conseils: res.conseils, source: 'ia', ia: null });
  } catch (e) {
    const fail = { code: e.code || (e.status === 401 ? 'nonconnecte' : 'indisponible'), resetAt: e.resetAt || null, at: Date.now() };
    update((dd) => { const h = dd.history.find((x) => x.id === id); if (h) h.iaEchec = fail; });
    if (suite?.entryId === id) suite.ia = fail;
  } finally {
    asking.delete(id);
  }
  if (['suite', 'accueil', 'programme'].includes(current)) render();
}

// À l'ouverture : les bilans récents restés sans conseils de l'IA, une fois l'heure de reprise passée.
function retryIA() {
  if (!account.serverEnabled() || !account.session()) return;
  for (const h of pendingIA(load().history)) askIA(h.id);
}

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

// Exercices à noter : ceux d'une séance prévue, avec une case par série.
const muscuLog = (p) => ({
  seance: p.seance,
  sessionName: p.title,
  exercices: p.exercices.map((x) => ({ slot: x.slot, id: x.id, nom: x.nom, muscle: x.muscle, materiel: x.materiel, unite: x.unite, min: x.min, max: x.max, poids: x.poids, reps: Array(x.series).fill(null) })),
});

function newManual(sport) {
  if (sport === 'muscu') {
    // Séance libre : la prochaine séance du cycle.
    const d = load();
    const q = d.profile.questionnaire || {};
    const p = muscuPlan(nextSeance(d.history, (q.joursMuscu || []).length), d.history, q, d.settings.muscuChoix || {});
    return { id: uid(), sport, source: 'manuelle', date: today(), elapsedSec: null, ...muscuLog(p), difficulte: null, fatigue: null, douleur: '', commentaire: '' };
  }
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
  if (bilan.sport === 'muscu') {
    bilan.exercices.forEach((x, i) => {
      const kg = parseFloat(String(v(`kg-${i}`)?.value ?? '').replace(',', '.'));
      x.poids = Number.isFinite(kg) && kg > 0 ? Math.round(kg * 10) / 10 : null;
      x.reps = x.reps.map((_, j) => {
        const n = parseInt(v(`rep-${i}-${j}`)?.value, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      });
    });
  } else if (bilan.sport === 'natation') {
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

// Musculation : charge (une pour toutes les séries) et répétitions faites, série par série.
function muscuForm(b) {
  const lieu = load().profile.questionnaire?.lieu || 'salle';
  return `
    <p class="muted small">Note ce que tu as vraiment fait : une série vide = pas faite. La charge de la prochaine séance en dépend.</p>
    ${b.exercices.map((x, i) => {
      const alts = alternatives(x.muscle, lieu);
      const body = x.materiel === 'corps';
      return `
      <section class="exo-log">
        <h2>${esc(x.nom)}</h2>
        <p class="muted small" style="margin:2px 0 0">${esc(x.muscle)} · objectif ${x.min} à ${x.max}${x.unite === 's' ? ' s' : ' répétitions'} par série</p>
        ${alts.length > 1 ? `<select data-swap="${i}" aria-label="Changer d'exercice">${alts.map((e) => `<option value="${e.id}" ${e.id === x.id ? 'selected' : ''}>${esc(e.nom)}</option>`).join('')}</select>` : ''}
        ${body ? '' : `<div class="kg"><input id="kg-${i}" type="number" inputmode="decimal" step="0.5" min="0" placeholder="?" value="${x.poids ?? ''}"><span>kg${x.materiel === 'halteres' ? ' par haltère' : x.materiel === 'barre' ? ' au total, barre comprise' : ''}</span></div>`}
        <div class="sets">${x.reps.map((r, j) => `<label>Série ${j + 1}<input id="rep-${i}-${j}" type="number" inputmode="numeric" min="0" max="300" placeholder="${x.max}" value="${r ?? ''}"></label>`).join('')}</div>
        <div class="row" style="margin-top:8px"><button class="btn-ghost small-btn" data-mfill="${i}">${x.max} partout</button><button class="btn-ghost small-btn" data-mset="${i}">+ une série</button></div>
      </section>`;
    }).join('')}`;
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
  if (ds.pickday) {
    selDay = ds.pickday;
    weekScroll = document.getElementById('week')?.scrollLeft ?? null;
    render();
  } else if (ds.tab) {
    if (ds.tab === 'accueil') { selDay = today(); weekScroll = null; }
    if (current === 'live' && !audio.paused && !confirm('La séance continue en arrière-plan. Quitter l\'écran ?')) return;
    go(ds.tab === 'demarrer' && live && !live.done ? 'live' : ds.tab);
  } else if (ds.start) {
    startSession(findSession(ds.start));
  } else if ('resume' in ds) {
    const r = savedLive();
    if (r) startSession(r.session, r);
  } else if ('dropresume' in ds) {
    clearLive();
    render();
  } else if (ds.startplan) {
    const p = planFor(load()).find((x) => x.date === ds.startplan && x.sport === 'course');
    if (p) startSession({ id: `plan-${p.date}`, name: `Palier ${p.level} · ${p.title}`, steps: p.steps, level: p.level });
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
    go('programme');
  } else if ('save' in ds) {
    readEditor();
    const { isNew, ...s } = editing;
    update((d) => {
      const i = d.sessions.findIndex((x) => x.id === s.id);
      if (i >= 0) d.sessions[i] = s;
      else d.sessions.push(s);
    });
    go('programme');
  } else if ('remove' in ds) {
    if (!confirm('Supprimer cette séance ?')) return;
    update((d) => { d.sessions = d.sessions.filter((x) => x.id !== editing.id); });
    if (load().sessions.length === 0) update((d) => { d.sessions = structuredClone(PRESETS); });
    go('programme');
  } else if ('toggle' in ds) {
    if (audio.paused) audio.play();
    else {
      live.userPaused = true;
      audio.pause();
    }
  } else if ('skip' in ds) {
    nextStep();
  } else if ('questionnaire' in ds) {
    openQuestionnaire();
  } else if (ds.qsport) {
    const set = new Set(qDraft.sports);
    if (set.has(ds.qsport)) set.delete(ds.qsport); else set.add(ds.qsport);
    qDraft.sports = [...set];
    qDraft.error = null;
    render();
  } else if (ds.qday) {
    const n = Number(ds.v);
    const cur = new Set(qDraft[ds.qday]);
    if (cur.has(n)) cur.delete(n); else cur.add(n);
    qDraft[ds.qday] = [...cur].sort();
    qDraft.error = null;
    render();
  } else if (ds.qbassin) {
    qDraft.bassin = Number(ds.qbassin);
    render();
  } else if ('qsave' in ds) {
    const d = load();
    qDraft.error = questionnaireErrors(qDraft, d);
    if (qDraft.error) { render(); return; }
    const answers = cleanAnswers(qDraft, d);
    update((x) => { x.profile.questionnaire = answers; });
    qDraft = null;
    accountUi.info = null;
    selDay = today();
    go('programme');
  } else if ('touchlock' in ds) {
    touchLocked = true;
    renderTouchLock();
  } else if ('finish' in ds) {
    go('bilan');
  } else if (ds.retryia) {
    askIA(ds.retryia, { force: true });
  } else if ('moreplan' in ds) {
    progDays = Math.min(HORIZON, progDays + 14);
    render();
  } else if (ds.progsport) {
    progSport = ds.progsport;
    render();
  } else if (ds.manual) {
    bilan = newManual(ds.manual);
    if (ds.mdate) bilan.date = ds.mdate;
    go('saisie');
  } else if (ds.logplan) {
    // Saisie préremplie avec la séance prévue aujourd'hui ; tout reste modifiable.
    const p = planFor(load(), 1).find((x) => x.sport === ds.logplan);
    bilan = newManual(ds.logplan);
    bilan.fromPlan = Boolean(p);
    if (p?.sport === 'natation') {
      bilan.sessionName = 'Natation (programme)';
      bilan.swim.bassinM = p.bassin;
      bilan.swim.longueurs = p.longueurs;
      bilan.swim.nages = ['crawl', 'brasse', 'dos'].filter((n) => p.plan.some((l) => l.includes(n)));
    } else if (p?.sport === 'muscu') {
      Object.assign(bilan, muscuLog(p));
    } else if (p?.sport === 'course') {
      bilan.sessionName = `Palier ${p.level} · ${p.title}`;
      bilan.structure = stepsSummary(p.steps).replace(/ · /g, ', ').replace(/\d+ × [^,]+ de course/, p.title);
      bilan.elapsedSec = Math.round(total(p.steps) / 60) * 60;
    }
    go('saisie');
  } else if (ds.mfill !== undefined || ds.mset !== undefined) {
    readSaisie();
    const x = bilan.exercices[Number(ds.mfill ?? ds.mset)];
    if (ds.mfill !== undefined) x.reps = x.reps.map(() => x.max);
    else if (x.reps.length < 10) x.reps.push(null);
    render();
  } else if ('savemanual' in ds) {
    readSaisie();
    if (bilan.sport === 'muscu') {
      // Séries vides = non faites (0) ; un exercice sans aucune série n'est pas gardé.
      const kept = bilan.exercices.filter((x) => x.reps.some((r) => r > 0)).map((x) => ({ ...x, reps: x.reps.map((r) => r || 0) }));
      if (!kept.length) { alert('Note au moins une série.'); return; }
      bilan.exercices = kept;
    }
    const entry = bilan;
    update((d) => { d.history.push(entry); });
    progSport = entry.sport; // Progression s'ouvre sur le sport qu'on vient de noter
    bilan = null;
    showSuite(entry);
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
    clearLive();
    if (live) URL.revokeObjectURL(live.url);
    live = null;
    audio.removeAttribute('src');
    audio.load();
    bilan = null;
    showSuite(entry);
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
    update((d) => { d.settings.son = e.target.value; });
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
      go('progression');
    });
  } else if (current === 'questionnaire' && e.target.name?.startsWith('q-')) {
    const key = { 'q-objc': 'objectifCourse', 'q-nivc': 'niveauCourse', 'q-objn': 'objectifNatation', 'q-nivn': 'niveauNatation', 'q-objm': 'objectifMuscu', 'q-lieu': 'lieu', 'q-nivm': 'niveauMuscu' }[e.target.name];
    qDraft[key] = ['niveauCourse', 'objectifNatation', 'niveauNatation'].includes(key) ? Number(e.target.value) : e.target.value;
    qDraft.error = null;
    render();
  } else if (current === 'saisie' && e.target.dataset.swap !== undefined) {
    // Autre exercice du même muscle : gardé pour les prochaines séances.
    readSaisie();
    const i = Number(e.target.dataset.swap);
    const x = bilan.exercices[i];
    const ex = byId(e.target.value);
    const d = load();
    const goal = GOALS_MUSCU[d.profile.questionnaire?.objectifMuscu] || GOALS_MUSCU.muscle;
    const next = nextLoad(ex, d.history, goal);
    bilan.exercices[i] = { ...x, id: ex.id, nom: ex.nom, materiel: ex.materiel, unite: ex.unite, min: next.min, max: next.max, poids: next.poids };
    if (bilan.seance && x.slot !== undefined) update((dd) => { dd.settings.muscuChoix = { ...dd.settings.muscuChoix, [`${bilan.seance}:${x.slot}`]: ex.id }; });
    render();
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

// --- Compte et synchronisation -----------------------------------------------

let accountUi = { busy: false, error: null, info: null, invite: null, inviteFrom: null, firstAccount: false, invites: null, lastInvite: null, sync: null };
let syncing = false;
let pushTimer = null;

// Les données du téléphone appartiennent-elles au compte connecté ? `owner` est posé
// à la première synchronisation. Des données sans propriétaire (utilisées avant tout
// compte) rejoignent le compte ; celles d'un autre compte ne sont jamais envoyées.
const ownLocal = () => {
  const owner = load().owner;
  const id = account.session()?.user?.id;
  return !owner || !id || owner === id;
};

async function syncNow() {
  if (!account.serverEnabled() || !account.session()) return;
  syncing = true;
  try {
    const { data } = await account.pullData();
    const user = account.session()?.user;
    const merged = account.mergeData(ownLocal() ? load() : empty(), data);
    if (user?.id) merged.owner = user.id;
    if (user?.prenom && !merged.profile?.prenom) merged.profile = { ...merged.profile, prenom: user.prenom };
    replace(merged);
    await account.pushData(load());
    accountUi.sync = `Synchronisé à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`;
  } catch (e) {
    accountUi.sync = `Synchronisation en attente : ${e.message}`;
  } finally {
    syncing = false;
  }
  if (current !== 'live') render();
}

onSave(() => {
  if (syncing || !account.serverEnabled() || !account.session() || !ownLocal()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    if (!ownLocal()) return;
    account.pushData(load())
      .then(() => { accountUi.sync = `Synchronisé à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`; })
      .catch((e) => { accountUi.sync = `Synchronisation en attente : ${e.message}`; });
  }, 2000);
});

async function refreshAccount() {
  if (!account.serverEnabled()) return;
  try {
    accountUi.firstAccount = (await account.status()).firstAccount;
    if (account.session()) accountUi.invites = (await account.listInvites()).invites;
  } catch (e) {
    accountUi.error = e.message;
  }
  if (current === 'compte') render();
}

async function accountAction(fn) {
  accountUi.busy = true;
  accountUi.error = null;
  accountUi.info = null;
  render();
  try {
    await fn();
  } catch (e) {
    accountUi.error = e.message;
  }
  accountUi.busy = false;
  render();
}

const inviteFromText = (txt) => {
  const t = String(txt || '').trim();
  const m = /[?&]invite=([A-Za-z0-9_-]+)/.exec(t);
  return m ? m[1] : t;
};

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const ds = t.dataset;
  if ('register' in ds) {
    const prenom = document.getElementById('acc-prenom')?.value.trim() || load().profile.prenom;
    const code = accountUi.invite?.code || inviteFromText(document.getElementById('acc-invite')?.value);
    accountAction(async () => {
      const user = await account.register(prenom, code || undefined);
      accountUi.invite = null;
      await syncNow();
      update((d) => { d.profile.prenom = user.prenom; });
      const installed = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
      accountUi.info = installed
        ? `Compte créé. Bienvenue ${user.prenom} !`
        : `Compte créé. Installe maintenant Foulée sur ton écran d'accueil (Partager > Sur l'écran d'accueil sur iPhone, menu ⋮ > Installer sur Android), ouvre-la et touche « Me connecter ».`;
      await refreshAccount();
      if (!load().profile.questionnaire) openQuestionnaire();
    });
  } else if ('login' in ds) {
    accountAction(async () => {
      const user = await account.login();
      await syncNow();
      accountUi.info = `Bon retour ${user.prenom} !`;
      await refreshAccount();
    });
  } else if ('logout' in ds) {
    accountAction(async () => {
      clearTimeout(pushTimer);
      if (ownLocal()) await account.pushData(load()).catch(() => {});
      await account.logout();
      accountUi.invites = null;
      accountUi.lastInvite = null;
      accountUi.info = 'Déconnecté. Tes séances restent sur ce téléphone.';
    });
  } else if (ds.invite) {
    accountAction(async () => {
      const inv = await account.createInvite(ds.invite);
      accountUi.lastInvite = inv.url;
      accountUi.info = ds.invite === 'recover' ? 'Ouvre ce lien sur ton nouvel appareil.' : 'Lien prêt : envoie-le à ton proche.';
      accountUi.invites = (await account.listInvites()).invites;
    });
  } else if ('share' in ds) {
    const url = accountUi.lastInvite;
    if (navigator.share) navigator.share({ title: 'Foulée', text: 'Rejoins-moi sur Foulée, mon coach de course et de natation :', url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => { accountUi.info = 'Lien copié.'; render(); });
  }
});

// Lien d'invitation : ?invite=CODE ouvre directement la création de compte.
const inviteParam = new URLSearchParams(location.search).get('invite');
if (inviteParam && account.serverEnabled()) {
  history.replaceState(null, '', location.pathname);
  current = 'compte';
  account.inviteInfo(inviteParam)
    .then((info) => { accountUi.invite = { code: inviteParam, kind: info.kind }; accountUi.inviteFrom = info.from; })
    .catch((e) => { accountUi.error = e.message; })
    .finally(() => render());
}
refreshAccount();
syncNow().then(retryIA);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && current !== 'live') retryIA(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
navigator.storage?.persist?.().catch(() => {});
render();
