# T35 — Barre de titre TunL (optionnelle), avec repli sur la barre du système

| | |
|---|---|
| **Jalon** | M7 — Finitions |
| **Dépend de** | T34 |
| **Lire avant** | `docs/02-decisions.md` D13, `docs/03-design.md` (tokens), `docs/04-ecrans.md` §1 (la barre du haut) |
| **Livrable** | réglage `ui.titleBar` ; commande `window_apply_title_bar` ; boutons de fenêtre dans la barre du haut ; 2 fichiers de tests du contrat |

## Pourquoi

D13 garde la barre de titre du système en v1 : une barre maison, sous Linux, oblige à refaire le déplacement, le
double-clic et le redimensionnement, avec des écarts entre KDE et GNOME. Cette fiche l'ajoute **en option**, sans
risque pour qui n'en veut pas :
- **défaut : la barre du système** (rien ne change pour personne) ;
- Paramètres › Apparence › **Barre de titre** : « Système » ou « TunL ». Avec « TunL », la fenêtre perd ses
  décorations, et **la barre du haut existante (`TopBar`) devient la barre de titre** : on la saisit pour déplacer
  la fenêtre, un double-clic l'agrandit, et elle porte à droite les boutons Réduire, Agrandir / Restaurer et Fermer.
  Pas de seconde barre ;
- **repli automatique** : si la fenêtre refuse de perdre ses décorations, TunL garde la barre du système ; et la
  variable d'environnement `TUNL_TITLEBAR=native` l'impose quoi que dise le réglage (le moyen de s'en sortir si
  la barre maison rend la fenêtre impossible à déplacer).

⚠ **Fiche non prototypée** : les tests du contrat n'ont pas été exécutés contre une implémentation. Si l'un d'eux te
paraît faux (un nom, un chemin de module), **ne le modifie pas** : arrête-toi et explique-le dans ton compte rendu.

## À réutiliser (ne pas réécrire)

- `TopBar` (`features/shell/TopBar.tsx`), `IconButton` (T34), `SettingSelect` et `saveSettings` (T31),
  `AppearanceSection` (T31).
- `useUi` (`features/shell/ui-store.ts`) pour l'état de la fenêtre côté interface.
- Le schéma de `onPrompt` dans `lib/events.ts` (désabonnement asynchrone) pour le nouvel écouteur.

## Contrat

### Rust — modèle (`model/settings.rs`)

```rust
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum TitleBarMode {
    #[default]
    Native,
    Custom,
}
```

`UiSettings` gagne `pub title_bar: TitleBarMode` (JSON `titleBar`, défaut `Native`). Un `settings.json` écrit avant
T35 se charge donc avec la barre du système (`#[serde(default)]` y est déjà).

### Rust — `src-tauri/src/window_chrome.rs` (nouveau, `pub mod window_chrome;` dans `lib.rs`)

```rust
pub const TITLE_BAR_ENV: &str = "TUNL_TITLEBAR";

/// The title bar the window really has.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WindowChrome {
    pub mode: TitleBarMode,
    /// True when the system bar is imposed: `TUNL_TITLEBAR=native`, or the window refused to drop its decorations.
    pub forced: bool,
}

/// Pure: the setting, unless the variable (trimmed, any case) says `native`. Any other value is ignored.
pub fn effective_title_bar(setting: TitleBarMode, env: Option<&str>) -> WindowChrome;

/// Applies the effective bar to the window (`set_decorations(mode == Native)`). If `set_decorations(false)` fails:
/// `log::warn!`, decorations back on, and `WindowChrome { mode: Native, forced: true }`.
pub fn apply_title_bar(window: &tauri::WebviewWindow, setting: TitleBarMode) -> WindowChrome;
```

- **Au démarrage** (`setup` dans `lib.rs`) : lire les réglages enregistrés (comme la commande qui les renvoie au
  frontend) et appeler `apply_title_bar` sur la fenêtre `main`, avant qu'elle s'affiche si possible.
- **Commande** `window_apply_title_bar(window: tauri::WebviewWindow, mode: TitleBarMode) -> Result<WindowChrome,
  AppError>` : appelle `apply_title_bar`. Ajoutée à `invoke_handler()` et à `commands/ipc_tests.rs` (clé `mode`).
- `src-tauri/src/window_chrome_tests.rs` (fourni) : `#[cfg(test)] mod window_chrome_tests;` dans `lib.rs`.

### Permissions (`capabilities/default.json`)

Ajouter `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-close`,
`core:window:allow-start-dragging`, `core:window:allow-internal-toggle-maximize` (le double-clic sur une zone de
déplacement). Rien d'autre : les décorations se changent côté Rust.

### Frontend — IPC et événements

- `lib/ipc.ts` :
  - `windowApplyTitleBar(mode: TitleBarMode): Promise<WindowChrome>` (`invoke`) ;
  - `windowMinimize()`, `windowToggleMaximize()`, `windowClose()` : `getCurrentWindow()` de
    `@tauri-apps/api/window`, **seulement dans `ipc.ts`**, et seulement si `isTauri()`.
- `lib/events.ts` : `onWindowMaximized(handler: (maximized: boolean) => void): () => void`. Dans Tauri :
  `getCurrentWindow().onResized` puis `isMaximized()`, et un premier appel avec l'état initial.
- Mock (`lib/mock/window.ts`, nouveau) : `maximized` (faux au départ) ; `windowToggleMaximize` l'inverse et prévient
  les abonnés de `onWindowMaximized` ; `windowApplyTitleBar(mode)` renvoie `{ mode, forced: false }` ; réduire et
  fermer ne font rien. `lib/mock/data.ts` : `titleBar: "native"` dans les réglages de démo.

### Frontend — état et application du réglage

- `useUi` gagne `windowChrome: WindowChrome` (départ `{ mode: "native", forced: false }`) et `setWindowChrome`.
- `features/shell/use-window-chrome.ts` (nouveau), appelé dans `AppLayout` : quand `settings.ui.titleBar` est connu
  ou change, `ipc.windowApplyTitleBar(...)` puis `setWindowChrome` ; en cas d'erreur, toast traduit (`lib/errors.ts`).
  Il s'abonne aussi à `onWindowMaximized` (état `maximized` dans `useUi`).

### Frontend — la barre

- `features/shell/WindowControls.tsx` (nouveau) : un `role="group"` nommé `t("window.controls")`, trois `IconButton`
  (lucide `Minus`, `Square` / `Copy` quand agrandie, `X`). Le bouton Fermer prend la couleur `destructive` au survol
  (classes de tokens seulement).
- `TopBar` : quand `windowChrome.mode === "custom"` seulement :
  - l'attribut `data-tauri-drag-region` sur le `<header>` **et** sur ses éléments non interactifs (logo, nom, le
    conteneur `flex-1` autour du bouton de recherche) : Tauri ne déplace la fenêtre que si l'élément cliqué porte
    l'attribut lui-même. Jamais sur un bouton ;
  - `WindowControls` en dernier, après un séparateur vertical.
  Avec la barre du système, la `TopBar` est **identique** à aujourd'hui (aucun attribut, aucun bouton).
- `AppLayout` : avec la barre TunL et une fenêtre non agrandie, une bordure d'un pixel autour de la fenêtre (token
  `border`), sans quoi son bord se perd sous GNOME (pas d'ombre sans décorations).

### Frontend — le réglage (`AppearanceSection`)

`SettingSelect` `id="settings-title-bar"`, libellé `t("settings.appearance.titleBar")`, options `native` → « System »
et `custom` → « TunL », description `t("settings.appearance.titleBarHelp")`. Si `windowChrome.forced` alors que le
réglage vaut `custom`, la description devient `t("settings.appearance.titleBarForced")`.

### i18n (`en.json` / `fr.json`)

| Clé | en | fr |
|---|---|---|
| `window.controls` | Window controls | Contrôles de la fenêtre |
| `window.minimize` | Minimize | Réduire |
| `window.maximize` | Maximize | Agrandir |
| `window.restore` | Restore | Restaurer |
| `window.close` | Close window | Fermer la fenêtre |
| `settings.appearance.titleBar` | Title bar | Barre de titre |
| `settings.appearance.titleBarOption.native` | System | Système |
| `settings.appearance.titleBarOption.custom` | TunL | TunL |
| `settings.appearance.titleBarHelp` | Choose System if the window misbehaves. If you can no longer move it, start TunL with TUNL_TITLEBAR=native. | Choisissez Système si la fenêtre se comporte mal. Si vous ne pouvez plus la déplacer, lancez TunL avec TUNL_TITLEBAR=native. |
| `settings.appearance.titleBarForced` | The system title bar is in use: TUNL_TITLEBAR=native is set, or the window kept its decorations. | La barre du système est utilisée : TUNL_TITLEBAR=native est défini, ou la fenêtre a gardé ses décorations. |

## Pièges

- **Redimensionnement par les bords** : sous Linux, Tauri 2 le gère lui-même pour une fenêtre sans décorations
  (script interne, permissions de `core:window:default`). **N'écris pas de zones de redimensionnement maison** :
  si Florian constate que les bords ne répondent pas, ce sera une fiche T35b.
- `data-tauri-drag-region` sur un parent ne couvre **pas** ses enfants : d'où l'attribut sur chaque élément décoratif.
  Le mettre sur un bouton le rendrait impossible à cliquer.
- `getCurrentWindow()` plante hors de Tauri (e2e, `npm run dev`) : toujours derrière `isTauri()` dans `ipc.ts` /
  `events.ts`, comme `Channel`.
- Fermer par le bouton passe par le même chemin que la croix du système (`close()` émet la demande de fermeture) :
  ne pas appeler `destroy()`.
- `settings.json` validé par `normalize_settings` : rien à valider pour une enum, mais le test d'aller-retour des
  réglages doit rester vert.

## Tests du contrat

### `src-tauri/src/window_chrome_tests.rs` (nouveau)

```rust
// T35: the effective title bar — the setting, unless TUNL_TITLEBAR=native imposes the system one.
use crate::model::{Settings, TitleBarMode, UiSettings};
use crate::window_chrome::{TITLE_BAR_ENV, WindowChrome, effective_title_bar};

fn chrome(mode: TitleBarMode, forced: bool) -> WindowChrome {
    WindowChrome { mode, forced }
}

#[test]
fn the_system_bar_is_the_default() {
    assert_eq!(Settings::default().ui.title_bar, TitleBarMode::Native);
}

#[test]
fn settings_written_before_t35_load_with_the_system_bar() {
    let ui: UiSettings =
        serde_json::from_str(r#"{"sidebarWidth":300,"sidebarCollapsed":false}"#).unwrap();
    assert_eq!(ui.title_bar, TitleBarMode::Native);
    assert_eq!(ui.sidebar_width, 300);
}

#[test]
fn the_mode_is_stored_in_lowercase_under_title_bar() {
    assert_eq!(
        serde_json::to_value(TitleBarMode::Custom).unwrap(),
        serde_json::json!("custom")
    );
    let ui = UiSettings { title_bar: TitleBarMode::Custom, ..UiSettings::default() };
    assert_eq!(serde_json::to_value(&ui).unwrap()["titleBar"], serde_json::json!("custom"));
}

#[test]
fn without_the_variable_the_setting_applies() {
    assert_eq!(effective_title_bar(TitleBarMode::Custom, None), chrome(TitleBarMode::Custom, false));
    assert_eq!(effective_title_bar(TitleBarMode::Native, None), chrome(TitleBarMode::Native, false));
}

#[test]
fn the_variable_imposes_the_system_bar() {
    for value in ["native", "NATIVE", " native "] {
        assert_eq!(
            effective_title_bar(TitleBarMode::Custom, Some(value)),
            chrome(TitleBarMode::Native, true),
            "{value:?}"
        );
    }
    assert_eq!(
        effective_title_bar(TitleBarMode::Native, Some("native")),
        chrome(TitleBarMode::Native, true)
    );
}

#[test]
fn other_values_of_the_variable_change_nothing() {
    for value in ["", "custom", "1", "yes"] {
        assert_eq!(
            effective_title_bar(TitleBarMode::Custom, Some(value)),
            chrome(TitleBarMode::Custom, false),
            "{value:?}"
        );
    }
}

#[test]
fn the_variable_is_tunl_titlebar() {
    assert_eq!(TITLE_BAR_ENV, "TUNL_TITLEBAR");
}
```

### `e2e/title-bar.spec.ts` (nouveau)

```ts
// T35: the optional TunL title bar — off by default, chosen in Settings › Appearance, with its window buttons.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function windowControls(page: Page) {
  return page.getByRole("banner").getByRole("group", { name: "Window controls" });
}

async function chooseTitleBar(page: Page, option: "System" | "TunL") {
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await settings.getByRole("navigation").getByRole("button", { name: "Appearance" }).click();
  await settings.getByRole("combobox", { name: "Title bar" }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("the system title bar is the default: no window buttons in the app", async ({ page }) => {
  await expect(page.getByRole("banner").getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(windowControls(page)).toHaveCount(0);
  await expect(page.getByRole("banner")).not.toHaveAttribute("data-tauri-drag-region");
});

test("the TunL title bar puts minimize, maximize and close in the top bar", async ({ page }) => {
  await chooseTitleBar(page, "TunL");
  const controls = windowControls(page);
  await expect(controls.getByRole("button", { name: "Minimize" })).toBeVisible();
  await expect(controls.getByRole("button", { name: "Maximize" })).toBeVisible();
  await expect(controls.getByRole("button", { name: "Close window" })).toBeVisible();
  await expect(page.getByRole("banner")).toHaveAttribute("data-tauri-drag-region");
  await expectSaneUi(page);

  await chooseTitleBar(page, "System");
  await expect(windowControls(page)).toHaveCount(0);
  await expect(page.getByRole("banner")).not.toHaveAttribute("data-tauri-drag-region");
});

test("maximize turns into restore, and back", async ({ page }) => {
  await chooseTitleBar(page, "TunL");
  const controls = windowControls(page);
  await controls.getByRole("button", { name: "Maximize" }).click();
  await expect(controls.getByRole("button", { name: "Restore" })).toBeVisible();
  await controls.getByRole("button", { name: "Restore" }).click();
  await expect(controls.getByRole("button", { name: "Maximize" })).toBeVisible();
});

test("the help under the setting gives the way back", async ({ page }) => {
  await chooseTitleBar(page, "TunL");
  await expect(page.getByRole("region", { name: "Settings", exact: true })).toContainText(
    "TUNL_TITLEBAR=native",
  );
});
```

## Étapes

1. `node scripts/contract-tests.mjs T35`.
2. Rust : `TitleBarMode` et le champ de `UiSettings`, `window_chrome.rs`, le démarrage, la commande, les
   permissions ; `npm run bindings` ; `cd src-tauri && cargo test window_chrome`.
3. `ipc.ts`, `events.ts`, le mock (`lib/mock/window.ts`, `data.ts`) ; `npm run typecheck`.
4. `useUi`, `use-window-chrome.ts`, `WindowControls.tsx`, `TopBar`, `AppLayout`, `AppearanceSection`, i18n.
5. `npm run format`, `npm run review`, cases, statut, commit `feat: optional TunL title bar with native fallback (T35)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T35 --check` affiche `OK` partout.
- [ ] `getCurrentWindow` n'apparaît que dans `src/lib/ipc.ts` et `src/lib/events.ts`.
- [ ] Aucune nouvelle exception `project-rules: allow`.
- [ ] Visuel : avec la barre TunL, la barre du haut garde sa hauteur, ses boutons de fenêtre sont alignés à droite,
  Fermer rougit au survol.

## À regarder par Florian

Dans la vraie app (`npm run tauri dev`), Paramètres › Apparence › Barre de titre : « TunL ». Sous Plasma **et**, si
possible, sous GNOME, en Wayland :
- la fenêtre se déplace en saisissant la barre du haut (logo, espace vide), un double-clic l'agrandit ;
- **les bords redimensionnent la fenêtre** (sinon : fiche T35b) ;
- Réduire, Agrandir / Restaurer, Fermer marchent ; Super+flèches et l'aimantation aux bords aussi ;
- en revenant à « Système », la barre du système revient sans redémarrer ;
- `TUNL_TITLEBAR=native npm run tauri dev` garde la barre du système malgré le réglage.
