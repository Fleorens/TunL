# T40a — Revue de sécurité, première passe sur le code (modèle local)

| | |
|---|---|
| **Jalon** | M8 — Distribution |
| **Dépend de** | T38, T39 |
| **Lire avant** | `docs/06-securite.md` en entier ; `tasks/T40-revue-securite-release.md` §1 et §4 seulement |
| **Livrable** | `docs/08-revue-securite.md`, section « Passe 1 — lecture du code » : les constats, rien d'autre |

## Ce que cette fiche n'est pas

- **Pas une fiche contrat** : elle n'a aucun test. Ne lance pas `node scripts/contract-tests.mjs T40a` : il
  répondrait « no test file found », et c'est normal.
- **Tu ne corriges rien.** Aucun fichier de code, de test, de configuration ou de CI ne change : tu écris seulement
  le compte rendu. L'orchestrateur relit tes constats, les trie, puis corrige.
- Pas de build de release, pas de Flatpak, pas de `sudo`, pas de `tcpdump`, pas de tag, pas de push. La CSP du
  binaire (T40 §2), le Flatpak (§3) et la publication (§5) sont faits après toi, par l'orchestrateur et Florian.

## Méthode (ton contexte est limité)

- Travaille **surface par surface**, dans l'ordre ci-dessous. **Après chaque surface, ajoute tout de suite ses
  constats au compte rendu** : après une compaction, `docs/08-revue-securite.md` te dit où tu en es.
- Lis par `grep -n` et par plages de lignes. Ne lis pas un fichier entier « au cas où ».
- Un constat n'est retenu que s'il a un **scénario concret** : qui fournit quelle donnée, quel chemin elle suit dans
  le code (`fichier:ligne`), et ce qui arrive. « Pourrait être plus robuste » ne compte pas.
- Pour chaque règle, la commande lancée et ce qu'elle a montré : « vu » ne suffit pas.

## 1. Les règles S1 à S16

Reprends le tableau de `tasks/T40-revue-securite-release.md` §1. Fais ce qui se vérifie **dans le dépôt** :
lecture du code, `grep`, tests existants (`cd src-tauri && cargo test <filtre>`, `npx vitest run <dossier>`),
`npm run rules`, `npm audit --omit=dev`, relecture de `src-tauri/.cargo/audit.toml`. Une vérification qui demande
la vraie app, une session réelle ou des droits root est notée « à faire à la main » avec la commande prévue.

## 2. Les surfaces d'attaque

Pour chacune : d'où viennent les données, sont-elles validées **côté Rust** (le frontend ne compte pas), que se
passe-t-il avec une valeur hostile ?

1. Les commandes Tauri (`src-tauri/src/commands/*.rs`, `src-tauri/src/window_chrome.rs`) : chaque argument
   reçu du frontend, surtout les chemins et les chaînes passées à un processus ou à un fichier.
2. Les fichiers que TunL lit sans les avoir écrits : `~/.ssh/config` (import T15), un export JSON (import T32),
   `known_hosts`, `settings.json` modifié à la main.
3. Ce qui part vers un processus : FreeRDP (`src-tauri/src/rdp/`), y compris derrière un bastion (T28c).
4. Ce qui vient d'un serveur : noms de fichiers SFTP, sortie du terminal, invites keyboard-interactive, clés d'hôte.
5. Le réseau local : sondes (T30), Wake-on-LAN (T29), tunnel local (`ssh/forward.rs`).
6. La chaîne de publication : `.github/workflows/*.yml`, `packaging/flatpak/*.yml` (`finish-args`).

## 3. Les menaces de `docs/06-securite.md` §1

Pour chaque ligne du tableau : la protection en place (`fichier:ligne`) et le test qui la garde. Une menace sans
test est un constat.

## Format du compte rendu

Crée `docs/08-revue-securite.md` avec un titre `# Revue de sécurité — TunL v0.1.0`, puis la section
`## Passe 1 — lecture du code (modèle local)` :

1. Un tableau des constats, du plus grave au moins grave : `| # | Gravité | Règle | Où | Scénario | Correctif proposé |`.
   Gravité : **bloquant** (secret exposé, exécution de code, contournement d'une vérification de clé ou de
   certificat), **à corriger**, **mineur**.
2. `### S1` … `### S16` : la commande, son résultat, le verdict (conforme, constat n°, à faire à la main).
3. `### Menaces` : une ligne par menace, protection et test.
4. `### À faire à la main` : la liste des vérifications que tu n'as pas pu faire, avec leur commande.

## Fin

`npm run format`, puis `npm run check` (le compte rendu seul a changé). Dans `tasks/README.md`, passe T40a à
`livrée`. Commit : `docs: security review, first pass on the code (T40a)`.

## Critères d'acceptation

- [ ] `docs/08-revue-securite.md` contient les quatre parties du format, une sous-section par règle S1 → S16.
- [ ] Chaque constat donne `fichier:ligne` et un scénario concret.
- [ ] `git diff --stat` du commit ne touche que `docs/08-revue-securite.md` et `tasks/README.md`.
