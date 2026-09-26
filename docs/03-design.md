# 03 — Design system

> Direction artistique : **« la lumière au bout du tunnel »**.
> Des surfaces graphite profondes, des bordures d'un pixel très discrètes, et une seule lumière vive : un dégradé
> cyan → violet réservé à la marque, au focus et à l'état actif. Beaucoup d'air, peu de couleurs, du mouvement sobre.
>
> Références d'ambiance : Linear, Raycast, Warp, Vercel. **Pas** d'effet néon, pas d'ombres lourdes, pas de dégradés
> partout. Le dégradé est rare, donc précieux.

Les écrans eux-mêmes sont décrits dans `04-ecrans.md`.

## 1. Couleurs (tokens)

Toutes les couleurs sont en OKLCH et dans le gamut sRGB. Contrastes WCAG calculés le 2026-09-26 : tout texte ≥ 4,5:1
sur son fond prévu.

**Règle absolue : aucune couleur en dur dans les composants.** Uniquement les classes Tailwind générées par ces tokens
(`bg-background`, `text-muted-foreground`, `border-border-strong`, `text-protocol-ssh`…).

### 1.1 Bloc à coller dans `src/index.css` (remplace les blocs `:root` et `.dark` générés par shadcn)

```css
:root {
  --radius: 0.625rem;
  --background: oklch(0.985 0.002 262);
  --foreground: oklch(0.21 0.02 262);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.21 0.02 262);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.21 0.02 262);
  --primary: oklch(0.52 0.13 240);
  --primary-foreground: oklch(0.99 0 0);
  --secondary: oklch(0.945 0.007 262);
  --secondary-foreground: oklch(0.21 0.02 262);
  --muted: oklch(0.945 0.007 262);
  --muted-foreground: oklch(0.47 0.02 262);
  --accent: oklch(0.945 0.007 262);
  --accent-foreground: oklch(0.21 0.02 262);
  --destructive: oklch(0.55 0.21 25);
  --border: oklch(0.25 0.02 262 / 10%);
  --input: oklch(0.25 0.02 262 / 14%);
  --ring: oklch(0.52 0.13 240);
  --chart-1: oklch(0.52 0.13 240);
  --chart-2: oklch(0.5 0.11 160);
  --chart-3: oklch(0.53 0.12 60);
  --chart-4: oklch(0.52 0.22 290);
  --chart-5: oklch(0.55 0.21 25);
  --sidebar: oklch(0.965 0.005 262);
  --sidebar-foreground: oklch(0.21 0.02 262);
  --sidebar-primary: oklch(0.52 0.13 240);
  --sidebar-primary-foreground: oklch(0.99 0 0);
  --sidebar-accent: oklch(0.925 0.009 262);
  --sidebar-accent-foreground: oklch(0.21 0.02 262);
  --sidebar-border: oklch(0.25 0.02 262 / 8%);
  --sidebar-ring: oklch(0.52 0.13 240);
  /* --- TunL --- */
  --surface-raised: oklch(1 0 0);
  --border-strong: oklch(0.25 0.02 262 / 18%);
  --subtle-foreground: oklch(0.56 0.018 262);
  --brand-from: oklch(0.62 0.1 210);
  --brand-to: oklch(0.52 0.22 290);
  --protocol-ssh: oklch(0.5 0.11 160);
  --protocol-rdp: oklch(0.5 0.16 260);
  --protocol-sftp: oklch(0.53 0.12 60);
  --status-online: oklch(0.6 0.15 150);
  --status-connecting: oklch(0.64 0.13 75);
  --status-offline: oklch(0.6 0.015 262);
  --glass: oklch(1 0 0 / 72%);
  --shadow-elevated: 0 1px 2px oklch(0.2 0.02 262 / 6%), 0 12px 32px -12px oklch(0.2 0.02 262 / 18%);
}

.dark {
  --background: oklch(0.155 0.012 262);
  --foreground: oklch(0.965 0.004 262);
  --card: oklch(0.205 0.014 262);
  --card-foreground: oklch(0.965 0.004 262);
  --popover: oklch(0.215 0.015 262);
  --popover-foreground: oklch(0.965 0.004 262);
  --primary: oklch(0.78 0.135 215);
  --primary-foreground: oklch(0.18 0.03 230);
  --secondary: oklch(0.26 0.016 262);
  --secondary-foreground: oklch(0.965 0.004 262);
  --muted: oklch(0.26 0.016 262);
  --muted-foreground: oklch(0.72 0.018 262);
  --accent: oklch(0.26 0.016 262);
  --accent-foreground: oklch(0.965 0.004 262);
  --destructive: oklch(0.7 0.19 25);
  --border: oklch(1 0 0 / 8%);
  --input: oklch(1 0 0 / 12%);
  --ring: oklch(0.78 0.135 215);
  --chart-1: oklch(0.78 0.135 215);
  --chart-2: oklch(0.8 0.15 160);
  --chart-3: oklch(0.82 0.14 80);
  --chart-4: oklch(0.68 0.17 290);
  --chart-5: oklch(0.7 0.19 25);
  --sidebar: oklch(0.175 0.013 262);
  --sidebar-foreground: oklch(0.965 0.004 262);
  --sidebar-primary: oklch(0.78 0.135 215);
  --sidebar-primary-foreground: oklch(0.18 0.03 230);
  --sidebar-accent: oklch(0.24 0.016 262);
  --sidebar-accent-foreground: oklch(0.965 0.004 262);
  --sidebar-border: oklch(1 0 0 / 6%);
  --sidebar-ring: oklch(0.78 0.135 215);
  /* --- TunL --- */
  --surface-raised: oklch(0.205 0.014 262);
  --border-strong: oklch(1 0 0 / 14%);
  --subtle-foreground: oklch(0.6 0.018 262);
  --brand-from: oklch(0.83 0.13 195);
  --brand-to: oklch(0.68 0.17 290);
  --protocol-ssh: oklch(0.8 0.15 160);
  --protocol-rdp: oklch(0.74 0.12 255);
  --protocol-sftp: oklch(0.82 0.14 80);
  --status-online: oklch(0.8 0.17 150);
  --status-connecting: oklch(0.84 0.15 85);
  --status-offline: oklch(0.55 0.015 262);
  --glass: oklch(0.215 0.015 262 / 72%);
  --shadow-elevated: 0 0 0 1px oklch(1 0 0 / 6%), 0 16px 48px -12px oklch(0 0 0 / 65%);
}
```

### 1.2 Lignes à ajouter **à la fin** du bloc `@theme inline` existant

```css
  --font-sans: "Geist Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono Variable", ui-monospace, "DejaVu Sans Mono", monospace;
  --color-surface-raised: var(--surface-raised);
  --color-border-strong: var(--border-strong);
  --color-subtle-foreground: var(--subtle-foreground);
  --color-brand-from: var(--brand-from);
  --color-brand-to: var(--brand-to);
  --color-protocol-ssh: var(--protocol-ssh);
  --color-protocol-rdp: var(--protocol-rdp);
  --color-protocol-sftp: var(--protocol-sftp);
  --color-status-online: var(--status-online);
  --color-status-connecting: var(--status-connecting);
  --color-status-offline: var(--status-offline);
  --shadow-elevated: var(--shadow-elevated);
  --ease-out-soft: cubic-bezier(0.22, 1, 0.36, 1);
  --animate-tunl-pulse: tunl-pulse 1.4s cubic-bezier(0.22, 1, 0.36, 1) infinite;

  @keyframes tunl-pulse {
    from {
      transform: scale(1);
      opacity: 0.6;
    }
    to {
      transform: scale(2.2);
      opacity: 0;
    }
  }
```

(`--font-sans` existe déjà dans le bloc généré : **remplacer** la ligne, ne pas la dupliquer.)

### 1.3 Utilitaires à ajouter après les blocs `:root` / `.dark`

```css
@utility bg-brand-gradient {
  background-image: linear-gradient(135deg, var(--brand-from), var(--brand-to));
}
@utility text-brand-gradient {
  background-image: linear-gradient(135deg, var(--brand-from), var(--brand-to));
  background-clip: text;
  color: transparent;
}
@utility glass {
  background-color: var(--glass);
  backdrop-filter: blur(20px) saturate(1.4);
}
```

### 1.4 Rôle de chaque couleur

| Token | Usage | Interdit |
|---|---|---|
| `background` | fond de la fenêtre, fond des onglets actifs | — |
| `sidebar` | barre latérale, barre d'onglets, barre d'état (le « chrome ») | zone de contenu |
| `card` / `surface-raised` | cartes, panneaux, feuilles, dialogues | — |
| `muted` / `accent` | survol, élément sélectionné, fond de badge neutre | texte |
| `border` | séparateurs, contours au repos | — |
| `border-strong` | contour au survol, contour des cartes surélevées | — |
| `foreground` | texte principal | — |
| `muted-foreground` | texte secondaire (host, dates, aides) | titres |
| `subtle-foreground` | texte tertiaire non essentiel (compteurs, placeholders) | tout texte à lire |
| `primary` | bouton principal (un seul par vue), lien, focus, curseur du terminal | décoration |
| `brand-gradient` | logo, indicateur d'onglet actif, anneau de l'overlay de connexion, bouton « Se connecter » de l'accueil | fonds de surface, texte courant |
| `protocol-*` | icône et badge du protocole | — |
| `status-*` | pastilles d'état | texte |
| `destructive` | erreurs, suppression | avertissements simples |

## 2. Typographie

- **UI** : Geist Variable (`font-sans`). **Technique** (hôtes, ports, chemins, empreintes, terminal) : Geist Mono Variable
  (`font-mono`).
- Polices **embarquées** via `@fontsource-variable/*`. Aucune police chargée depuis Internet (CSP).
- Base `html` 16 px. Corps de l'UI en **14 px** (`text-sm`).

| Rôle | Classe Tailwind |
|---|---|
| Titre d'écran | `text-xl font-semibold tracking-tight` |
| Titre de section | `text-xs font-medium uppercase tracking-wider text-subtle-foreground` |
| Titre de carte | `text-sm font-medium` |
| Corps | `text-sm` |
| Secondaire | `text-xs text-muted-foreground` |
| Technique | `font-mono text-xs` (+ `tabular-nums` pour les chiffres alignés) |

## 3. Espacements, rayons, ombres

- Grille de 4 px. Paddings courants : `p-2` (8), `p-3` (12), `p-4` (16), `p-6` (24).
- Rayons : `rounded-md` (boutons, champs), `rounded-lg` (menus), `rounded-xl` (cartes, feuilles, dialogues),
  `rounded-full` (pastilles, badges).
- Ombres : seulement `shadow-elevated`, et seulement sur ce qui flotte (menus, palette, dialogues, feuilles, cartes au
  survol). Le reste est plat, séparé par des bordures.

## 4. Mouvement

| Durée | Usage |
|---|---|
| 120 ms | survol, couleur, opacité |
| 180 ms | menus, popovers, palette (fondu + `scale 0.98 → 1`) |
| 260 ms | feuilles latérales, dialogues |
| ressort `{ stiffness: 500, damping: 38 }` | indicateur d'onglet actif (motion `layoutId`) |

Courbe par défaut : `ease-out-soft` (`cubic-bezier(0.22, 1, 0.36, 1)`).

**Animations signature** (celles qui font « waouh », à soigner) :

1. **Indicateur d'onglet** : barre de 2 px en `bg-brand-gradient` sous l'onglet actif. Elle *glisse* d'un onglet à
   l'autre (`layoutId="tab-indicator"`).
2. **Overlay « tunnel »** pendant la connexion : trois rectangles arrondis concentriques, contour de 1,5 px en dégradé
   de marque. Ils grandissent (`scale 0.6 → 1.4`) en s'estompant (`opacity 0.8 → 0`), décalés de 0,4 s, en boucle.
   Au centre, l'icône du protocole. Dessous, la liste des étapes (Réveil → Bastion → Hôte → Authentification → Shell) :
   chaque étape passe de « en attente » (cercle vide) à « en cours » (spinner) puis « faite » (coche qui se dessine en
   150 ms).
3. **Pastille « en connexion »** : anneau qui pulse (`scale 1 → 2.2`, `opacity 0.6 → 0`, 1,4 s, boucle).
4. **Cartes au survol** : `translate-y-[-1px]`, `border-border-strong`, `shadow-elevated`, 120 ms.

**Changement de thème** : jamais animé. Le thème est posé **avant** le premier rendu (`primeTheme` dans `main.tsx`),
et chaque bascule gèle les transitions CSS pendant une frame (classe `theme-switching`, `src/lib/theme.ts`).
Sinon, les composants en `transition-all` affichent une frame à moitié dans l'ancienne palette.

**Réduction des animations** : si `prefers-reduced-motion: reduce` **ou** le réglage `ui.reduceMotion = "on"`, toutes
les durées tombent à 0 et les boucles s'arrêtent (anneau statique). Avec motion, on utilise `MotionConfig reducedMotion`.

## 5. Iconographie

- Uniquement `lucide-react`. Taille 16 px dans l'UI (`size-4`), 14 px dans les listes denses (`size-3.5`),
  trait par défaut.
- Correspondances fixes :

| Concept | Icône lucide |
|---|---|
| SSH / terminal | `SquareTerminal` |
| RDP | `Monitor` |
| SFTP | `FolderTree` |
| Bastion / rebond | `Waypoints` |
| Wake-on-LAN | `Power` |
| Favori | `Star` (rempli si favori : `fill-current`) |
| Récents | `History` |
| Groupe | `Folder` / `FolderOpen` |
| Clé / auth | `KeyRound` |
| Clé d'hôte OK / inconnue / changée | `ShieldCheck` / `ShieldQuestion` / `ShieldAlert` |
| Paramètres | `Settings2` |
| Nouvelle connexion | `Plus` |
| Recherche / palette | `Search` / `Command` |
| Import | `FileInput` |
| Déconnecter | `Unplug` |
| Reconnecter | `RotateCw` |

### 5.1 Logo (composant `components/Logo.tsx`)

Le logo est un carré arrondi en dégradé de marque, avec une arche (le tunnel) et une invite `>_` à l'intérieur.

```tsx
<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <defs>
    <linearGradient id="tunl-logo" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
      <stop stopColor="var(--brand-from)" />
      <stop offset="1" stopColor="var(--brand-to)" />
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#tunl-logo)" />
  <path d="M8.5 24.5V15a7.5 7.5 0 0 1 15 0v9.5" stroke="white" strokeOpacity="0.95" strokeWidth="2.4" strokeLinecap="round" />
  <path d="M13 17.5l2.6 2.5-2.6 2.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  <path d="M17.2 22.5h2.6" stroke="white" strokeWidth="2" strokeLinecap="round" />
</svg>
```

Mot-symbole : `TunL` en `font-semibold tracking-tight`, le `L` final en `text-brand-gradient`.

## 6. Composants maison (`src/components/`)

| Composant | Rôle | Spécification |
|---|---|---|
| `Logo` | marque | §5.1, prop `size` (défaut 20) |
| `StatusDot` | état d'une machine ou d'une session | 8 px, `rounded-full`. Props `status: "online" \| "connecting" \| "offline" \| "error" \| "unknown"`. `connecting` ajoute l'anneau pulsé (§4). `unknown` = contour seul. `aria-label` traduit obligatoire |
| `ProtocolIcon` | icône du protocole | icône §5 colorée `text-protocol-<p>` |
| `ProtocolBadge` | badge `SSH` / `RDP` / `SFTP` | `font-mono text-[10px] font-semibold uppercase`, fond `bg-protocol-<p>/12`, texte `text-protocol-<p>`, `rounded-full px-1.5 py-0.5` |
| `SectionHeader` | titre de section de la sidebar ou de l'accueil | titre §2 + action optionnelle à droite (bouton icône `xs`) |
| `EmptyState` | écran vide | s'appuie sur le composant shadcn `empty` : icône 40 px dans un halo `bg-brand-gradient/10`, titre, texte, 1 ou 2 actions |
| `ShortcutHint` | raccourci affiché | composant shadcn `kbd` ; reçoit `keys: string[]` (`["Ctrl","Shift","P"]`) |

Composants shadcn utilisés (générés par le CLI, voir T02) : `button`, `input`, `label`, `textarea`, `select`, `switch`,
`checkbox`, `tabs`, `dialog`, `alert-dialog`, `sheet`, `dropdown-menu`, `context-menu`, `command`, `popover`, `tooltip`,
`badge`, `separator`, `scroll-area`, `skeleton`, `sonner`, `kbd`, `resizable`, `table`, `breadcrumb`, `progress`,
`collapsible`, `field`, `item`, `empty`, `spinner`.

## 7. Ton et textes

- Anglais de référence (`en.json`), français soigné (`fr.json`). Casse de phrase (« New connection »,
  « Nouvelle connexion »).
- Français neutre, à l'infinitif pour les actions : « Se connecter », « Enregistrer », « Réveiller la machine ».
  Pas de tutoiement ni de vouvoiement quand on peut l'éviter.
- Une erreur dit **ce qui s'est passé** puis **quoi faire** :
  « La clé de ce serveur a changé depuis la dernière connexion. Ce peut être une réinstallation… ou une attaque.
  Vérifiez auprès de l'administrateur avant de supprimer l'ancienne clé. »
- Pas de jargon inutile dans les titres. Le détail technique (code d'erreur, message russh) va dans une zone
  « Détails » repliable, en `font-mono`.

## 8. Raccourcis clavier

Ils sont déclarés dans **un seul** fichier : `src/features/shell/shortcuts.ts`.

| Action | Raccourci | Note |
|---|---|---|
| Palette de commandes | `Ctrl+Shift+P` | + `Ctrl+K` quand le focus n'est pas dans un terminal |
| Connexion rapide | `Ctrl+Shift+T` | ouvre la palette en mode connexion rapide |
| Nouvelle connexion | `Ctrl+Shift+N` | ouvre l'éditeur |
| Fermer l'onglet | `Ctrl+Shift+W` | confirmation si session active (réglable) |
| Onglet suivant / précédent | `Ctrl+PageDown` / `Ctrl+PageUp` | + `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Aller à l'onglet n | `Alt+1` … `Alt+9` | `Alt+9` = dernier |
| Barre latérale | `Ctrl+Shift+B` | |
| Filtrer les connexions | `Ctrl+Shift+E` | focus sur le champ de filtre |
| Paramètres | `Ctrl+,` | |
| Aide des raccourcis | `F1` | |
| Terminal : copier / coller | `Ctrl+Shift+C` / `Ctrl+Shift+V` | |
| Terminal : rechercher | `Ctrl+Shift+F` | |
| Terminal : zoom + / − / 0 | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | |
| Éditeur : enregistrer / fermer | `Ctrl+S` / `Échap` | |

## 9. Thèmes du terminal

Deux thèmes maison, qui suivent le thème de l'app par défaut (réglable) :

| Clé | TunL Nuit (`tunl-night`) | TunL Jour (`tunl-day`) |
|---|---|---|
| background | `#0a0d12` | `#fbfbfd` |
| foreground | `#e6e8ee` | `#1b202b` |
| cursor / cursorAccent | `#17cced` / `#0a0d12` | `#0070b0` / `#fbfbfd` |
| selectionBackground | `#17cced40` | `#0070b02e` |
| black / brightBlack | `#1c2029` / `#5c6370` | `#1b202b` / `#4b5563` |
| red / brightRed | `#ff6b70` / `#ff8a8e` | `#c7282f` / `#e0474d` |
| green / brightGreen | `#52db9c` / `#7ee8b8` | `#0b7a4f` / `#16955f` |
| yellow / brightYellow | `#f3c14c` / `#ffd580` | `#9d6a00` / `#b98300` |
| blue / brightBlue | `#6badff` / `#93c4ff` | `#1f5fbf` / `#2f74d6` |
| magenta / brightMagenta | `#b79cff` / `#cdb8ff` | `#7b3fd4` / `#9257e8` |
| cyan / brightCyan | `#3be1e1` / `#7aeeee` | `#00798c` / `#0891a8` |
| white / brightWhite | `#c9ced8` / `#f2f3f6` | `#6b7280` / `#9ca3af` |

Police du terminal : `Geist Mono Variable`, 13 px, `lineHeight 1.25`, curseur `bar` clignotant, padding interne
`8px 12px`.

## 10. Accessibilité (non négociable)

- Focus visible partout (l'anneau `ring` des composants shadcn ne doit jamais être retiré).
- Tout bouton qui n'a qu'une icône a un `aria-label` traduit **et** un `Tooltip`.
- Les listes (sidebar, SFTP) se naviguent au clavier : flèches, `Entrée`, `Menu` / `Maj+F10` pour le menu contextuel.
- L'état n'est jamais porté par la couleur seule : la pastille a un `aria-label`, et un texte l'accompagne là où il y a
  la place.
- Contrastes : ceux du §1. Ne pas inventer de nouvelles combinaisons.
