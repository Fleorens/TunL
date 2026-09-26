# 02 — Décisions d'architecture

Chaque décision est **actée**. L'agent de code ne la remet pas en cause.
S'il pense qu'une décision bloque, il le signale dans son compte rendu, sans la contourner.

---

## D01 — Tauri 2 + Rust + interface web

**Décision.** Tauri 2 (WebKitGTK 4.1) avec un backend Rust et une interface React.

**Pourquoi.**
- Liberté de design totale : l'app a la même allure sous KDE, GNOME et le reste.
- Le Rust gère le réseau et les secrets avec des bibliothèques mûres (russh, oo7).
- Paquet léger (pas de Chromium embarqué, contrairement à Electron).
- Le Web + TypeScript est le terrain où un modèle de code local est le plus fiable.

**Écartés.**
- GTK4 / libadwaita (look GNOME sous Plasma, et gtk-rs est difficile pour un petit modèle).
- Qt6 / QML + Kirigami (QML mal maîtrisé par les modèles, terminal difficile à intégrer).
- Electron (lourd).
- Python (rejeté par Florian).

**Conséquence.** WebKitGTK n'est pas Chromium. On teste l'UI dans la vraie fenêtre Tauri, pas seulement dans Firefox.
Sur certains GPU NVIDIA, WebKitGTK affiche une fenêtre blanche : la variable `WEBKIT_DISABLE_DMABUF_RENDERER=1`
est documentée dans le README (T39).

## D02 — React 19 + shadcn/ui (style `radix-nova`, primitives Radix)

**Pourquoi.** C'est l'écosystème le plus représenté dans l'entraînement des modèles. shadcn fournit des composants
accessibles et beaux, copiés dans le dépôt, donc modifiables. Radix plutôt que Base UI : les modèles écrivent
`asChild` par réflexe, ce qui casse avec Base UI.

**Écartés.** Svelte 5 (confusion runes / Svelte 4 chez les modèles), SolidJS (peu de données d'entraînement).

## D03 — SSH natif avec russh, sans le binaire `ssh`

**Pourquoi.**
- Contrôle complet : étapes visibles, prompts dans l'UI, mot de passe injecté depuis le trousseau.
- SFTP sur la même pile.
- Le rebond se fait par `direct-tcpip`.
- Pas besoin de `flatpak-spawn --host` en Flatpak.

**Contrepartie assumée.** Pas de `ProxyCommand`, pas de `ControlMaster`, pas de GSSAPI/Kerberos, pas de clés FIDO (`sk-*`)
en v1. L'import de `~/.ssh/config` signale ces options comme ignorées au lieu de les taire.

## D04 — RDP : FreeRDP 3 dans sa propre fenêtre en v1

**Pourquoi.** Afficher le bureau distant *dans* l'app suppose d'intégrer FreeRDP (C) ou IronRDP (Rust), de décoder
et d'afficher un flux vidéo, et de gérer clavier, souris et presse-papiers. C'est le chantier le plus risqué du projet,
et hors de portée d'un modèle local.

**v1.** TunL pilote `sdl-freerdp` : identifiants via `/args-from:stdin`, options depuis la fiche de connexion,
tunnel via bastion, suivi du processus.
Le client SDL affiche lui-même ses dialogues (certificat, erreurs), ce qui convient.

**v2 envisagée.** IronRDP 0.17 intégré, affiché dans un `<canvas>`.

## D05 — Trousseau via `oo7`

**Pourquoi.** oo7 parle Secret Service hors sandbox. En Flatpak, il bascule sur le portail Secret, sans rien exposer
aux autres apps. Chez Florian, `org.freedesktop.secrets` est servi par `ksecretd` (KWallet), vérifié.
API asynchrone, cohérente avec tokio.

**Règle.** Le frontend peut **écrire**, **tester la présence** et **supprimer** un secret, jamais le **lire**.

## D06 — Fichiers JSON plutôt que SQLite

**Pourquoi.** Quelques centaines de connexions au plus. JSON lisible, sauvegardable, versionnable par l'utilisateur,
facile à exporter. Écriture atomique + `.bak`.

**Revoir si** on ajoute un historique de sessions ou des journaux consultables (v2).

## D07 — Types partagés via `ts-rs`, pas `tauri-specta`

**Pourquoi.** ts-rs 12 est stable. tauri-specta est en `2.0.0-rc.25` et ses API changent d'une RC à l'autre.
Les wrappers d'`invoke` sont écrits à la main dans `lib/ipc.ts`, typés par les bindings générés.

**Réglage obligatoire** (`src-tauri/.cargo/config.toml`) :
- `TS_RS_EXPORT_DIR = ../src/bindings` ;
- `TS_RS_LARGE_INT = "number"`, sinon les `i64` deviennent des `bigint`, que JSON ne produit pas.

## D08 — Biome pour le lint et le format du frontend

**Pourquoi.** Un seul outil rapide, une seule config. Le modèle Vite propose `oxlint`, qu'on retire.
`oxfmt` est encore en 0.x.

## D09 — TypeScript 6, pas 7

**Pourquoi.** TypeScript 7 (compilateur natif) est sorti, mais le modèle officiel Vite 8 fixe encore `~6.0`,
et une partie de l'outillage dépend de l'API JS de TS 6.

**À revoir** quand `create-vite` passera à 7.

## D10 — `known_hosts` propre à TunL + lecture de `~/.ssh/known_hosts`

**Pourquoi.** On ne modifie pas les fichiers OpenSSH de l'utilisateur. On lit `~/.ssh/known_hosts` pour ne pas
redemander une confiance déjà accordée. Toute nouvelle confiance est écrite dans le fichier de TunL.

## D11 — Une connexion SSH par onglet

**Pourquoi.** Simplicité, isolation des pannes. La mutualisation (un seul lien pour shell + SFTP) viendra en v2 si besoin.

## D12 — Raccourcis compatibles avec le shell

**Pourquoi.** `Ctrl+W`, `Ctrl+K`, `Ctrl+R`… appartiennent au shell distant. Les raccourcis de l'app utilisent
`Ctrl+Shift+…`, `Ctrl+PageUp/PageDown`, `Alt+1..9` et `Ctrl+,`. Table complète dans `03-design.md` §8.

## D13 — Décorations de fenêtre natives en v1

**Pourquoi.** Une barre de titre personnalisée sous Linux oblige à réimplémenter le déplacement, le redimensionnement
par les bords, les menus et le double-clic, avec des écarts entre KDE et GNOME sous Wayland.
La v1 garde la barre native et soigne la barre d'outils interne. Une barre personnalisée est une option (T35),
avec retour automatique aux décorations natives.

## D14 — Identifiant et nom

- Identifiant d'app (Tauri, Flatpak, D-Bus) : `io.github.fleorens.TunL`.
- Nom affiché : **TunL**. Binaire et paquet : `tunl`.

## D15 — Licence

**À confirmer par Florian.** Proposition : **GPL-3.0-or-later**, l'usage des apps de bureau Linux, compatible avec
Flathub et avec les dépendances (MIT / Apache-2.0).
En attendant, les manifestes portent `GPL-3.0-or-later` et le fichier `LICENSE` est ajouté en T39.
