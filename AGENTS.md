# TunL — règles pour l'agent de code

Tu écris le code de **TunL** : un gestionnaire de connexions SSH / SFTP / RDP pour Linux, en Tauri 2 + Rust + React.
Un orchestrateur a écrit l'architecture (`docs/`) et découpé le travail en fiches (`tasks/Txx-*.md`).
**Tu exécutes UNE fiche par session, rien de plus.**

## Déroulé obligatoire d'une session

1. Lis la fiche **en entier**, puis les documents qu'elle cite. Rien d'autre sans raison.
2. Vérifie le point de départ :
   - `git status` doit être propre ;
   - les fiches listées dans « Dépend de » sont marquées `livrée` dans `tasks/README.md`.
   Sinon, ARRÊTE et dis-le.
3. Exécute les étapes **dans l'ordre**. N'ajoute aucune fonctionnalité, dépendance, fichier ou refactorisation
   non demandés.
4. Écris les fichiers par morceaux raisonnables : **jamais plus d'environ 300 lignes par écriture**.
   Au-delà, crée le fichier puis complète-le par éditions successives.
5. Termine par `npm run format`, puis `npm run verify`. Tout doit être vert.
6. Dans la fiche, coche les critères d'acceptation vérifiés (`- [x]`). Dans `tasks/README.md`, passe le statut
   de la fiche à `livrée`.
   ⚠ Tu n'as **pas d'accès visuel**. Un critère qui se juge à l'écran (couleur, animation, disposition, texte
   affiché dans la fenêtre) reste **décoché**, sans en modifier le libellé. Tu le signales dans ton compte rendu,
   et l'orchestrateur le vérifie par captures d'écran.
7. Commit : `git add -A && git commit -m "<type>: <résumé en anglais> (Txx)"`,
   avec `<type>` ∈ `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.
8. Réponds par un **compte rendu** :
   - fichiers créés ou modifiés ;
   - commandes lancées et leur résultat ;
   - écarts avec la fiche, et pourquoi ;
   - ce que Florian doit regarder à l'écran ;
   - questions.

## Quand ça bloque

- **3 tentatives ratées sur la même erreur → STOP.** Décris le blocage avec le message d'erreur exact et ce que tu
  as essayé.
- Contournements **interdits** pour « faire passer » :
  - `any`, `as unknown as`, `// @ts-ignore`, `// biome-ignore` ;
  - `#[allow(...)]`, `unwrap()` ou `expect()` pour faire taire une erreur ;
  - supprimer ou affaiblir un test ;
  - baisser une version, ajouter une dépendance.
- Si la fiche contredit le code existant ou un document : signale-le. Ne modifie ni la fiche ni les documents
  (sauf les cases à cocher et le statut).
- Jamais de `sudo`. S'il manque un paquet système, arrête-toi et donne la commande à lancer à Florian.

## Stack figée (versions vérifiées le 2026-09-26, détail dans `docs/01-architecture.md` §2)

Tauri 2.11 · React 19 · TypeScript 6 · Vite 8 · Tailwind CSS 4 · shadcn CLI 4 (style `radix-nova`) · zustand 5 ·
motion 13 · xterm.js 6 · zod 4 · react-hook-form 7 · i18next 26 · Biome 2 · Vitest 5 ·
Rust édition 2024 · tokio · russh 0.63 · russh-sftp 3 · oo7 0.6 · ts-rs 12 · thiserror 2.

## Pièges connus : tes réflexes datent peut-être d'une ancienne version

| Sujet | ✅ Correct ici | ❌ Obsolète, ne pas écrire |
|---|---|---|
| Tauri JS | `import { invoke, Channel, isTauri } from "@tauri-apps/api/core"` | `@tauri-apps/api/tauri` |
| Tauri permissions | `src-tauri/capabilities/default.json` | `allowlist` dans `tauri.conf.json` |
| Tauri Rust | `use tauri::Manager;` + `app.path().app_config_dir()` | `tauri::api::path::*` |
| Tailwind | tout dans `src/index.css` : `@import "tailwindcss";`, `@theme`, `@utility` | `tailwind.config.js`, `@tailwind base;` |
| shadcn | `CI=1 npx shadcn add <nom> -y </dev/null` (version locale, installée en T02) | écrire un composant `ui/` à la main |
| `cn()` | `import { cn } from "@/lib/utils"` (réexporte le paquet `cn`) | installer `clsx` ou `tailwind-merge` |
| Radix | paquet unique `radix-ui` | `@radix-ui/react-*` |
| React 19 | `ref` est une prop normale | `forwardRef`, `React.FC`, `defaultProps` |
| TypeScript 6 | alias `@/` via `paths` seul | `baseUrl` (erreur TS5101) |
| Zod 4 | `z.email()`, `z.ipv4()`, `{ error: "..." }` | `z.string().email()`, `{ message: "..." }` |
| motion | `import { motion, AnimatePresence } from "motion/react"` | `framer-motion` |
| xterm.js | `@xterm/xterm`, `@xterm/addon-fit`… | `xterm`, `xterm-addon-fit` |
| russh | `russh::keys::*` (clés, known_hosts, agent) | crate `russh-keys` |
| Lint / format | Biome (`npm run check`) | ESLint, Prettier, oxlint |

## Règles de code

- **Anglais** pour le code, les identifiants, les commentaires et les commits.
- **Aucun texte d'interface en dur** : toujours `t("domaine.cle")`, avec la clé ajoutée dans `src/i18n/locales/en.json`
  **et** `fr.json` (à partir de T03).
- Taille : fichiers ≤ 400 lignes (800 absolu), fonctions ≤ 50 lignes, imbrication ≤ 4 niveaux.
- **Immuabilité** : on ne mute jamais un objet reçu, on construit une copie (`{ ...obj, champ }`, `map`, `filter`).
  Côté Rust, l'état partagé est remplacé par une nouvelle valeur, pas modifié en place.
- **Erreurs** :
  - Rust : toute commande renvoie `Result<T, AppError>` ; `unwrap()` et `expect()` seulement dans les tests.
  - TS : tout appel `ipc.*` est dans un `try/catch` qui affiche un toast traduit (`lib/errors.ts`).
- **Frontières** :
  - `invoke()` n'apparaît **que** dans `src/lib/ipc.ts`, et `listen()` que dans `src/lib/events.ts` ;
  - chaque commande ajoutée à `ipc.ts` l'est aussi à `ipc-mock.ts` ;
  - les types partagés viennent de `src/bindings/` (générés) : jamais de type dupliqué à la main.
- Fichiers générés, **ne jamais éditer** : `src/bindings/**`. Composants `src/components/ui/**` : générés par shadcn,
  retouches seulement si une fiche le demande.
- **Styles** : uniquement les classes des tokens (`docs/03-design.md`). Aucune couleur en hexadécimal ni `oklch()`
  dans un composant.
- **Sécurité** : `docs/06-securite.md` est bloquant. En particulier : aucun secret dans un fichier, un log, un message
  d'erreur ou un argument de processus, et le frontend ne relit jamais un secret enregistré.
- Pas de `console.log`, `println!` ou `dbg!` laissés dans le code. Journaux côté Rust : `log::info!` / `log::warn!`…

## Commandes utiles

`npm run dev` (UI seule dans le navigateur, IPC simulé) · `npm run tauri dev` (app complète) ·
`npm run verify` (tout) · `npm run bindings` (types TS depuis Rust) · `cd src-tauri && cargo check` (rapide).

## Carte des documents

| Document | Quand le lire |
|---|---|
| `docs/00-vision.md` | pour comprendre le produit |
| `docs/01-architecture.md` | toute fiche Rust ou IPC |
| `docs/02-decisions.md` | avant de vouloir « faire autrement » |
| `docs/03-design.md` | toute fiche d'interface |
| `docs/04-ecrans.md` | la section de l'écran concerné |
| `docs/05-modele-donnees.md` | toute fiche qui touche aux types |
| `docs/06-securite.md` | toute fiche qui touche aux secrets, au réseau, aux fichiers, aux processus |
| `docs/07-dev.md` | installation, scripts, dépannage |
| `tasks/README.md` | plan, dépendances, statuts |
