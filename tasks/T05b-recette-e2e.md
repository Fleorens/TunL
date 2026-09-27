# T05b — Tests de recette dans le navigateur (Playwright)

| | |
|---|---|
| **Jalon** | M0 — Fondations |
| **Dépend de** | T05 |
| **Lire avant** | `AGENTS.md` (section « Fiches contrat ») |
| **Livrable** | `npm run e2e` pilote l'app dans Chromium (clics, menus, raccourcis), et `npm run review` = `verify` + `e2e` |

## Pourquoi

Tu n'as pas d'accès visuel, mais un test Playwright peut **cliquer** dans l'app et vérifier ce qui s'affiche.
À partir de maintenant, chaque fiche d'interface est livrée avec ses scénarios, et tu itères jusqu'à ce qu'ils
passent. Les 7 défauts trouvés à la relecture de T04 auraient tous été détectés ainsi.

L'app tourne dans le navigateur grâce au mock IPC (T05). Aucun navigateur n'est téléchargé : on utilise le Chromium
du système (`/usr/bin/chromium-browser` sur ce poste). Vérifié le 2026-09-26 : les 5 premiers scénarios passent
en 3 secondes.

## Contrat

1. `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install -D @playwright/test@~1.63`
2. `playwright.config.ts` à la racine, **à l'identique** :

```ts
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Prefer a system Chromium (no browser download). CI can set TUNL_CHROMIUM or run `npx playwright install chromium`.
const systemChromium = ["/usr/bin/chromium-browser", "/usr/bin/chromium"].find((path) => existsSync(path));
const executablePath = process.env.TUNL_CHROMIUM ?? systemChromium;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    locale: "en-US",
    colorScheme: "dark",
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

3. `e2e/shell.spec.ts` **à l'identique**. *(Lot 3 : le test des placeholders vise désormais le bouton « Settings »,
   et T14 remplace « closing every tab shows the welcome screen » par sa version « home screen » : la référence
   de ce fichier est la fiche T14.)* C'est le contrat. Tu ajoutes seulement, à la fin, le test n° 6 décrit
   juste après :

```ts
import { expect, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("right-clicking a connection opens its menu, with the groups submenu", async ({ page }) => {
  await page.getByRole("button", { name: /^web-01/ }).first().click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Connect" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Move to group" }).hover();
  await expect(page.getByRole("menuitem", { name: "Homelab" })).toBeVisible();
});

test("only one connection row is highlighted at a time", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().click();
  await page.getByRole("button", { name: /^pi-hole/ }).first().click();
  const current = page.locator('[aria-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText("pi-hole");
});

test("placeholder actions show a translated toast, never a raw key", async ({ page }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Coming soon")).toBeVisible();
  await expect(page.getByText("shell.notYetAvailable")).toHaveCount(0);
});

test("keyboard shortcuts drive the sidebar filter and the tabs", async ({ page }) => {
  await page.keyboard.press("Control+Shift+E");
  await expect(page.locator("#sidebar-filter")).toBeFocused();
  await page.keyboard.type("pg");
  await expect(page.getByRole("button", { name: /^db-prod/ })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+Digit2");
  await expect(page.getByRole("tab", { selected: true })).toContainText("db-prod");
  await page.keyboard.press("Control+PageDown");
  await expect(page.getByRole("tab", { selected: true })).toContainText("web-01");
});

test("closing every tab shows the welcome screen", async ({ page }) => {
  await page.keyboard.press("Control+Shift+W");
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByText("Welcome to TunL")).toBeVisible();
  await expect(page.getByRole("button", { name: "New connection" })).toBeVisible();
});
```

   Test n° 6, à écrire toi-même dans le même fichier : « outside Tauri, the status bar flags the mock backend ».
   Il vérifie que `Mock backend` et `v0.1.0-mock` sont visibles.

4. `package.json`, dans `scripts` : `"e2e": "playwright test"` et
   `"review": "npm run verify && npm run e2e"`.
5. `tsconfig.node.json` : `"include": ["vite.config.ts", "playwright.config.ts", "e2e"]`.
6. `.gitignore` : ajouter `test-results/` et `playwright-report/`.
7. `docs/07-dev.md` n'est **pas** à modifier : l'orchestrateur s'en charge.

## Critères d'acceptation

- [x] `npm run review` passe : `verify` puis 6 scénarios e2e verts.
- [x] `e2e/shell.spec.ts` contient les 5 tests fournis **inchangés** (vérifiable par `git diff` avec la fiche),
      plus le test n° 6.
- [x] Aucun navigateur téléchargé : `ls ~/.cache/ms-playwright 2>/dev/null` est vide ou absent.
