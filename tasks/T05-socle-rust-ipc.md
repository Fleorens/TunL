# T05 — Socle Rust, types partagés et couche IPC

| | |
|---|---|
| **Jalon** | M0 — Fondations |
| **Dépend de** | T04 |
| **Lire avant** | `docs/01-architecture.md` §4 et §9, `docs/05-modele-donnees.md` §1 et §8, `docs/06-securite.md` S7 et S9 |
| **Livrable** | le squelette du backend (erreurs, chemins 0700, état, journaux, instance unique, mémoire de la fenêtre), la génération des types TS par ts-rs, et `lib/ipc.ts` + son mock, prouvés par une première commande `app_info` affichée dans la StatusBar |

## Contexte

Tout le reste du projet s'appuie sur cette fiche :
- **`AppError`** : chaque commande Rust le renvoie, et le frontend l'affiche de façon traduite.
- **ts-rs** : un type Rust annoté `#[ts(export)]` devient un fichier `src/bindings/<Type>.ts` à chaque `cargo test`.
  On ne recopie **jamais** un type à la main côté TS.
- **`ipc.ts`** : la seule porte vers le Rust. Dans un navigateur (`npm run dev`) et dans les tests, elle bascule sur
  `ipc-mock.ts`.

**Tout le code de cette fiche a été compilé et testé** (clippy `-D warnings` propre, 9 tests Rust et 8 tests TS verts)
le 2026-09-26. Recopie-le **tel quel**.

Pourquoi les modules Rust sont `pub mod` : `tunl_lib` est une bibliothèque. Ce qui est public n'est pas du « code
mort » pour le compilateur, alors que des éléments pas encore utilisés (variantes d'`ErrorKind`, `ErrorDetail`)
feraient échouer `clippy -D warnings` dans un module privé.

## Étapes

### 1. Dépendances Rust

Dans `src-tauri/Cargo.toml`, section `[dependencies]`, ajouter :

```toml
tauri-plugin-single-instance = "2.4"
tauri-plugin-window-state = "2.4"
tokio = { version = "1.53", features = ["rt-multi-thread", "macros", "net", "sync", "time", "io-util", "fs"] }
thiserror = "2.0"
uuid = { version = "1.26", features = ["v4", "serde"] }
ts-rs = { version = "12.0", features = ["serde-compat", "uuid-impl"] }
```

Et une nouvelle section, **avant** `[profile.release]` :

```toml
[dev-dependencies]
tempfile = "3"
```

### 2. `src-tauri/.cargo/config.toml` (nouveau)

```toml
[env]
TS_RS_EXPORT_DIR = { value = "../src/bindings", relative = true }
TS_RS_LARGE_INT = "number"
```

Sans la première ligne, les types atterrissent dans `src-tauri/bindings/`. Sans la seconde, les `i64` deviennent des
`bigint`, que JSON ne produit jamais.

### 3. `src-tauri/src/error.rs` (nouveau)

```rust
use serde::Serialize;
use ts_rs::TS;

/// Machine-readable error category. The UI translates it via `errors.kind.<kind>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ErrorKind {
    NotFound,
    Validation,
    Io,
    Store,
    Secret,
    Network,
    Timeout,
    Auth,
    HostKeyRejected,
    HostKeyChanged,
    Cancelled,
    Sftp,
    RdpClientMissing,
    Rdp,
    Wol,
    InUse,
    Internal,
}

/// Structured context for the errors the UI renders specially.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum ErrorDetail {
    HostKeyChanged {
        host: String,
        port: u16,
        key_type: String,
        fingerprint: String,
        known_hosts_path: String,
        line: u32,
    },
    InUse {
        names: Vec<String>,
    },
}

/// The error returned by every command.
///
/// `message` is English and technical. It must NEVER contain a secret (docs/06-securite.md, S7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
#[error("{kind:?}: {message}")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
    /// Boxed to keep `Result<T, AppError>` small (clippy::result_large_err).
    pub detail: Option<Box<ErrorDetail>>,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_detail(self, detail: ErrorDetail) -> Self {
        Self {
            detail: Some(Box::new(detail)),
            ..self
        }
    }

    pub fn not_found(what: impl Into<String>) -> Self {
        Self::new(ErrorKind::NotFound, what)
    }

    /// `field` is the camelCase name of the offending field, so the UI can attach the message to it.
    pub fn validation(field: &str, reason: &str) -> Self {
        Self::new(ErrorKind::Validation, format!("{field}: {reason}"))
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, message)
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::new(ErrorKind::Io, error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::new(ErrorKind::Store, error.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> Self {
        Self::internal(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_to_the_ipc_shape() {
        let value =
            serde_json::to_value(AppError::validation("host", "must not be empty")).unwrap();
        assert_eq!(
            value,
            json!({ "kind": "validation", "message": "host: must not be empty", "detail": null })
        );
    }

    #[test]
    fn serializes_details_with_camel_case_fields() {
        let error =
            AppError::new(ErrorKind::InUse, "used as jump host").with_detail(ErrorDetail::InUse {
                names: vec!["db-prod".into()],
            });
        let value = serde_json::to_value(error).unwrap();
        assert_eq!(value["kind"], "inUse");
        assert_eq!(
            value["detail"],
            json!({ "type": "inUse", "names": ["db-prod"] })
        );

        let changed = ErrorDetail::HostKeyChanged {
            host: "db.internal".into(),
            port: 22,
            key_type: "ssh-ed25519".into(),
            fingerprint: "SHA256:abc".into(),
            known_hosts_path: "/tmp/known_hosts".into(),
            line: 3,
        };
        let value = serde_json::to_value(changed).unwrap();
        assert_eq!(value["type"], "hostKeyChanged");
        assert_eq!(value["keyType"], "ssh-ed25519");
        assert_eq!(value["knownHostsPath"], "/tmp/known_hosts");
    }

    #[test]
    fn io_errors_map_to_the_io_kind() {
        let error: AppError = std::io::Error::new(std::io::ErrorKind::NotFound, "gone").into();
        assert_eq!(error.kind, ErrorKind::Io);
        assert_eq!(error.message, "gone");
    }
}
```

### 4. `src-tauri/src/clock.rs` (nouveau)

```rust
use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch (0 if the system clock is before 1970).
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}
```

### 5. `src-tauri/src/paths.rs` (nouveau)

```rust
use std::fs;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

use crate::error::{AppError, AppResult, ErrorKind};

/// Directories owned by TunL (docs/01-architecture.md §9), all kept at mode 0700.
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
}

impl AppPaths {
    pub fn resolve<R: Runtime>(app: &AppHandle<R>) -> AppResult<Self> {
        let resolver = app.path();
        let unresolved = |what: &str, error: tauri::Error| {
            AppError::new(
                ErrorKind::Io,
                format!("cannot resolve the {what} directory: {error}"),
            )
        };
        Ok(Self {
            config_dir: resolver
                .app_config_dir()
                .map_err(|e| unresolved("config", e))?,
            data_dir: resolver.app_data_dir().map_err(|e| unresolved("data", e))?,
            log_dir: resolver.app_log_dir().map_err(|e| unresolved("log", e))?,
        })
    }

    pub fn ensure_created(&self) -> AppResult<()> {
        for dir in [&self.config_dir, &self.data_dir, &self.log_dir] {
            ensure_private_dir(dir)?;
        }
        Ok(())
    }
}

/// Creates `dir` (and its parents) if needed, then forces mode 0700 on it (docs/06-securite.md, S9).
pub fn ensure_private_dir(dir: &Path) -> AppResult<()> {
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)?;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mode_of(path: &Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn creates_nested_directories_with_mode_0700() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("a/b/c");
        ensure_private_dir(&dir).unwrap();
        assert!(dir.is_dir());
        assert_eq!(mode_of(&dir), 0o700);
    }

    #[test]
    fn tightens_an_existing_directory() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("loose");
        fs::create_dir(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        ensure_private_dir(&dir).unwrap();
        assert_eq!(mode_of(&dir), 0o700);
    }
}
```

### 6. `src-tauri/src/state.rs` (nouveau)

```rust
use crate::paths::AppPaths;

/// Shared backend state, registered with `app.manage()` during setup.
pub struct AppState {
    pub paths: AppPaths,
    pub started_at_ms: i64,
}
```

### 7. `src-tauri/src/commands/mod.rs` et `src-tauri/src/commands/app.rs` (nouveaux)

`commands/mod.rs` :

```rust
pub mod app;
```

`commands/app.rs` :

```rust
use serde::Serialize;
use tauri::{AppHandle, State};
use ts_rs::TS;

use crate::error::AppResult;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub identifier: String,
    pub tauri_version: String,
    pub config_dir: String,
    pub data_dir: String,
    pub log_dir: String,
    pub started_at_ms: i64,
}

#[tauri::command]
pub async fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppResult<AppInfo> {
    let package = app.package_info();
    Ok(AppInfo {
        name: package.name.clone(),
        version: package.version.to_string(),
        identifier: app.config().identifier.clone(),
        tauri_version: tauri::VERSION.to_string(),
        config_dir: state.paths.config_dir.display().to_string(),
        data_dir: state.paths.data_dir.display().to_string(),
        log_dir: state.paths.log_dir.display().to_string(),
        started_at_ms: state.started_at_ms,
    })
}
```

### 8. `src-tauri/src/lib.rs` (remplace)

```rust
pub mod clock;
pub mod commands;
pub mod error;
pub mod paths;
pub mod state;

use tauri::Manager;

use crate::paths::AppPaths;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    tauri::Builder::default()
        // Must stay the first plugin: a second launch focuses the running window instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log_level)
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let paths = AppPaths::resolve(app.handle())?;
            paths.ensure_created()?;
            log::info!(
                "TunL {} starting (config: {})",
                app.package_info().version,
                paths.config_dir.display()
            );
            app.manage(AppState {
                paths,
                started_at_ms: clock::now_ms(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::app::app_info])
        .run(tauri::generate_context!())
        .expect("error while running TunL");
}

fn focus_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        log::warn!("second launch: main window not found");
        return;
    };
    if let Err(error) = window.unminimize() {
        log::warn!("cannot unminimize the main window: {error}");
    }
    if let Err(error) = window.set_focus() {
        log::warn!("cannot focus the main window: {error}");
    }
}
```

Les plugins n'ont besoin d'aucune permission dans `capabilities/default.json` : ils ne sont pas appelés depuis le JS.
**Ne pas modifier ce fichier.**

### 9. Générer les types TypeScript

```bash
cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings && cd ..
npm run bindings
ls src/bindings        # AppError.ts  AppInfo.ts  ErrorDetail.ts  ErrorKind.ts
```

Les fichiers de `src/bindings/` **sont commités** : le frontend en dépend pour compiler.

### 10. Textes des erreurs (i18n)

Ajouter à `en.json` :

```json
"errors": {
  "kind": {
    "notFound": "Not found",
    "validation": "Invalid value",
    "io": "File system error",
    "store": "Your connections could not be read or saved",
    "secret": "Keyring error",
    "network": "Connection failed",
    "timeout": "Timed out",
    "auth": "Authentication failed",
    "hostKeyRejected": "Host key rejected",
    "hostKeyChanged": "The server's host key has changed",
    "cancelled": "Cancelled",
    "sftp": "File transfer error",
    "rdpClientMissing": "No RDP client found",
    "rdp": "RDP error",
    "wol": "Wake-on-LAN error",
    "inUse": "Still in use",
    "internal": "Unexpected error"
  }
}
```

Et à `fr.json` :

```json
"errors": {
  "kind": {
    "notFound": "Introuvable",
    "validation": "Valeur invalide",
    "io": "Erreur du système de fichiers",
    "store": "Impossible de lire ou d'enregistrer vos connexions",
    "secret": "Erreur du trousseau",
    "network": "Échec de la connexion",
    "timeout": "Délai dépassé",
    "auth": "Échec de l'authentification",
    "hostKeyRejected": "Clé d'hôte refusée",
    "hostKeyChanged": "La clé d'hôte du serveur a changé",
    "cancelled": "Annulé",
    "sftp": "Erreur de transfert de fichiers",
    "rdpClientMissing": "Aucun client RDP trouvé",
    "rdp": "Erreur RDP",
    "wol": "Erreur Wake-on-LAN",
    "inUse": "Encore utilisé",
    "internal": "Erreur inattendue"
  }
}
```

Ajouter aussi dans l'objet `statusbar` existant :
- en : `"version": "v{{version}}"` et `"mockBackend": "Mock backend"` ;
- fr : `"version": "v{{version}}"` et `"mockBackend": "Backend simulé"`.

### 11. `src/lib/ipc-mock.ts` (nouveau)

```ts
import type { AppError } from "@/bindings/AppError";
import type { AppInfo } from "@/bindings/AppInfo";

type Args = Record<string, unknown> | undefined;
type Handler = (args: Args) => unknown;

const MOCK_LATENCY_MS = 120;

const MOCK_APP_INFO: AppInfo = {
  name: "TunL",
  version: "0.1.0-mock",
  identifier: "io.github.fleorens.TunL",
  tauriVersion: "mock",
  configDir: "~/.config/io.github.fleorens.TunL",
  dataDir: "~/.local/share/io.github.fleorens.TunL",
  logDir: "~/.local/share/io.github.fleorens.TunL/logs",
  startedAtMs: Date.now(),
};

/** One entry per Rust command (same snake_case name). Keep in sync with lib/ipc.ts. */
const HANDLERS: Readonly<Record<string, Handler>> = {
  app_info: () => MOCK_APP_INFO,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Browser-only fake backend used by `npm run dev` outside Tauri, and by the tests. */
export async function mockInvoke<T>(command: string, args?: Args): Promise<T> {
  await delay(import.meta.env.MODE === "test" ? 0 : MOCK_LATENCY_MS);
  const handler = HANDLERS[command];
  if (!handler) {
    const error: AppError = {
      kind: "internal",
      message: `mock backend: command "${command}" is not implemented`,
      detail: null,
    };
    throw error;
  }
  return handler(args) as T;
}
```

### 12. `src/lib/ipc.ts` (nouveau)

```ts
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppInfo } from "@/bindings/AppInfo";
import { mockInvoke } from "./ipc-mock";

type Args = Record<string, unknown>;

/** False inside the Tauri window; true in a plain browser (`npm run dev`) and in tests. */
export const isMockBackend = !isTauri();

function call<T>(command: string, args?: Args): Promise<T> {
  return isMockBackend ? mockInvoke<T>(command, args) : invoke<T>(command, args);
}

/**
 * The ONLY door to the Rust backend: one typed function per command (docs/01-architecture.md §4.3).
 * Every call rejects with an AppError-shaped value; normalize it with `toAppError`.
 */
export const ipc = {
  appInfo: () => call<AppInfo>("app_info"),
};
```

### 13. `src/lib/errors.ts` (nouveau)

`toAppError` normalise tout ce qu'un appel `ipc` peut rejeter. `notifyError` est le helper que **toutes** les fiches
suivantes utiliseront dans leurs `catch`.

```ts
import { toast } from "sonner";
import type { AppError } from "@/bindings/AppError";
import type { ErrorKind } from "@/bindings/ErrorKind";
import { i18n } from "@/i18n";

// A Record forces this list to stay exhaustive: adding a kind in Rust breaks the build here.
const KNOWN_KINDS: Record<ErrorKind, true> = {
  notFound: true,
  validation: true,
  io: true,
  store: true,
  secret: true,
  network: true,
  timeout: true,
  auth: true,
  hostKeyRejected: true,
  hostKeyChanged: true,
  cancelled: true,
  sftp: true,
  rdpClientMissing: true,
  rdp: true,
  wol: true,
  inUse: true,
  internal: true,
};

export function isErrorKind(value: unknown): value is ErrorKind {
  return typeof value === "string" && Object.hasOwn(KNOWN_KINDS, value);
}

/** Normalizes anything an ipc call can reject with (Rust AppError, JS Error, string…) into an AppError. */
export function toAppError(error: unknown): AppError {
  if (typeof error === "object" && error !== null && "kind" in error && "message" in error) {
    const { kind, message } = error;
    if (isErrorKind(kind) && typeof message === "string") {
      const detail = "detail" in error ? (error.detail as AppError["detail"]) : null;
      return { kind, message, detail: detail ?? null };
    }
  }
  if (error instanceof Error) {
    return { kind: "internal", message: error.message, detail: null };
  }
  return { kind: "internal", message: String(error), detail: null };
}

/** Shows a translated error toast for anything an ipc call rejected with, and returns the normalized error. */
export function notifyError(error: unknown): AppError {
  const appError = toAppError(error);
  toast.error(i18n.t(`errors.kind.${appError.kind}`), { description: appError.message });
  return appError;
}
```

Grâce aux clés typées (T03), `` i18n.t(`errors.kind.${appError.kind}`) `` ne compile que si **chaque** `ErrorKind`
a sa traduction (vérifié : retirer `wol` de `en.json` casse `npm run typecheck`).

### 14. Afficher la version dans la StatusBar

Dans `src/features/shell/StatusBar.tsx`, à l'extrême droite de la barre (après les infos de session), afficher :
- `t("statusbar.version", { version })` en `text-subtle-foreground`, une fois la version reçue ;
- si `isMockBackend`, avant la version, un `Badge variant="outline"` avec `t("statusbar.mockBackend")`.

Chargement (au montage, une seule fois) :

```tsx
const [version, setVersion] = useState<string | null>(null);

useEffect(() => {
  let cancelled = false;
  ipc
    .appInfo()
    .then((info) => {
      if (!cancelled) setVersion(info.version);
    })
    .catch((error: unknown) => {
      if (!cancelled) notifyError(error);
    });
  return () => {
    cancelled = true;
  };
}, []);
```

### 15. Tests TypeScript

**`src/lib/ipc.test.ts`** (nouveau) :

```ts
import { describe, expect, it } from "vitest";
import { toAppError } from "./errors";
import { ipc, isMockBackend } from "./ipc";
import { mockInvoke } from "./ipc-mock";

describe("ipc (mock backend)", () => {
  it("uses the mock outside Tauri", () => {
    expect(isMockBackend).toBe(true);
  });
  it("answers app_info", async () => {
    await expect(ipc.appInfo()).resolves.toMatchObject({ name: "TunL", version: "0.1.0-mock" });
  });
  it("rejects unknown commands with an internal AppError", async () => {
    await expect(mockInvoke("nope")).rejects.toMatchObject({ kind: "internal" });
  });
});

describe("toAppError", () => {
  it("keeps a backend AppError", () => {
    expect(toAppError({ kind: "timeout", message: "tcp", detail: null })).toEqual({
      kind: "timeout",
      message: "tcp",
      detail: null,
    });
  });
  it("wraps a JS Error", () => {
    expect(toAppError(new Error("boom"))).toEqual({
      kind: "internal",
      message: "boom",
      detail: null,
    });
  });
  it("rejects an unknown kind", () => {
    expect(toAppError({ kind: "weird", message: "x" }).kind).toBe("internal");
  });
  it("stringifies anything else", () => {
    expect(toAppError("plain")).toEqual({ kind: "internal", message: "plain", detail: null });
  });
});
```

Dans **`src/App.test.tsx`**, ajouter : `expect(await screen.findByText("v0.1.0-mock")).toBeInTheDocument();`
(le test devient `async`).

### 16. Vérifier, y compris la CSP de production

```bash
npm run format && npm run verify
npm run tauri build -- --no-bundle      # binaire de release, 3 à 8 minutes
./src-tauri/target/release/tunl         # Florian vérifie l'affichage, puis ferme la fenêtre
```

Le binaire de release applique la **CSP stricte** (`docs/06-securite.md` §3). Si l'interface s'affiche sans police,
sans style ou vide, la CSP bloque quelque chose : **ARRÊTE** et décris ce que tu vois, sans modifier la CSP.

Contrôle des permissions (S9) :

```bash
stat -c '%a %n' ~/.config/io.github.fleorens.TunL ~/.local/share/io.github.fleorens.TunL
# attendu : 700 pour chacun
```

### 17. Commit

```bash
git add -A && git commit -m "feat: Rust foundation, ts-rs bindings and typed IPC layer (T05)"
```

## Critères d'acceptation

- [x] `npm run verify` passe : au moins 9 tests Rust (dont les 4 `export_bindings_*`) et tous les tests TS.
- [x] `src/bindings/` contient `AppError.ts`, `AppInfo.ts`, `ErrorDetail.ts` et `ErrorKind.ts`, et `AppInfo.ts`
      déclare `startedAtMs: number` (pas `bigint`).
- [x] `grep -rn "invoke(" src --include=*.ts --include=*.tsx | grep -v "src/lib/ipc.ts"` est vide.
- [ ] Dans un navigateur sur `http://localhost:1420` (`npm run dev`), la StatusBar affiche « Mock backend » et
      `v0.1.0-mock`.
- [ ] Dans `npm run tauri dev`, la StatusBar affiche `v0.1.0`, **sans** badge « Mock backend ».
- [ ] Relancer l'app alors qu'elle tourne déjà ramène la fenêtre existante au premier plan, sans en ouvrir une seconde.
- [ ] La fenêtre retrouve sa taille et sa position d'un lancement à l'autre.
- [ ] Le binaire de release s'affiche correctement (même rendu qu'en dev).
- [x] Les dossiers de configuration et de données sont en `700`.

## À regarder par Florian

1. `npm run tauri dev` : « v0.1.0 » en bas à droite.
2. Relancer `npm run tauri dev` dans un second terminal : la première fenêtre revient au premier plan.
3. `./src-tauri/target/release/tunl` : l'app de release a exactement la même allure (polices, couleurs).
   C'est la preuve que la CSP stricte ne casse rien.
