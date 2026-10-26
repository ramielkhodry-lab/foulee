# Foulée — prototype du guidage (phase 0)

Webapp installable (PWA), gratuite, sans compte pour l'instant. Objectif de cette phase :
prouver que le guidage vocal tient **écran verrouillé sur iPhone**.

## Principe

iOS suspend le JavaScript d'une webapp quand l'écran est verrouillé, mais continue de lire
un fichier audio. Au démarrage d'une séance, l'app grave donc toute la séance (annonces,
bips, silences) dans **un seul MP3**, assemblé sur le téléphone en recopiant des trames
pré-encodées (`public/js/track.js`). Le minutage est dans la piste : rien ne peut dériver.
Pause et « étape suivante » passent par la Media Session API (écran verrouillé, écouteurs).

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
- Pas de GPS écran verrouillé dans une webapp : distance saisie, marquée estimée.
- Mode « Guidage prioritaire » : met la musique en pause. Mode « Avec ma musique » : à tester.
- Rien de tout cela n'est validé tant que les tests en vraie course sur iPhone n'ont pas été faits.
