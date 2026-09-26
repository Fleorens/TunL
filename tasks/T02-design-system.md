# T02 — Design system

| | |
|---|---|
| **Jalon** | M0 — Fondations |
| **Dépend de** | T01 |
| **Lire avant** | `docs/03-design.md` (en entier), `AGENTS.md` (tableau des pièges) |
| **Livrable** | Tailwind 4 + shadcn (`radix-nova`) + tokens TunL clair/sombre + polices + composants de base + galerie de dev |

## Contexte

Cette fiche pose **l'apparence** de TunL. Tout ce qui suivra réutilise ces tokens et ces composants.
La galerie (`src/dev/`) sert à voir d'un coup d'œil tous les éléments, en clair et en sombre.
Elle est réservée au développement, donc ses textes peuvent rester en anglais en dur (exception à la règle i18n,
limitée à `src/dev/`).

## Étapes

### 1. Tailwind CSS 4

```bash
npm install tailwindcss@^4.3 @tailwindcss/vite@^4.3
```

Dans `vite.config.ts`, ajouter l'import `import tailwindcss from "@tailwindcss/vite";` et le plugin :
`plugins: [react(), tailwindcss()],`. Rien d'autre ne change dans ce fichier.

Remplacer **tout** `src/index.css` par une seule ligne :

```css
@import "tailwindcss";
```

### 2. shadcn (version figée)

```bash
CI=1 npx shadcn@4.21.0 init -t vite -b radix -p nova --no-monorepo -y </dev/null
```

Résultat attendu : `components.json` (`"style": "radix-nova"`), `src/lib/utils.ts`, `src/components/ui/button.tsx`,
un `src/index.css` réécrit, et de nouvelles dépendances (`radix-ui`, `cn`, `class-variance-authority`, `lucide-react`,
`tw-animate-css`, `@fontsource-variable/geist`, `shadcn`, `next-themes`).

Puis les composants :

```bash
CI=1 npx shadcn add input label textarea select switch checkbox tabs dialog alert-dialog sheet \
  dropdown-menu context-menu command popover tooltip badge separator scroll-area skeleton sonner kbd \
  resizable table breadcrumb progress collapsible field item empty spinner -y </dev/null
```

⚠ **Ne pas** ajouter le composant `sidebar` de shadcn : TunL a sa propre barre latérale (T03).

### 3. Retirer `next-themes`

Le composant `sonner` généré importe `next-themes`, une bibliothèque pour Next.js dont on ne veut pas.

1. Créer `src/lib/theme.ts` (étape 5) **avant** de modifier `sonner.tsx`.
2. Dans `src/components/ui/sonner.tsx` :
   - remplacer `import { useTheme } from "next-themes"` par `import { useResolvedTheme } from "@/lib/theme"` ;
   - remplacer `const { theme = "system" } = useTheme()` par `const theme = useResolvedTheme()` ;
   - remplacer `theme={theme as ToasterProps["theme"]}` par `theme={theme}`.
   Ajouter en tête du fichier : `// TunL: uses our theme hook instead of next-themes (T02).`
3. `npm uninstall next-themes`, puis `grep -rn "next-themes" src` doit être vide.

### 4. Polices et `src/index.css` final

```bash
npm install @fontsource-variable/geist-mono@^5.3
```

Réécrire `src/index.css` **entièrement**, dans cet ordre :

**(a) En-tête** :

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@fontsource-variable/geist";
@import "@fontsource-variable/geist-mono";

@custom-variant dark (&:is(.dark *));
```

**(b) Le bloc `@theme inline`**, obtenu ainsi :
- garder **toutes** les lignes `--color-*` et `--radius-*` générées par shadcn ;
- supprimer les lignes `--font-heading` et `--font-sans` générées ;
- ajouter à la fin du bloc, **exactement**, les lignes de `docs/03-design.md` §1.2, précédées de
  `--font-heading: var(--font-sans);`.

**(c) Les blocs `:root { … }` et `.dark { … }`** : copie **exacte** de `docs/03-design.md` §1.1. Ils remplacent ceux
générés par shadcn.

**(d) Les trois `@utility`** : copie exacte de `docs/03-design.md` §1.3.

**(e) La couche de base** :

```css
@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  html {
    @apply font-sans;
    font-size: 16px;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  body {
    @apply bg-background text-foreground text-sm;
    overscroll-behavior: none;
  }
  ::selection {
    background-color: color-mix(in oklch, var(--primary) 30%, transparent);
  }
  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    border: 3px solid transparent;
    border-radius: 9999px;
    background-color: var(--border-strong);
    background-clip: content-box;
  }
  ::-webkit-scrollbar-thumb:hover {
    background-color: var(--muted-foreground);
  }
}
```

Contrôle : `grep -c "^\s*--font-sans" src/index.css` doit afficher `1`. `npm run build` doit passer.

### 5. `src/lib/theme.ts`

```ts
import { useSyncExternalStore } from "react";

export type ThemeMode = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return mode;
}

function setDocumentTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

/** Applies the theme now and follows the system while mode is "system". Returns a cleanup function. */
export function applyTheme(mode: ThemeMode): () => void {
  const media = window.matchMedia(DARK_QUERY);
  setDocumentTheme(resolveTheme(mode, media.matches));
  if (mode !== "system") {
    return () => {};
  }
  const onChange = (event: MediaQueryListEvent) => {
    setDocumentTheme(event.matches ? "dark" : "light");
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function subscribe(onStoreChange: () => void): () => void {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getSnapshot(): ResolvedTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** The theme currently applied to <html>, kept in sync with applyTheme(). */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, getSnapshot, () => "dark");
}
```

### 6. Stubs jsdom pour les tests

Remplacer `src/test/setup.ts` par :

```ts
import "@testing-library/jest-dom/vitest";

// jsdom implements neither matchMedia nor ResizeObserver; Radix and our theme code need them.
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe(): void {
      // no-op in jsdom
    }
    unobserve(): void {
      // no-op in jsdom
    }
    disconnect(): void {
      // no-op in jsdom
    }
  }
  Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: ResizeObserverStub });
}
```

### 7. Composants maison (`src/components/`)

Spécification : `docs/03-design.md` §6. Un fichier par composant, export **nommé** (pas d'`export default`).

**`Logo.tsx`**, avec le mot-symbole. Le nom de marque « TunL » n'est pas traduit.

```tsx
import { useId } from "react";
import { cn } from "@/lib/utils";

interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 20, className }: LogoProps) {
  const gradientId = `tunl-logo-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--brand-from)" />
          <stop offset="1" stopColor="var(--brand-to)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill={`url(#${gradientId})`} />
      <path
        d="M8.5 24.5V15a7.5 7.5 0 0 1 15 0v9.5"
        stroke="white"
        strokeOpacity="0.95"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M13 17.5l2.6 2.5-2.6 2.5"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M17.2 22.5h2.6" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-[15px] font-semibold tracking-tight", className)}>
      Tun<span className="text-brand-gradient">L</span>
    </span>
  );
}
```

**`StatusDot.tsx`** :

```tsx
import { cn } from "@/lib/utils";

export type Status = "online" | "connecting" | "offline" | "error" | "unknown";

const DOT_CLASSES: Record<Status, string> = {
  online: "bg-status-online",
  connecting: "bg-status-connecting",
  offline: "bg-status-offline",
  error: "bg-destructive",
  unknown: "bg-transparent ring-1 ring-inset ring-status-offline",
};

interface StatusDotProps {
  status: Status;
  /** Translated, human-readable status. Required: color alone must never carry meaning. */
  label: string;
  className?: string;
}

export function StatusDot({ status, label, className }: StatusDotProps) {
  return (
    <span role="img" aria-label={label} className={cn("relative inline-flex size-2 shrink-0", className)}>
      {status === "connecting" && (
        <span className="absolute inset-0 rounded-full bg-status-connecting animate-tunl-pulse motion-reduce:animate-none" />
      )}
      <span className={cn("relative inline-flex size-2 rounded-full", DOT_CLASSES[status])} />
    </span>
  );
}
```

**`ProtocolIcon.tsx`** :

```tsx
import { FolderTree, type LucideProps, Monitor, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";

export type Protocol = "ssh" | "rdp" | "sftp";

const ICONS = { ssh: SquareTerminal, rdp: Monitor, sftp: FolderTree } as const;

const COLOR_CLASSES: Record<Protocol, string> = {
  ssh: "text-protocol-ssh",
  rdp: "text-protocol-rdp",
  sftp: "text-protocol-sftp",
};

export function ProtocolIcon({ protocol, className, ...props }: { protocol: Protocol } & LucideProps) {
  const Icon = ICONS[protocol];
  return (
    <Icon aria-hidden="true" className={cn("size-4 shrink-0", COLOR_CLASSES[protocol], className)} {...props} />
  );
}
```

**`ProtocolBadge.tsx`** : même logique, `Record<Protocol, string>` avec
`"bg-protocol-ssh/12 text-protocol-ssh"` (et l'équivalent pour `rdp` et `sftp`). Classes de base :
`inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-none font-semibold uppercase tracking-wide`.
Le texte affiché est le protocole lui-même (`ssh` → rendu en majuscules par CSS).

**`SectionHeader.tsx`** : props `title: string`, `action?: ReactNode`, `className?: string`. Rendu : un `div`
`flex h-7 items-center justify-between px-2` contenant un `h3`
`text-xs font-medium uppercase tracking-wider text-subtle-foreground` et, à droite, `action`.

**`ShortcutHint.tsx`** : props `keys: readonly string[]`, `className?: string`. Rendu :
`<KbdGroup className={className}>` avec un `<Kbd key={k}>{k}</Kbd>` par touche (import depuis `@/components/ui/kbd`).

### 8. Galerie de développement

Découper en petits fichiers (chacun < 200 lignes) :

| Fichier | Contenu |
|---|---|
| `src/dev/Gallery.tsx` | en-tête collant (`Logo` 28 px + `Wordmark` + « Design system » en `h1`) et un sélecteur de thème (trois boutons `outline`/`default` : System / Dark / Light) ; `useState<ThemeMode>("system")` + `useEffect(() => applyTheme(mode), [mode])` ; puis les sections ci-dessous dans une colonne `mx-auto max-w-5xl space-y-10 p-8` |
| `src/dev/gallery/ColorsSection.tsx` | une pastille (`size-14 rounded-xl border`) + nom en `font-mono text-xs` pour chaque token : `bg-background`, `bg-sidebar`, `bg-card`, `bg-muted`, `bg-primary`, `bg-brand-gradient`, `bg-protocol-ssh`, `bg-protocol-rdp`, `bg-protocol-sftp`, `bg-status-online`, `bg-status-connecting`, `bg-status-offline`, `bg-destructive` ; puis trois lignes de texte `text-foreground`, `text-muted-foreground`, `text-subtle-foreground` |
| `src/dev/gallery/TypographySection.tsx` | chaque rôle du tableau §2 de `03-design.md`, avec son nom de classe à côté |
| `src/dev/gallery/ControlsSection.tsx` | `Button` dans toutes ses variantes (`default`, `secondary`, `outline`, `ghost`, `destructive`, `link`) et tailles (`xs`, `sm`, `default`, `lg`, `icon`), dont un bouton avec icône `Plus` ; `Input` avec placeholder ; `Switch` ; `Checkbox` ; `Select` à 3 options ; `Badge` |
| `src/dev/gallery/AtomsSection.tsx` | `StatusDot` dans ses 5 états (avec le label en texte à côté) ; `ProtocolIcon` et `ProtocolBadge` pour les 3 protocoles ; `ShortcutHint keys={["Ctrl", "Shift", "P"]}` ; une **carte de connexion d'exemple** : `rounded-xl border bg-card p-4 transition duration-120 ease-out-soft hover:-translate-y-px hover:border-border-strong hover:shadow-elevated`, contenant `ProtocolBadge ssh`, `StatusDot online`, nom `web-01`, `deploy@10.0.0.12:22` en `font-mono text-xs text-muted-foreground` |
| `src/dev/gallery/OverlaysSection.tsx` | boutons qui ouvrent : un `Dialog`, un `Sheet` (côté droit), un `DropdownMenu` (3 entrées dont une destructive), un `Tooltip` sur un bouton icône, et un toast (`toast("Connected to web-01")` importé de `sonner`) |

Remplacer `src/App.tsx` par :

```tsx
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Gallery } from "@/dev/Gallery";

export function App() {
  return (
    <TooltipProvider delayDuration={400}>
      <Gallery />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
```

### 9. Tests

- `src/App.test.tsx` : remplacer l'assertion par `screen.getByRole("heading", { name: "Design system" })`.
- `src/lib/theme.test.ts` : `resolveTheme` → `("system", true)` donne `"dark"`, `("system", false)` donne `"light"`,
  `("dark", false)` donne `"dark"`, `("light", true)` donne `"light"`.
- `src/components/StatusDot.test.tsx` :
  - `getByRole("img", { name: "Online" })` existe pour `status="online" label="Online"` ;
  - l'état `connecting` contient un élément `.animate-tunl-pulse` ;
  - l'état `online` n'en contient pas.

### 10. Vérifier et livrer

```bash
npm run format && npm run verify && npm run build
git add -A && git commit -m "feat: TunL design system, tokens and dev gallery (T02)"
```

## Critères d'acceptation

- [x] `components.json` contient `"style": "radix-nova"`, et `src/components/ui/` contient 32 fichiers :
      les 31 demandés + `input-group.tsx`, tiré par `command` (`ls src/components/ui | wc -l` → 32). Pas de `sidebar.tsx`.
- [x] `next-themes`, `clsx` et `tailwind-merge` sont absents de `package.json`.
- [x] `src/index.css` contient les tokens TunL (`grep -c "protocol-ssh" src/index.css` ≥ 3) et un seul `--font-sans`.
- [x] Aucune couleur `#…` ni `oklch(` hors de `src/index.css` : `grep -rnE "#[0-9a-fA-F]{3,8}\b|oklch\(" src --include=*.tsx`
      est vide.
- [x] `npm run verify` passe, avec au moins 8 tests.
- [ ] `npm run tauri dev` : la galerie s'affiche. En **Dark** : fond graphite quasi noir, bouton principal cyan,
      logo en dégradé cyan → violet. En **Light** : fond blanc cassé, bouton principal bleu. La pastille
      « connecting » pulse.

## À regarder par Florian

Dans `npm run tauri dev`, basculer Dark / Light :
- le contraste des textes secondaires ;
- le dégradé du logo et du « L » ;
- la pulsation de la pastille orange ;
- le survol de la carte d'exemple (légère élévation).

C'est **le** moment de donner son avis sur les couleurs : après, tout en dépend.
