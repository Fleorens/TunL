# Plan de réalisation — TunL v1

43 fiches en 9 jalons. Chaque fiche tient dans **une session opencode** du modèle local.
L'orchestrateur (Claude) écrit les fiches détaillées **par lots** : chaque lot est ajusté après relecture de ce que
le modèle a réellement livré. Une fiche qui cite des signatures de code pas encore écrit finirait par mentir.

## Où on en est (2026-10-20)

- Lots 1 à 5 : **validés** (T01 → T30). Revue du lot 5 le 2026-10-20 : quatre défauts corrigés et figés
  (`e2e/review-lot5.spec.ts`, `src-tauri/src/sftp/transfer_reserve_tests.rs`), voir le commit de revue.
- À partir de T17b, `npm run review` démarre aussi les conteneurs SSH de test (podman, `npm run test:ssh`).
- En attente de Florian, dans la vraie app (`npm run tauri dev`) :
  - T10 et T11 : créer, modifier et supprimer une connexion, avec un bastion (voir « À regarder » des deux fiches) ;
  - T05 : instance unique, taille de fenêtre retenue ;
  - T12 et T15b : un mot de passe dans KWallet, l'import de ton vrai `~/.ssh/config` ;
  - T21 et T21b : **la première vraie session SSH** (sans bastion jusqu'à T22), avec un serveur absent de ton
    `~/.ssh/known_hosts` pour voir le dialogue de clé d'hôte.
  - T22 : une session derrière un vrai bastion (puis deux) ;
  - T25 → T26b : un onglet SFTP sur un de tes serveurs : parcourir, actions, téléchargement (`nom (1).ext`, aucun
    `.part` après annulation), envoi par le sélecteur et par glisser-déposer depuis Dolphin ;
  - T28b (FreeRDP 3 installé) : une session RDP directe, puis via bastion ; T29 : un réveil réel ; T30 : les pastilles
    sur ton réseau.

## Comment Florian fait tourner une fiche

Objectif fixé par Florian (2026-09-26) : **économiser au maximum le quota Claude** et voir jusqu'où va le modèle
local. Claude n'intervient donc qu'**une fois par lot**, pas une fois par fiche.

```bash
cd ~/Documents/GitHub/TunL && opencode      # une session neuve par fiche
/tache T06                                  # le modèle code jusqu'à ce que `npm run review` soit vert
```

`/tache` impose le bon modèle et la méthode qui tient dans le contexte du modèle local : index de la fiche, tests
écrits par `scripts/contract-tests.mjs`, lectures ciblées, reprise après compaction. Un simple message (« Tu
t'occupes de T10 ») fonctionne aussi, puisque les règles sont dans `AGENTS.md`, mais sans ces rappels.

Après chaque fiche :
1. **Contrôle rapide, sans Claude** : `npm run review` (1 à 2 minutes). Il inclut `npm run rules` : règles projet,
   et tests du contrat de toutes les fiches livrées restés intacts. Les e2e échouent aussi sur une erreur console,
   et `expectSaneUi` vérifie la mise en page sans captures (voir `AGENTS.md`).
   - Vert : jeter un œil à l'app (`npm run tauri dev`, section « À regarder » de la fiche), puis fiche suivante.
   - Rouge, ou modèle arrêté sur un blocage : nouvelle session opencode, puis `/repare T06`. Le modèle relance la
     recette et corrige son code sans toucher aux tests.
   - Toujours rouge après `/repare` : prendre le modèle de la colonne **Repli**, ou demander à Claude
     « débloque T06 ».
2. **En fin de lot**, un seul message à Claude : « revue du lot N et écris le lot N+1 ». Claude relit tout le lot
   d'un coup : recette, exceptions `project-rules: allow`, tableau « Where it stands » du `README.md`, captures ciblées.
   Il corrige si besoin, transforme chaque défaut trouvé en contrôle automatique, puis écrit les fiches suivantes.

Noter au fil de l'eau ce qui cloche à l'écran (texte, alignement, couleur) : Claude le traitera à la revue de lot.

## Statuts

`à écrire` (fiche pas encore détaillée) → `prête` → `livrée` (le modèle a fini, `npm run review` vert) → `validée`
(relue par Claude à la revue du lot). Ce que Florian doit voir dans la vraie app est listé dans « Où on en est ».

## Jalons et fiches

### M0 — Fondations

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T01 | Initialiser le dépôt (Vite + React + Tauri 2 + Biome + Vitest) | — | moyen | Sonnet 5 · medium | validée |
| T02 | Design system : shadcn, tokens TunL, polices, thème, galerie | T01 | moyen | Sonnet 5 · medium | validée |
| T03 | i18n (en / fr) : infrastructure, clés typées, test de parité | T02 | faible | Haiku 4.5 · low | validée |
| T04 | Coquille de l'app (TopBar, Sidebar, TabBar, StatusBar, accueil vide), textes via i18n | T03 | moyen | Sonnet 5 · medium | validée |
| T05 | Socle Rust (AppError, chemins, état, logs, ts-rs) + `ipc.ts` et mock | T04 | moyen | Sonnet 5 · high | validée |
| T05b | Tests de recette dans le navigateur (Playwright) + `npm run review` | T05 | faible | Sonnet 5 · low | validée |

### M1 — Connexions

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T06 | Modèle de données Rust + validation + bindings + tests | T05b | moyen | Sonnet 5 · medium | validée |
| T07 | Store JSON atomique, `.bak`, `.corrupt`, migrations, permissions 0600 | T06 | moyen | Sonnet 5 · high | validée |
| T08 | Commandes CRUD connexions / groupes / réglages + ipc + mock | T07 | faible | Sonnet 5 · low | validée |
| T09 | Stores zustand + Sidebar branchée (sections, filtre, menu contextuel) | T08 | moyen | Sonnet 5 · medium | validée |
| T10 | Éditeur de connexion — Général + Authentification | T09 | moyen | Sonnet 5 · medium | validée |
| T11 | Éditeur de connexion — Réseau (bastion, WoL) + Avancé (SSH, RDP) | T10 | moyen | Sonnet 5 · medium | validée |
| T12 | Trousseau (oo7) : `secret_set/has/delete` + secrets dans l'éditeur | T11 | moyen | Opus 5 · high | validée |
| T13 | Palette de commandes + connexion rapide + aide des raccourcis (F1) | T15b | moyen | Sonnet 5 · medium | validée |
| T14 | Accueil : cartes favoris / récents, premier lancement | T13 | faible | Sonnet 5 · low | validée |
| T15 | Import `~/.ssh/config` : parseur, aperçu, application (backend + mock) | T12 | moyen | Sonnet 5 · medium | validée |
| T15b | Import `~/.ssh/config` : dialogue (tableau, sélection, groupe) | T15 | faible | Sonnet 5 · medium | validée |

### M2 — SSH

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T16 | Environnement de test podman (cible, bastion, hôte caché, clés de test) | T05b | moyen | Sonnet 5 · medium | validée |
| T17 | Prompts et `known_hosts` : `PromptBroker`, fichier des clés d'hôte, erreurs SSH (Rust) | T12 | moyen | Opus 5 · high | validée |
| T17b | Poignée de main SSH : TCP, confiance dans la clé d'hôte, tests contre podman | T17, T16 | **élevé** | Opus 5 · high | validée |
| T18 | Authentification : mot de passe, clé + passphrase, agent, keyboard-interactive | T17b | **élevé** | Opus 5 · high | validée |
| T19 | Session shell : PTY, flux d'octets, registre de sessions, `ssh_open` / `write` / `resize` / `close`, mock | T18 | **élevé** | Opus 5 · high | validée |
| T19b | Clés d'hôte : `known_hosts` lu comme OpenSSH (haché, jokers, `@revoked`), type de clé changé = refus | T19 | moyen | Opus 5 · high | validée |
| T20 | Composant terminal xterm.js 6 (thèmes, ajustement, recherche, liens, copier / coller, zoom) | T19 | moyen | Sonnet 5 · medium | validée |
| T21 | Onglets de session : terminal branché, étapes, erreur, fin, reconnexion, StatusBar | T20, T19b | moyen | Sonnet 5 · medium | validée |
| T21b | Prompts (clé d'hôte, mot de passe, passphrase, 2FA) et clé d'hôte changée | T21 | moyen | Sonnet 5 · medium | validée |

### M3 — Bastion

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T22 | Chaîne de bastions : résolution, cycles, direct-tcpip + connect_stream, étapes | T21b | **élevé** | Opus 5 · high | validée |
| T23 | Lien SSH réutilisable (`establish`) + tunnel local 127.0.0.1:port → cible via la chaîne (moteur pour le RDP) | T22, T29 | **élevé** | Opus 5 · high | validée |

### M4 — SFTP

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T24 | Backend SFTP : session, list, mkdir, rename, remove, chmod (+ ipc et mock) | T23 | moyen | Sonnet 5 · high | validée |
| T25 | Onglet SFTP : explorateur (fil d'Ariane, tableau virtualisé, tri, fichiers cachés) | T24 | moyen | Sonnet 5 · medium | validée |
| T25b | Explorateur SFTP : nouveau dossier, renommer, supprimer (avec le compte), droits, copier le chemin | T25 | moyen | Sonnet 5 · medium | validée |
| T26 | Transferts : moteur Rust (téléchargement, envoi), annulation, commandes, ipc et mock | T25b | **élevé** | Opus 5 · high | validée |
| T26c | Transferts : modèle et store (frontend) | T26 | moyen | Sonnet 5 · medium | validée |
| T26d | Transferts : panneau, téléchargement depuis l'explorateur (double-clic, menu) | T26c | moyen | Sonnet 5 · medium | validée |
| T26b | Envoi de fichiers : sélecteur natif et glisser-déposer depuis le bureau | T26d, T28b | moyen | Sonnet 5 · medium | validée |

### M5 — RDP

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T27 | Détection FreeRDP + constructeur d'arguments pur + tests exhaustifs | T08 | moyen | Sonnet 5 · medium | validée |
| T28 | RDP : lancement par `/args-from:stdin`, suivi, journal filtré, tunnel via bastion (+ ipc et mock) | T23, T27 | **élevé** | Opus 5 · high | validée |
| T28b | Onglet RDP : carte de session, journal, fin traduite, client introuvable | T28, T26d | moyen | Sonnet 5 · medium | validée |
| T28c | RDP via bastion : port de tunnel stable et `/server-name`, pour que FreeRDP vérifie le certificat | T28b | moyen | Sonnet 5 · medium | prête |

### M6 — Wake-on-LAN et disponibilité

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T29 | WoL : paquet magique, bouton, réveil avant connexion + attente du port | T22 | faible | Sonnet 5 · low | validée |
| T30 | Sondes de disponibilité (TCP, pastilles, latence) | T09 | moyen | Sonnet 5 · medium | validée |
| T30b | Corrections de la vraie app : une sonde par adresse, sessions fermées au rechargement, focus après un dialogue, opener 2.7 | T30 | moyen | Sonnet 5 · medium | prête |

### M7 — Finitions

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T31 | Onglet Paramètres : apparence, terminal, disponibilité, à propos | T30b | moyen | Sonnet 5 · medium | prête |
| T31b | Paramètres : SSH (valeurs par défaut, serveurs connus), SFTP (dossier de téléchargement), RDP (client) | T31 | moyen | Sonnet 5 · medium | prête |
| T32 | Export / import JSON des connexions (sans secrets), section « Sauvegarde » des Paramètres | T31b | faible | Sonnet 5 · medium | prête |
| T33 | Animations : tunnel de connexion, coche tracée, « Réduire les animations » aussi pour le CSS | T32 | moyen | Sonnet 5 · medium | prête |
| T34 | Accessibilité et clavier : `IconButton` partout, flèches dans la sidebar et les onglets, aide F1 | T33 | moyen | Sonnet 5 · medium | prête |
| T35 | *(optionnelle)* Barre de titre personnalisée avec repli natif | T34 | **élevé** | Opus 5 · high | à écrire |

### M8 — Distribution

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T36 | Icône d'app (SVG fourni dans `branding/`), paquet `tunl`, `.desktop`, metainfo AppStream, captures | T34 | faible | Sonnet 5 · low | prête |
| T37 | Paquets deb / rpm / AppImage + CI GitHub Actions (recette, audits, publication brouillon) | T36 | moyen | Sonnet 5 · high | prête |
| T38 | Flatpak (manifeste, FreeRDP embarqué, sources hors ligne) → Flathub | T37 | **élevé** | Opus 5 · high | prête |
| T39 | README public, CONTRIBUTING, LICENSE, CHANGELOG | T37 | faible | Haiku 4.5 · low | prête |
| T40 | Revue sécurité finale + liste de publication (**faite par Claude**) | T38, T39 | — | Opus 5 · xhigh | prête |

## Chemin critique

```
T01 → … → T12 ─┬─ T17 → … → T21b → T22 → T29 → T23 ─┬─ T24 → T25 → T25b → T26 → T26b
T05b → T16 ─────┤                                     └─ T28 (avec T27) → T28b
                └─ T15 → T15b → T13 → T14        (validé jusqu’à T30)
T27, T32 : parallélisables après T08 · T30 : après T09
```

## Lots d'écriture des fiches

À partir du lot 2, les fiches sont au format **contrat** (types, comportement, pièges, tests) : c'est le modèle
local qui écrit le code (voir `AGENTS.md`).

| Lot | Fiches | Écrit quand |
|---|---|---|
| 1 | T01 → T05b | **validé** (T05b déjà au format contrat) |
| 2 | T06 → T11 | **validé** à la revue du 2026-09-27 (format contrat) |
| 3 | T12, T15, T15b, T13, T14, T16 | **validé** à la revue du 2026-09-28 |
| 4 | T17 → T21b | **validé** à la revue du 2026-10-18 (T19b ajoutée le 2026-10-11 après une revue de T17 → T19) |
| 5 | T22 → T30 (+ T25b, T26b, T26c, T26d, T28b) | **validé** à la revue du 2026-10-20 |
| 6 | T31 → T40 | fin du lot 5 |
