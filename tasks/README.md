# Plan de réalisation — TunL v1

40 fiches en 9 jalons. Chaque fiche tient dans **une session opencode** du modèle local.
L'orchestrateur (Claude) écrit les fiches détaillées **par lots** : chaque lot est ajusté après relecture de ce que
le modèle a réellement livré. Une fiche qui cite des signatures de code pas encore écrit finirait par mentir.

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
1. **Contrôle rapide, sans Claude** : `npm run review` (1 à 2 minutes), puis `node scripts/contract-tests.mjs T06 --check`
   (les tests du contrat n'ont pas été retouchés).
   - Vert : jeter un œil à l'app (`npm run tauri dev`, section « À regarder » de la fiche), puis fiche suivante.
   - Rouge, ou modèle arrêté sur un blocage : nouvelle session opencode, puis `/repare T06`. Le modèle relance la
     recette et corrige son code sans toucher aux tests.
   - Toujours rouge après `/repare` : prendre le modèle de la colonne **Repli**, ou demander à Claude
     « débloque T06 ».
2. **En fin de lot**, un seul message à Claude : « revue du lot 2 et écris le lot 3 ». Claude relit tout le lot d'un
   coup (tests, diff, captures), corrige si besoin, puis écrit les fiches suivantes. Une seule relecture pour tout le
   lot.

Noter au fil de l'eau ce qui cloche à l'écran (texte, alignement, couleur) : Claude le traitera à la revue de lot.

## Statuts

`à écrire` (fiche pas encore détaillée) → `prête` → `livrée` (le modèle a fini, `verify` vert) → `validée`
(relue par Claude, vue par Florian).

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
| T06 | Modèle de données Rust + validation + bindings + tests | T05b | moyen | Sonnet 5 · medium | livrée |
| T07 | Store JSON atomique, `.bak`, `.corrupt`, migrations, permissions 0600 | T06 | moyen | Sonnet 5 · high | livrée |
| T08 | Commandes CRUD connexions / groupes / réglages + ipc + mock | T07 | faible | Sonnet 5 · low | livrée |
| T09 | Stores zustand + Sidebar branchée (sections, filtre, menu contextuel) | T08 | moyen | Sonnet 5 · medium | livrée |
| T10 | Éditeur de connexion — Général + Authentification | T09 | moyen | Sonnet 5 · medium | livrée |
| T11 | Éditeur de connexion — Réseau (bastion, WoL) + Avancé (SSH, RDP) | T10 | moyen | Sonnet 5 · medium | livrée |
| T12 | Trousseau (oo7) : `secret_set/has/delete` + UI « Mémoriser » | T10 | moyen | Opus 5 · high | à écrire |
| T13 | Palette de commandes + connexion rapide + table des raccourcis | T09 | moyen | Sonnet 5 · medium | à écrire |
| T14 | Accueil : cartes favoris / récents, premier lancement | T09 | faible | Sonnet 5 · low | à écrire |
| T15 | Import `~/.ssh/config` (aperçu, sélection, ProxyJump) | T08 | moyen | Sonnet 5 · medium | à écrire |

### M2 — SSH

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T16 | Environnement de test podman (cible + bastion, clés de test) | T05 | moyen | Sonnet 5 · medium | à écrire |
| T17 | Noyau SSH : connexion TCP, handler, known_hosts, PromptBroker, dialogue clé d'hôte | T12, T16 | **élevé** | Opus 5 · high | à écrire |
| T18 | Authentification : mot de passe, clé + passphrase, agent, keyboard-interactive | T17 | **élevé** | Opus 5 · high | à écrire |
| T19 | Session shell : PTY, Channel binaire, registre de sessions, write / resize / close | T18 | **élevé** | Opus 5 · high | à écrire |
| T20 | Composant terminal xterm.js 6 (webgl, fit, recherche, liens, thèmes, copier / coller, zoom) | T19 | moyen | Sonnet 5 · medium | à écrire |
| T21 | Onglets de session : overlay « tunnel », erreurs, reconnexion, StatusBar | T20 | moyen | Sonnet 5 · medium | à écrire |

### M3 — Bastion

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T22 | Chaîne de bastions : résolution, cycles, direct-tcpip + connect_stream, étapes | T21 | **élevé** | Opus 5 · high | à écrire |
| T23 | Tunnel local 127.0.0.1:port → cible via la chaîne (moteur pour le RDP) | T22 | **élevé** | Opus 5 · high | à écrire |

### M4 — SFTP

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T24 | Backend SFTP : ouverture, list, mkdir, rename, remove, chmod | T22 | moyen | Sonnet 5 · high | à écrire |
| T25 | Explorateur SFTP : fil d'Ariane, tableau virtualisé, tri, menu contextuel | T24 | moyen | Sonnet 5 · medium | à écrire |
| T26 | Transferts : upload / download en flux, progression, annulation, glisser-déposer | T25 | **élevé** | Opus 5 · high | à écrire |

### M5 — RDP

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T27 | Détection FreeRDP + constructeur d'arguments pur + tests exhaustifs | T08 | moyen | Sonnet 5 · medium | à écrire |
| T28 | Lancement via `/args-from:stdin`, suivi, journal filtré, via bastion, carte RDP | T23, T27 | **élevé** | Opus 5 · high | à écrire |

### M6 — Wake-on-LAN et disponibilité

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T29 | WoL : paquet magique, bouton, réveil avant connexion + attente du port | T22 | faible | Sonnet 5 · low | à écrire |
| T30 | Sondes de disponibilité (TCP, pastilles, latence) | T09 | moyen | Sonnet 5 · medium | à écrire |

### M7 — Finitions

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T31 | Onglet Paramètres complet (apparence, terminal, SSH, RDP, disponibilité, à propos) | T20, T27 | moyen | Sonnet 5 · medium | à écrire |
| T32 | Export / import JSON des connexions (sans secrets) | T08 | faible | Sonnet 5 · low | à écrire |
| T33 | Passe animations et micro-interactions + réduction des animations | T31 | moyen | Sonnet 5 · medium | à écrire |
| T34 | Accessibilité et navigation clavier (listes, focus, aria, aide F1) | T33 | moyen | Sonnet 5 · medium | à écrire |
| T35 | *(optionnelle)* Barre de titre personnalisée avec repli natif | T34 | **élevé** | Opus 5 · high | à écrire |

### M8 — Distribution

| Fiche | Titre | Dépend de | Risque | Repli | Statut |
|---|---|---|---|---|---|
| T36 | Icône d'app (SVG fourni par Claude), `.desktop`, metainfo AppStream, captures | T34 | faible | Haiku 4.5 · low | à écrire |
| T37 | Paquets deb / rpm / AppImage + CI GitHub Actions (lint, tests, audit, release) | T36 | moyen | Sonnet 5 · high | à écrire |
| T38 | Flatpak (manifeste, FreeRDP embarqué, sources hors ligne) → Flathub | T37 | **élevé** | Opus 5 · high | à écrire |
| T39 | README public, CONTRIBUTING, LICENSE, CHANGELOG | T37 | faible | Haiku 4.5 · low | à écrire |
| T40 | Revue sécurité finale + checklist de release (**faite par Claude**) | T38, T39 | — | Opus 5 · xhigh | à écrire |

## Chemin critique

```
T01 → T02 → T03 → T04 → T05 → T05b → T06 → T07 → T08 ─┬─ T09 → T10 → T12 → T17 → T18 → T19 → T20 → T21 → T22 ─┬─ T24 → T25 → T26
                                               │                    ↑                                  ├─ T23 → T28
                                               │              T16 ──┘                                  └─ T29
                                               ├─ T15, T27, T32 (parallélisables après T08)
                                               └─ T11, T13, T14, T30 (après T09)
```

## Lots d'écriture des fiches

À partir du lot 2, les fiches sont au format **contrat** (types, comportement, pièges, tests) : c'est le modèle
local qui écrit le code (voir `AGENTS.md`).

| Lot | Fiches | Écrit quand |
|---|---|---|
| 1 | T01 → T05b | écrit (T05b déjà au format contrat) |
| 2 | T06 → T11 | écrit (format contrat), après la revue du lot 1 |
| 3 | T12 → T16 | à la demande « revue du lot 2 et écris le lot 3 », une fois T11 verte |
| 4 | T17 → T21 | fin du lot 3 (Claude aura éprouvé russh contre les conteneurs de T16) |
| 5 | T22 → T30 | fin du lot 4 |
| 6 | T31 → T40 | fin du lot 5 |
