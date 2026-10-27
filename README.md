# Foulée — prototype du guidage (phase 0)

Webapp installable (PWA), gratuite, sans compte pour l'instant. Objectif de cette phase :
prouver que le guidage vocal tient **écran verrouillé sur iPhone**.

## Principe

iOS suspend le JavaScript d'une webapp quand l'écran est verrouillé, mais continue de lire
un fichier audio. Au démarrage d'une séance, l'app grave donc toute la séance (annonces,
bips, silences) dans **un seul MP3**, assemblé sur le téléphone en recopiant des trames
pré-encodées (`public/js/track.js`). Le minutage est dans la piste : rien ne peut dériver.
Pause et « étape suivante » passent par la Media Session API (écran verrouillé, écouteurs).
Par défaut, pas de voix : notes montantes = course, descendantes = marche, 3 bips avant
chaque changement, et l'écran clignote. La voix est une option dans Profil.

## Arborescence

- `public/` : l'app telle qu'elle est servie (aucune étape de build).
- `public/audio/` : clips vocaux générés (`pack.mp3` + `index.json`).
- `tools/gen_audio.py` : génère les clips avec la voix libre Piper `fr-siwis-medium` (CC-BY 4.0).
- `test/` : tests du minutage et de l'assemblage (`npm test`), parcours navigateur (`test/e2e/smoke.mjs`).

## Commandes

```sh
npm test                                   # minutage, assemblage, décodage ffmpeg
NODE_PATH=$(npm root -g) node test/e2e/smoke.mjs   # parcours complet dans Chromium
python3 tools/gen_audio.py <dossier-voix>  # régénère les clips après une modif de public/js/phrases.js
```

## Limites connues

- Données sur le téléphone uniquement (localStorage). Comptes et serveur : phase 1.
- GPS mesuré tant que l'écran reste allumé (l'app empêche la mise en veille et propose un verrou
  tactile pour la poche). Écran verrouillé : la voix continue, le GPS s'arrête, la distance est
  marquée incomplète.
- Son « Avec ma musique » (défaut, audioSession ambient) : se mélange à la musique, écran allumé
  requis. « Sans musique » (playback) : tient l'écran verrouillé, coupe la musique. Pas de vibration :
  Safari sur iPhone ne l'expose pas.
- Rien de tout cela n'est validé tant que les tests en vraie course sur iPhone n'ont pas été faits.
