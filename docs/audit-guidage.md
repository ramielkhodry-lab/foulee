# Audit du guidage sur iPhone — 27 octobre 2026

Cas d'usage : webapp installée sur l'écran d'accueil, écran allumé, musique en fond.

## Corrigé

| Risque | Effet sur la séance | Correction |
| --- | --- | --- |
| Mise à jour des sons alors que l'ancien cache est encore actif | La séance ne démarre pas (clip manquant), sans message | Sons chargés avec une URL versionnée, erreur affichée si la préparation échoue |
| iOS ferme l'app pendant la séance (mémoire, fausse manip) | Séance perdue | Position sauvegardée toutes les 5 s, « Reprendre » proposé à la réouverture |
| Appel, Siri ou autre app coupe le son | Plus aucun signal, sans qu'on le voie | Bandeau rouge « Séance interrompue » sur l'écran |
| Wake Lock absent ou inopérant | L'écran se verrouille : GPS coupé, son coupé en mode musique | Repli : vidéo muette en boucle qui empêche la veille |
| Commandes des écouteurs captées par Foulée en mode musique | Les AirPods mettent Foulée en pause au lieu de la musique | Commandes de l'écran verrouillé activées seulement en mode « Sans musique » |
| Séance après minuit enregistrée à la date UTC | La séance du jour reste affichée comme à faire | Date locale |
| Signaux trop faibles sous la musique | Changement d'étape raté | Signaux plus forts (≈ −1 dB contre −6 dB) |

## Reste à vérifier sur ton iPhone

1. **Mode silencieux** : en mode musique, le son suit le bouton silencieux. iPhone en silencieux = aucun signal. Un rappel s'affiche sur l'écran de séance.
2. **Mélange avec la musique** : l'API qui permet de ne pas couper Spotify (`navigator.audioSession`) est récente et peu documentée dans une webapp installée.
3. **Anti-veille** : vérifier que l'écran ne s'éteint pas après le délai de verrouillage auto.
4. **GPS** : précision réelle et autorisation redemandée ou non à chaque ouverture.
5. **Batterie** : écran + GPS + son pendant 40 min.

## Limites qui ne se corrigent pas en webapp

- Pas de vibration (Safari ne l'expose pas).
- Écran verrouillé : GPS coupé ; en mode musique, son coupé aussi.
