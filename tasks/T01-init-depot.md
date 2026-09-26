# T01 — Initialiser le dépôt

| | |
|---|---|
| **Jalon** | M0 — Fondations |
| **Dépend de** | — |
| **Lire avant** | `AGENTS.md`, `docs/01-architecture.md` §2–3, `docs/07-dev.md` |
| **Livrable** | un projet Vite + React + TypeScript + Tauri 2 qui compile, avec Biome, Vitest et `npm run verify` |

## Contexte

Le dépôt contient déjà `AGENTS.md`, `docs/`, `tasks/` et `.opencode/`. **Ces fichiers ne doivent pas être modifiés**,
sauf `tasks/README.md` (statut) et cette fiche (cases).
Toutes les commandes ci-dessous ont été testées le 2026-09-26 sur ce poste.
Elles se lancent **depuis la racine du dépôt** (`~/Documents/GitHub/TunL`).

## Étapes

### 1. Vérifier les outils

```bash
node --version          # ≥ v22.12
cargo --version
cargo fmt --version     # si "not installed" : rustup component add rustfmt
cargo clippy --version  # si "not installed" : rustup component add clippy
git status --short      # doit être vide
```

### 2. Générer le projet Vite dans un dossier temporaire, puis le rapatrier

Le dossier n'est pas vide : on ne génère **pas** directement dans `.`.

```bash
npm create vite@latest .scaffold -- --template react-ts --no-interactive
bash -c 'shopt -s dotglob && mv -n .scaffold/* . && rmdir .scaffold'
```

`rmdir` doit réussir. S'il échoue, un fichier du modèle portait le même nom qu'un fichier existant :
**ARRÊTE** et signale-le.

### 3. Retirer ce dont on ne veut pas

```bash
rm -rf src/assets src/App.css src/index.css public/icons.svg public/favicon.svg .oxlintrc.json README.md
```

### 4. Écrire `package.json` (remplace entièrement celui du modèle)

```json
{
  "name": "tunl",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "license": "GPL-3.0-or-later",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "typecheck": "tsc -b",
    "check": "biome check .",
    "format": "biome check --write .",
    "test": "vitest run",
    "bindings": "cd src-tauri && cargo test export_bindings",
    "verify:rust": "cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test",
    "verify": "npm run typecheck && npm run check && npm run test && npm run verify:rust"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.11.1",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.14",
    "@tauri-apps/cli": "^2.11.5",
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.3",
    "@types/node": "^24.13.3",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.7",
    "@vitejs/plugin-react": "^6.1.1",
    "jsdom": "^30.1.1",
    "typescript": "~6.0.2",
    "vite": "^8.3.0",
    "vitest": "^5.0.2"
  }
}
```

Puis : `npm install`.

### 5. Configurer TypeScript (alias `@/`)

Dans **`tsconfig.json`** ET **`tsconfig.app.json`**, ajouter dans `compilerOptions` (créer l'objet dans
`tsconfig.json`, qui n'en a pas) :

```json
"paths": { "@/*": ["./src/*"] }
```

⚠ **Ne pas** ajouter `baseUrl` : TypeScript 6 le refuse (erreur TS5101).
Ne rien changer d'autre dans ces fichiers.

### 6. Écrire `vite.config.ts` (remplace le fichier)

```ts
/// <reference types="vitest/config" />
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

### 7. Fichiers du frontend

**`index.html`** (remplace) :

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <title>TunL</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**`public/favicon.svg`** (nouveau) :

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <title>TunL</title>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
      <stop stop-color="#3be1e1"/>
      <stop offset="1" stop-color="#9982f8"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#g)"/>
  <path d="M8.5 24.5V15a7.5 7.5 0 0 1 15 0v9.5" stroke="#fff" stroke-opacity=".95" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M13 17.5l2.6 2.5-2.6 2.5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M17.2 22.5h2.6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
</svg>
```

**`src/index.css`** (nouveau, provisoire : remplacé en T02) :

```css
/* Temporary: replaced by the TunL design system in T02. */
body {
  margin: 0;
  font-family: system-ui, sans-serif;
}
```

**`src/main.tsx`** (remplace) :

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("TunL: #root element is missing from index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**`src/App.tsx`** (remplace, provisoire : remplacé en T02/T03) :

```tsx
export function App() {
  return (
    <main>
      <h1>TunL</h1>
    </main>
  );
}
```

**`src/test/setup.ts`** (nouveau) :

```ts
import "@testing-library/jest-dom/vitest";
```

**`src/App.test.tsx`** (nouveau) :

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the product name", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "TunL" })).toBeInTheDocument();
  });
});
```

**`README.md`** (nouveau, provisoire : le vrai arrive en T39) :

```markdown
# TunL

A modern SSH, SFTP and RDP connection manager for Linux. **Work in progress.**
```

### 8. Biome

**`biome.json`** (nouveau) :

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "includes": ["**", "!!**/dist", "!!src-tauri", "!!src/bindings", "!!src/components/ui"]
  },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "preset": "recommended" } },
  "javascript": { "formatter": { "quoteStyle": "double", "semicolons": "always" } },
  "css": { "parser": { "tailwindDirectives": true } },
  "assist": { "enabled": true, "actions": { "source": { "organizeImports": "on" } } }
}
```

### 9. Tauri

```bash
npx tauri init --ci -A tunl -W TunL -D ../dist -P http://localhost:1420 \
  --before-dev-command "npm run dev" --before-build-command "npm run build"
```

Cela crée `src-tauri/`. Remplacer ensuite ces fichiers **entièrement** :

**`src-tauri/Cargo.toml`** :

```toml
[package]
name = "tunl"
version = "0.1.0"
description = "A modern SSH, SFTP and RDP connection manager for Linux"
authors = ["Fleorens"]
license = "GPL-3.0-or-later"
edition = "2024"
rust-version = "1.90"

[lib]
name = "tunl_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.6", features = [] }

[dependencies]
tauri = { version = "2.11", features = [] }
tauri-plugin-log = "2.9"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
log = "0.4"

[profile.release]
codegen-units = 1
lto = true
strip = true
```

**`src-tauri/src/main.rs`** :

```rust
// Prevents an extra console window on Windows release builds. No effect on Linux.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tunl_lib::run();
}
```

**`src-tauri/src/lib.rs`** :

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().level(log_level).build())
        .run(tauri::generate_context!())
        .expect("error while running TunL");
}
```

**`src-tauri/tauri.conf.json`** :

```json
{
  "$schema": "../node_modules/@tauri-apps/cli/config.schema.json",
  "productName": "TunL",
  "version": "0.1.0",
  "identifier": "io.github.fleorens.TunL",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "TunL",
        "width": 1280,
        "height": 800,
        "minWidth": 960,
        "minHeight": 600,
        "resizable": true,
        "center": true
      }
    ],
    "security": {
      "csp": {
        "default-src": "'self'",
        "script-src": "'self'",
        "style-src": "'self' 'unsafe-inline'",
        "img-src": "'self' data: blob:",
        "font-src": "'self' data:",
        "connect-src": "ipc: http://ipc.localhost",
        "object-src": "'none'",
        "base-uri": "'none'",
        "form-action": "'none'",
        "frame-ancestors": "'none'"
      },
      "devCsp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["deb", "rpm", "appimage"],
    "category": "Utility",
    "shortDescription": "SSH, SFTP and RDP connection manager",
    "longDescription": "TunL is a modern, keyboard-first SSH, SFTP and RDP connection manager for Linux.",
    "license": "GPL-3.0-or-later",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

Ne pas toucher à `src-tauri/build.rs`, `src-tauri/icons/`, `src-tauri/capabilities/default.json` ni
`src-tauri/.gitignore`.

Puis formater le Rust (le modèle Tauri est indenté à 2 espaces, rustfmt en veut 4) :

```bash
cd src-tauri && cargo fmt && cd ..
```

### 10. `.gitignore`

Ajouter **à la fin** du `.gitignore` généré par Vite :

```
# Environment
.env
.env.*
```

### 11. Vérifier

```bash
npm run format
npm run verify          # la 1re fois, la compilation Rust prend 1 à 3 minutes
npm run build           # doit produire dist/
timeout 120 npm run tauri dev
```

La dernière commande doit afficher `Running target/debug/tunl` (ou équivalent) sans erreur, et ouvrir une fenêtre
« TunL » qui montre le titre **TunL**. Le `timeout` l'arrête au bout de 2 minutes : c'est normal.

### 12. Commit

```bash
git status --short      # ni node_modules/, ni src-tauri/target/, ni dist/ ne doivent apparaître
git add -A && git commit -m "chore: scaffold Vite + React + Tauri 2 project (T01)"
```

## Critères d'acceptation

- [ ] `AGENTS.md` et `docs/` inchangés (`git diff --stat HEAD~1 -- AGENTS.md docs` est vide).
- [ ] `npm run verify` passe : typecheck, Biome, Vitest (1 test), cargo fmt, clippy `-D warnings`, cargo test.
- [ ] `npm run build` produit `dist/index.html`.
- [ ] `npm run tauri dev` ouvre une fenêtre titrée « TunL », 1280 × 800, et on ne peut pas la réduire sous 960 × 600.
- [ ] `package-lock.json` et `src-tauri/Cargo.lock` sont commités. `node_modules/`, `dist/` et `src-tauri/target/`
      ne le sont pas.
- [ ] Aucune dépendance en dehors de celles listées (oxlint a disparu de `package.json`).

## À regarder par Florian

Lancer `npm run tauri dev` : une fenêtre sobre avec « TunL » en titre. Rien de beau encore, c'est l'objet de T02.
