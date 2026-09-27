# TunL — règles pour l'agent de code

Tu écris le code de **TunL** : un gestionnaire de connexions SSH / SFTP / RDP pour Linux, en Tauri 2 + Rust + React.
Un orchestrateur a écrit l'architecture (`docs/`) et découpé le travail en fiches (`tasks/Txx-*.md`).
**Tu exécutes UNE fiche par session, rien de plus.**

## Déroulé obligatoire d'une session

1. Lis la fiche **une fois en entier**, puis, dans les documents qu'elle cite, **seulement les sections indiquées**.
   Rien d'autre sans raison. Ce fichier (`AGENTS.md`) est déjà dans tes instructions : ne le relis pas.
2. Vérifie le point de départ :
   - `git status` doit être propre ;
   - les fiches listées dans « Dépend de » sont marquées `livrée` ou `validée` dans `tasks/README.md`
     (`grep -n "^| T0X " tasks/README.md` suffit).
   Sinon, ARRÊTE et dis-le.
3. Exécute les étapes **dans l'ordre**. N'ajoute aucune fonctionnalité, dépendance, fichier ou refactorisation
   non demandés.
4. Écris les fichiers par morceaux raisonnables : **jamais plus d'environ 300 lignes par écriture**.
   Au-delà, crée le fichier puis complète-le par éditions successives.
5. Termine par `npm run format`, puis `npm run review` (= `verify` + tests e2e ; `npm run verify` seul tant que
   T05b n'est pas livrée). Tout doit être vert, et `node scripts/contract-tests.mjs Txx --check` doit afficher
   `OK` pour chaque test du contrat.
6. Dans la fiche, coche les critères d'acceptation vérifiés (`- [x]`). Dans `tasks/README.md`, passe le statut
   de la fiche à `livrée`. Si la fiche rend une fonction utilisable, déplace-la dans le tableau « Where it stands »
   du `README.md` (colonne « Works today »), en une ligne.
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

## Contexte limité : lis juste ce qu'il faut

Ton contexte fait environ 130 000 tokens. Quand il est plein, opencode le **compacte** : il le remplace par un
résumé, et tu perds le détail de tout ce que tu as lu. Une session qui relit tout tourne en boucle (lecture,
compaction, relecture…). En T09, cela a coûté une heure et trois compactions sans une ligne de code écrite.

- **Une seule lecture de la fiche**, au début, **sans les blocs de « Tests du contrat »** (le script les écrit) :
  `awk '/^## Tests du contrat/{s=1} /^## Étapes/{s=0} !s' tasks/Txx-*.md`. Un test se lit dans son fichier, et
  seulement quand il échoue. Ensuite, relis seulement la section utile, par ses numéros
  de ligne : `grep -nE '^#{2,4} ' tasks/Txx-*.md` donne l'index, puis lecture avec offset et limite.
- **Documents** : seulement les sections citées dans « Lire avant » (`grep -nE '^#{1,3} ' docs/xx.md` pour les
  trouver). Jamais un document entier « au cas où ».
- **Code existant** : le strict nécessaire. Pour connaître les exports d'un fichier : `grep -n "export" <fichier>`.
  Les composants de `src/components/ui/` ne se lisent jamais en entier.
- **Tests du contrat** : écrits par le script (voir « Fiches contrat »). Ne les recopie pas à la main, ne les compare
  pas à la fiche toi-même.
- **Ne revérifie pas ce qui est acquis** : point de départ vert, tests identiques, version d'une dépendance.
- **Réflexion courte, pas de plan global.** Un fichier = une lecture ciblée, une écriture, puis le suivant, dans
  l'ordre des « Étapes » de la fiche.
- **Valide par paliers.** Dès que la logique est écrite (types, stores, validation), lance `npm run typecheck` et les
  tests unitaires concernés (`npx vitest run <dossier>`), avant d'attaquer l'interface.
- **Après une compaction, ne repars pas de zéro** : `git status --short` montre ce qui est déjà écrit, l'index de la
  fiche dit où reprendre. Passe directement au fichier suivant.

## Fiches « contrat » (à partir du lot 2)

Les fiches ne donnent plus le code : elles donnent les **types**, le **comportement attendu**, les **pièges**, et
surtout les **tests**. C'est toi qui écris toute l'implémentation.
- Les fichiers de test fournis dans une fiche sont **le contrat** :
  - tu les crées avec `node scripts/contract-tests.mjs Txx`, jamais à la main ;
  - `node scripts/contract-tests.mjs Txx --check` vérifie qu'ils sont identiques à la fiche (formatage ignoré) ;
  - tu ne les modifies jamais, ne les supprimes jamais, et n'y ajoutes ni `.skip`, ni `.only`, ni `.todo` ;
  - un avertissement de clippy ou de Biome **dans un test du contrat** ne se corrige pas dans le test : arrête-toi
    et signale-le (seul le formatage par `npm run format` est permis) ;
  - tu peux **ajouter** tes propres tests à côté.
- Boucle de travail : écrire → `npm run review` → lire les échecs → corriger le **code** → recommencer.
  Une fiche n'est pas livrée tant qu'un test du contrat échoue.
- Un test du contrat te paraît faux ? Ne le touche pas : arrête-toi et explique pourquoi dans ton compte rendu.
- Un scénario e2e qui échoue laisse une trace dans `test-results/`. Lis le message d'erreur (il dit quel élément
  était introuvable ou invisible) plutôt que de deviner.

## Ce que `npm run review` vérifie pour toi (tu n'as pas d'yeux : ces contrôles en tiennent lieu)

- **`npm run rules`** (dans `verify`) :
  - `scripts/project-rules.mjs` : les règles que ni TypeScript, ni Biome, ni clippy ne voient. Chacune vient d'un
    défaut réel : casts `as never` / `as any`, `<input>` brut au lieu du composant shadcn, `unwrap()` hors tests,
    struct `…Request` dans une commande Tauri, commande absente d'`invoke_handler()`, fichier de plus de 400 lignes,
    **module presque identique à un autre** (tu as réécrit ce qui existait), test désactivé, règles S1 à S13 ;
  - `contract-tests.mjs --all` : les tests du contrat de **toutes** les fiches livrées sont intacts.
  Une règle en rouge se corrige dans le code. Si elle est vraiment fausse pour **une** ligne, écris juste au-dessus
  `// project-rules: allow <règle> — <raison>` (en JSX : `{/* … */}`). L'orchestrateur relit chaque exception :
  n'en mets jamais une pour faire taire un vrai problème.
- **Tous les e2e importent `test` et `expect` de `./support/test.ts`**, jamais de `@playwright/test` : un test
  échoue alors si l'app écrit une erreur ou un avertissement dans la console (avertissements React compris).
- **`expectSaneUi(page)`** (`e2e/support/sanity.ts`) : clé i18n brute affichée, page plus large que la fenêtre,
  contrôle sans nom accessible, contrôles qui se chevauchent dans un dialogue, champ collé au bord d'un dialogue.
  Dans tes propres scénarios e2e, appelle-le dès qu'un nouvel écran ou dialogue est ouvert.

## Réutiliser avant d'écrire

Chaque fiche a une section **« À réutiliser »** : ces fonctions et composants existent, sers-t'en. Avant de créer un
helper ou un composant qu'elle ne cite pas, cherche s'il existe :
`grep -rn "export function\|export const" src/features src/lib src/components | grep -i <mot>`.
Deux modules presque identiques font échouer `npm run rules`.

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
- **Tu restes dans le dépôt** : aucun `cd`, aucune lecture ni écriture hors de lui, `/tmp` compris. opencode les
  refuse (`Permission denied: external_directory`) : ne cherche pas à contourner ce refus. Pour un essai jetable :
  `node --input-type=module -e '…'` depuis la racine (les paquets du projet se résolvent), ou un fichier dans le
  dépôt, supprimé avant le commit.

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
| Enfant d'un `asChild` (Radix) | le composant accepte `ComponentProps<"button">` et **propage** le reste des props (`{...props}`) : c'est par là que passent `onContextMenu`, `ref`… | un composant qui ne garde que ses props à lui (le menu ne s'ouvre jamais) |
| Toasts | `toast(t("cle"))` ou un helper qui appelle `i18n.t(...)` | `toast("cle")` (affiche la clé brute) |
| Utilitaire CSS maison (`@utility`) | une variante dédiée (ex. `bg-brand-soft`) | un modificateur d'opacité (`bg-brand-gradient/10` ne produit rien) |
| Radix `Select` | une valeur sentinelle (`"__none__"`) pour « aucun » | `<SelectItem value="">` (plante à l'ouverture) |
| Sélecteur zustand | sélectionner la donnée brute, dériver avec `useMemo` (ou `useShallow`) | `useStore((s) => s.list.filter(…))` (nouveau tableau à chaque rendu → boucle infinie) |
| zod 4 | `{ error: "code" }` dans un schéma, `ctx.addIssue({ code: "custom", message, path })` dans `superRefine` | `{ message: "…" }` dans un schéma, `z.string().nonempty()` |
| Formulaire react-hook-form | ne rendre les champs qu'une fois le `reset` fait pour la cible ouverte (ou des `defaultValues` complètes) | des champs rendus avec des valeurs `undefined`, puis remplis par un `useEffect` (avertissement « uncontrolled → controlled ») |
| Carte cliquable qui contient un radio | `has-checked:` (input natif) ou `has-[[data-state=checked]]:` (Radix) **sur la carte** | `peer-checked:` sur le parent (ne vise que les frères qui suivent le `peer`) |
| Texte dans un `<button>` | `text-left` sur le libellé (`flex-1 truncate text-left`) | compter sur le `text-left` d'un parent (le bouton recentre) |
| Champs propres à un protocole | les conditionner à `protocol` (`useWatch`) : une connexion SSH n'affiche aucun réglage RDP, et inversement | tout afficher dans l'onglet |
| Arguments d'une commande Tauri | un paramètre Rust par clé JSON envoyée par `ipc.ts` (`id: Uuid, input: ConnectionInput` pour `{ id, input }`), et une ligne dans `src-tauri/src/commands/ipc_tests.rs` qui l'appelle avec ces clés | une struct `req: XRequest` (Tauri attend alors `{ req: { … } }` : toutes les modifications échouaient dans la vraie app, le mock le cachait) |

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
`npm run verify` (types, lint, tests, Rust) · `npm run e2e` (scénarios Playwright) · `npm run review` (les deux) · `npm run bindings` (types TS depuis Rust) · `cd src-tauri && cargo check` (rapide) ·
`node scripts/contract-tests.mjs Txx` (écrit les tests du contrat) · `node scripts/contract-tests.mjs Txx --check`
(vérifie qu'ils n'ont pas bougé).

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
