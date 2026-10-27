# Revue globale — TunL v0.1.0 (2026-10-27)

Revue de toute l'application après la publication de la v0.1.0 : interface, ergonomie, code, défauts, performances.
La sécurité déjà couverte par `docs/08-revue-securite.md` et les défauts figés aux revues de lots
(`e2e/review-lot*.spec.ts`, `src-tauri/src/model/review_*_tests.rs`) n'ont pas été repris.

## Méthode

- Point de départ vert : `npm run verify` (458 tests Vitest, 324 tests Rust, 1 ignoré : `keyring_round_trip`).
- Lecture du backend Rust (SSH, bastions, tunnel, SFTP, transferts, RDP, sondes, WoL, store, commandes) et du front
  (sessions, terminal, barre latérale, SFTP, éditeur, palette, invites, réglages).
- Captures du mock (Playwright, Chromium) : 40 écrans en sombre et en anglais (1280 × 800), une sélection en clair et
  en français, et en 960 × 600. Aucune erreur ni avertissement dans la console.
- **Constaté** : vu sur une capture, ou reproduit dans le mock. **Supposé** : déduit de la lecture du code, avec ce qui
  le fonde ; la fiche le confirme par un test du contrat qui échoue aujourd'hui. **Reproduit (test rouge)** : le
  test du contrat de la fiche a été lancé sur le code du 2026-10-27 et échoue pour cette raison-là. Tous les tests
  e2e et Vitest du lot 7 échouent aujourd'hui (sauf les deux gardes de non-régression) ; les tests Rust attendent
  des API que leur fiche crée, sauf `ssh_upload_race.rs`, qui compile et passe clippy sur le code actuel.

## Constats retenus

| # | Domaine | Constat | État | Fiche |
|---|---|---|---|---|
| 1 | Barre latérale | La liste ne défile pas d'elle-même : tout le panneau défile, le filtre sort de l'écran, le pied reste sous la fenêtre | constaté | T43 |
| 2 | Barre latérale | Ouvrir le premier onglet insère « Récents » en haut : la liste saute de ~200 px | constaté | T43 |
| 3 | Barre latérale | Un groupe replié se rouvre après une recherche | reproduit (test rouge) | T43 |
| 4 | Éditeur | Double-clic sur « Enregistrer » → deux connexions identiques | constaté (mock) | T44 |
| 5 | Éditeur | Focus initial sur « SSH » au lieu du champ Nom ; grands vides entre les champs | constaté | T44 |
| 6 | Éditeur RDP | « Plusieurs écrans » actif hors plein écran, sans effet | constaté | T44 |
| 7 | Sessions | Carte d'erreur sans étape échouée, sans aide, sans « Fermer » | constaté | T45 |
| 8 | Sessions | Question (mot de passe, clé) restée affichée après l'abandon du backend (5 min) | supposé | T45 |
| 9 | RDP | Carte de fin sans « Modifier la connexion » après un refus d'authentification | constaté | T45 |
| 10 | SFTP | La fin d'un envoi ramène l'explorateur au dossier de départ | reproduit (test rouge) | T46 |
| 11 | SFTP | Aucun retour visuel pendant le comptage et la suppression | supposé | T46 |
| 12 | SFTP | Deux envois du même nom en même temps corrompent le fichier (`.part` tronqué) | supposé | T47 |
| 13 | SFTP | Un dossier glissé échoue avec une erreur obscure, après un `.part` vide créé | supposé | T47 |
| 14 | SFTP | Comptage et suppression : un aller-retour réseau par entrée | supposé | T47 |
| 15 | SFTP | Un lien symbolique vers un fichier ne peut pas être téléchargé | supposé | T48 |
| 16 | SSH | Un port qui accepte TCP sans parler SSH bloque l'onglet sans fin | supposé | T49 |
| 17 | Tunnel | Erreur d'`accept` → boucle à 100 % d'un cœur | supposé | T49 |
| 18 | Terminal | Pas de contrôle de flux : gros affichage → fenêtre figée, données jetées au-delà de 50 Mo | supposé, à mesurer | T50 |
| 19 | Terminal | Copie à la sélection : un appel au presse-papiers par mouvement de souris | supposé | T50 |
| 20 | Palette | Titres de groupe affichés vides | constaté | T51 |
| 21 | Palette | `rdp://hôte` → toast « bientôt disponible » dans une version publiée | constaté | T51 |
| 22 | Menus | « Retirer des favoris ✓ » | constaté | T51 |
| 23 | Français | « Connexion relais », « Hôte sauteur » et « bastion » pour la même chose | constaté | T51 |
| 24 | Import | Notes et refus en anglais dans l'interface française ; avertissements du fichier jamais affichés | constaté | T52 |
| 25 | Réglages | Deux changements rapprochés : le second efface le premier | reproduit (test rouge) | T53 |
| 26 | Sondes | Un toast d'erreur à chaque tour quand la sonde échoue | reproduit (test rouge) | T53 |
| 27 | Réglages | Liste « Barre de titre » plus étroite que les autres | constaté | T53 |

## Écartés

- **Transferts SFTP limités par la latence** : faux. russh-sftp 3.0.1 envoie déjà plusieurs lectures et écritures
  à la fois (`max_concurrent_reads`, `max_concurrent_writes`).
- Fermeture d'un onglet SFTP pendant un transfert, `save_store` synchrone sous verrou, double tri des entrées, détection
  de FreeRDP refaite à chaque ouverture, connexion RDP perdue au bastion non signalée : sans effet visible à
  l'échelle de TunL, notés ici pour mémoire.
- Souris en mode X10 (octets > 127) perdue : l'IPC `ssh_write` prend une chaîne ; très rare (les applications
  actuelles utilisent le mode SGR).

## Questions pour Florian

1. **Messages d'erreur techniques en anglais** : le détail des toasts et de la carte d'erreur est le message anglais
   du backend (`docs/06` S7, choix d'origine). T45 ajoute une aide traduite par type d'erreur ; faut-il aller plus
   loin (codes d'erreur traduits partout) ?
2. **Fonctions absentes**, hors de cette revue : sélection multiple et transfert de dossiers en SFTP, réorganisation
   des onglets, connexion rapide RDP sans enregistrer. À planifier dans un lot de fonctions si tu les veux.
