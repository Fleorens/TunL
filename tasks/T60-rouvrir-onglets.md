# T60 — Rouvrir les onglets de la dernière fois

| | |
|---|---|
| **Jalon** | M10 — Nouvelles fonctions (lot 8) |
| **Dépend de** | T59 |
| **Lire avant** | `docs/10-fonctions-a-venir.md` § « Rouvrir les onglets de la dernière fois » ; `docs/05-modele-donnees.md` (réglages) ; `docs/06-securite.md` S2, S9 ; `docs/04-ecrans.md` § 2 (accueil), § 10 (Paramètres) |
| **Livrable** | `src-tauri/src/store/tabs.rs` (nouveau), `store/mod.rs`, `model/settings.rs` (`ui.restoreTabs`), `commands/` (`tabs_load`, `tabs_save`), `lib.rs`, bindings ; `src/lib/ipc.ts`, `src/lib/mock/` (onglets, réglage), `src/features/sessions/restore-tabs.ts` (nouveau), `AppLayout.tsx` (ou le point de montage de l'enregistrement), `home/HomeView.tsx`, `settings/sections/AppearanceSection.tsx`, `en.json` / `fr.json` ; `src-tauri/src/store/tabs_tests.rs`, `src-tauri/src/commands/ipc_tabs_tests.rs`, `src/features/sessions/restore-tabs.test.ts`, `e2e/restore-tabs.spec.ts` |

## Pourquoi

À chaque lancement, il faut rouvrir à la main les mêmes cinq ou six sessions de travail.

## À réutiliser (ne pas réécrire)

- `store/file.rs` : `write_json_atomic` (fichier `0600`, écriture atomique, S9), `read`.
- `openSession(connection, kind)` (`open-session.ts`) : ouvre un onglet SSH, SFTP ou RDP sur une connexion
  enregistrée.
- `saveSettings` (`settings/save-settings.ts`), `SettingSelect` (`SettingRow.tsx`).
- `useConnections` (la liste des connexions), `useSessions` (les onglets, dans l'ordre de la barre).

## Contrat — Rust

### `tabs.json` (dossier de configuration, à côté de `settings.json`)

```rust
/// One tab to reopen: a saved connection and what the tab ran. Never a quick target, never a secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SavedTab {
    pub connection_id: Uuid,
    pub kind: SavedTabKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SavedTabKind {
    Ssh,
    Sftp,
    Rdp,
}

/// The most tabs kept.
pub const MAX_SAVED_TABS: usize = 50;

/// The tabs saved last time, in order. A missing file, an unreadable one, or one of a newer version: none
/// (with a `log::warn!` for the last two), never an error.
pub fn load_tabs(config_dir: &Path) -> Vec<SavedTab>;
/// Replace `tabs.json` (`{ "version": 1, "tabs": [...] }`, mode 0600). More than `MAX_SAVED_TABS`:
/// `AppError::validation("tabs", …)`, nothing written.
pub fn save_tabs(config_dir: &Path, tabs: &[SavedTab]) -> AppResult<()>;
```

- Commandes : `tabs_load() -> AppResult<Vec<SavedTab>>` et `tabs_save(tabs: Vec<SavedTab>) -> AppResult<()>`, dans
  `invoke_handler()` et `ipc_tabs_tests.rs`.
- `UiSettings` gagne `restore_tabs: RestoreTabs` (`#[serde(rename_all = "lowercase")]` : `never`, `ask`, `always` ;
  défaut `Ask`). Un `settings.json` sans ce champ se lit avec le défaut (`#[serde(default)]` est déjà sur la struct).
- Puis `npm run bindings`.

## Contrat — Frontend

### `restore-tabs.ts`

```ts
/** The tabs worth saving, in the row's order: saved connections only (a quick target is never kept). */
export function savedTabsOf(sessions: readonly Session[]): SavedTab[];
/** The saved tabs that can still open: their connection exists, and an RDP tab only on an RDP connection (an
 *  SSH or SFTP tab only on an SSH one). Order kept. */
export function restorable(saved: readonly SavedTab[], connections: readonly Connection[]): SavedTab[];
```

- **Enregistrement** : une fois la liste de la dernière fois **lue** (`tabsLoad`, au démarrage), chaque changement de
  `savedTabsOf(sessions)` (ouverture, fermeture, ordre) part par `tabsSave`, au plus une fois toutes les 500 ms.
  Jamais avant la lecture : sinon la liste vide du démarrage effacerait celle de la dernière fois. Une erreur :
  `notifyError`, une seule fois par série (comme les sondes, T53).
- **Au démarrage**, une fois les réglages et les connexions chargés, avec `restorable(...)` non vide :
  - `always` : les onglets s'ouvrent, dans l'ordre ; le premier devient actif ;
  - `ask` : l'accueil affiche, au-dessus des favoris, un bouton « Rouvrir {{count}} onglets »
    (`home.restoreTabs`, au pluriel `_one` / `_other`) et un bouton discret « Ignorer » (`home.restoreDismiss`) ;
    rouvrir ou ignorer retire l'offre pour la session ;
  - `never` : rien.
- **Paramètres**, section Apparence, après « Confirmer avant de fermer un onglet connecté » : liste « Rouvrir les
  onglets au démarrage » (`settings.appearance.restoreTabs`) avec Jamais / Demander / Toujours
  (`settings.appearance.restoreTabsOption.never|ask|always`).
- **Mock** : `tabs_load` / `tabs_save` gardent la liste dans `sessionStorage` (clé `tunl.mock.tabs`, lecture et
  écriture dans un `try/catch`), pour qu'un rechargement de la page joue le rôle d'un redémarrage. `restoreTabs`
  vaut `ask` dans les réglages simulés.

| Clé | en | fr |
|---|---|---|
| `home.restoreTabs_one` / `_other` | Reopen 1 tab / Reopen {{count}} tabs | Rouvrir 1 onglet / Rouvrir {{count}} onglets |
| `home.restoreDismiss` | Dismiss | Ignorer |
| `settings.appearance.restoreTabs` | Reopen tabs at startup | Rouvrir les onglets au démarrage |
| `…restoreTabsOption.never` / `ask` / `always` | Never / Ask / Always | Jamais / Demander / Toujours |

## Pièges

- `tabs.json` ne contient **que** des ids de connexion et un type : jamais d'hôte, d'utilisateur, ni de secret (S2).
- Ne pas mettre la liste des onglets dans `settings.json` : un export de réglages (T32) n'a pas à les emporter, et
  chaque ouverture d'onglet réécrirait les réglages.
- `restorable` filtre aussi un type devenu incohérent (une connexion passée de SSH à RDP depuis).
- Le sélecteur zustand de l'enregistrement : sélectionner `sessions` brut, dériver avec `useMemo` (piège d'`AGENTS.md`).
- `HomeView.tsx` et `AppearanceSection.tsx` : rester sous 400 lignes ; la logique dans `restore-tabs.ts`.

## Tests du contrat

### `src-tauri/src/store/tabs_tests.rs` (nouveau ; `#[cfg(test)] mod tabs_tests;` dans `store/mod.rs`)

```rust
//! T60: the tabs of last time are kept in `tabs.json`, private, and a bad file never stops TunL.
use std::os::unix::fs::PermissionsExt;

use uuid::Uuid;

use super::tabs::{MAX_SAVED_TABS, SavedTab, SavedTabKind, load_tabs, save_tabs};
use crate::error::ErrorKind;

fn tab(kind: SavedTabKind) -> SavedTab {
    SavedTab {
        connection_id: Uuid::new_v4(),
        kind,
    }
}

#[test]
fn the_tabs_come_back_in_order_from_a_private_file() {
    let dir = tempfile::tempdir().unwrap();
    assert!(load_tabs(dir.path()).is_empty(), "no file, no tab");

    let tabs = vec![
        tab(SavedTabKind::Ssh),
        tab(SavedTabKind::Rdp),
        tab(SavedTabKind::Sftp),
    ];
    save_tabs(dir.path(), &tabs).unwrap();
    assert_eq!(load_tabs(dir.path()), tabs);

    let file = dir.path().join("tabs.json");
    let mode = std::fs::metadata(&file).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(json["version"], 1);
    assert_eq!(json["tabs"][1]["kind"], "rdp");
    assert!(json["tabs"][0]["connectionId"].is_string());
}

#[test]
fn a_bad_or_newer_file_gives_no_tab() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("tabs.json"), "{ not json").unwrap();
    assert!(load_tabs(dir.path()).is_empty());
    std::fs::write(
        dir.path().join("tabs.json"),
        r#"{ "version": 99, "tabs": [] }"#,
    )
    .unwrap();
    assert!(load_tabs(dir.path()).is_empty());
}

#[test]
fn too_many_tabs_are_refused_and_nothing_is_written() {
    let dir = tempfile::tempdir().unwrap();
    let tabs: Vec<SavedTab> = (0..=MAX_SAVED_TABS).map(|_| tab(SavedTabKind::Ssh)).collect();
    let error = save_tabs(dir.path(), &tabs).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    assert!(!dir.path().join("tabs.json").exists());
}
```

### `src-tauri/src/commands/ipc_tabs_tests.rs` (nouveau)

```rust
//! `tabs_load` and `tabs_save` (T60) through Tauri's real IPC layer, with the keys sent by `ipc.ts`.
use serde_json::json;

use super::ipc_tests::{invoke, mock_app, ok};

#[test]
fn the_tab_commands_accept_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let id = "5b6f2d3e-0000-4000-8000-000000000081";

    ok(
        &webview,
        "tabs_save",
        json!({ "tabs": [{ "connectionId": id, "kind": "sftp" }] }),
    );
    let tabs = invoke(&webview, "tabs_load", json!({})).unwrap();
    assert_eq!(tabs, json!([{ "connectionId": id, "kind": "sftp" }]));
}
```

### `src/features/sessions/restore-tabs.test.ts`

```ts
// T60: which tabs are saved, and which of them can open again.
import { describe, expect, test } from "vitest";
import type { SessionTarget } from "@/bindings/SessionTarget";
import { MOCK_CONNECTIONS, MOCK_IDS } from "@/lib/mock/data";
import { restorable, savedTabsOf } from "./restore-tabs";
import { newSession } from "./session-model";

const saved = (connectionId: string): SessionTarget => ({ type: "saved", connectionId });
// nas is an SSH connection, ad-01 an RDP one.
const nas = MOCK_IDS.nas;
const ad = MOCK_IDS.ad01;

describe("restoring tabs", () => {
  test("saved connections are kept in the row's order, quick targets never", () => {
    const quick: SessionTarget = { type: "quick", host: "10.5.5.5", port: 22, username: "root" };
    const sessions = [
      newSession("t1", "nas", saved(nas), "ssh"),
      newSession("t2", "10.5.5.5", quick, "ssh"),
      newSession("t3", "nas (2)", saved(nas), "sftp"),
      newSession("t4", "ad-01", saved(ad), "rdp"),
    ];
    expect(savedTabsOf(sessions)).toEqual([
      { connectionId: nas, kind: "ssh" },
      { connectionId: nas, kind: "sftp" },
      { connectionId: ad, kind: "rdp" },
    ]);
  });

  test("a deleted connection, or a tab that no longer fits its protocol, is skipped", () => {
    expect(
      restorable(
        [
          { connectionId: "a1000000-0000-4000-8000-0000000009ff", kind: "ssh" },
          { connectionId: nas, kind: "sftp" },
          { connectionId: nas, kind: "rdp" },
          { connectionId: ad, kind: "ssh" },
          { connectionId: ad, kind: "rdp" },
          { connectionId: nas, kind: "ssh" },
        ],
        MOCK_CONNECTIONS,
      ),
    ).toEqual([
      { connectionId: nas, kind: "sftp" },
      { connectionId: ad, kind: "rdp" },
      { connectionId: nas, kind: "ssh" },
    ]);
  });
});
```

### `e2e/restore-tabs.spec.ts`

```ts
// T60: the tabs of last time are offered on the home screen, then reopened in the same order.
// Mock: a reload of the page plays a restart; "Reopen tabs at startup" is "Ask".
import { expect, test } from "./support/test.ts";

test("after a restart, the home screen offers to reopen the tabs, in order", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^nas/ }).first().dblclick();
  await page.getByRole("button", { name: /^pi-hole/ }).first().dblclick();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.waitForTimeout(800);

  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await page.getByRole("button", { name: "Reopen 2 tabs" }).click();
  await expect(page.getByRole("tab")).toHaveText([/nas/, /pi-hole/]);
  await expect(page.getByRole("button", { name: "Reopen 2 tabs" })).toHaveCount(0);
});

test("a quick connection is never kept, and Dismiss hides the offer", async ({ page }) => {
  await page.goto("/");
  const quick = page.getByPlaceholder("user@host[:port] — quick connect");
  await quick.fill("root@unreachable.test");
  await quick.press("Enter");
  await page.getByRole("button", { name: /^nas/ }).first().dblclick();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.waitForTimeout(800);

  await page.reload();
  await expect(page.getByRole("button", { name: "Reopen 1 tab" })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("button", { name: /^Reopen/ })).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("the setting lists Never, Ask and Always", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await settings.getByRole("combobox", { name: "Reopen tabs at startup" }).click();
  for (const option of ["Never", "Ask", "Always"]) {
    await expect(page.getByRole("option", { name: option, exact: true })).toBeVisible();
  }
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T60`.
2. `store/tabs.rs`, `model/settings.rs`, commandes, `lib.rs` : `cd src-tauri && cargo test --lib store commands`,
   puis `npm run bindings`.
3. `restore-tabs.ts`, `ipc.ts`, mock : `npx vitest run src/features/sessions src/lib`.
4. Enregistrement, accueil, Paramètres, textes :
   `npx playwright test e2e/restore-tabs.spec.ts e2e/home.spec.ts e2e/settings.spec.ts`.
5. `npm run format`, `npm run review`, cases, statut, commit `feat: offer to reopen last time's tabs at startup (T60)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T60 --check` affiche `OK` partout.
- [x] `grep -c "tabs_load\|tabs_save" src-tauri/src/lib.rs` compte les deux commandes.
- [x] Aucune nouvelle exception `project-rules: allow`.
- [x] Sur l'accueil, l'offre de réouverture tient sur une ligne, au-dessus des favoris, sans décaler le champ de
  connexion rapide (à l'écran).

## À regarder par Florian

`npm run tauri dev` : ouvre trois onglets (dont un SFTP), quitte TunL, relance : l'accueil propose « Rouvrir 3
onglets ». Passe le réglage à « Toujours » : au lancement suivant, ils s'ouvrent seuls. `cat ~/.config/tunl/tabs.json`
ne contient que des identifiants.
