# T12 — Trousseau (oo7) : `secret_set` / `secret_has` / `secret_delete` et secrets dans l'éditeur

| | |
|---|---|
| **Jalon** | M1 — Connexions |
| **Dépend de** | T11 |
| **Lire avant** | `docs/06-securite.md` §2 (S1, S2, S3, S5, S7, S8), `docs/05-modele-donnees.md` §7, `docs/02-decisions.md` D05 |
| **Livrable** | Module `secrets.rs` + 3 commandes, leur pendant dans `ipc.ts` et le mock, champs de secret dans l'onglet Authentification ; 10 tests Rust (dont 1 `#[ignore]`), 3 tests IPC, 16 tests TS et 4 scénarios e2e verts |

## Pourquoi

Un mot de passe ou une passphrase ne doit vivre que dans le trousseau du système (S1). Le frontend peut **écrire**,
**tester la présence** et **supprimer** un secret, jamais le **lire** (S2) : c'est le Rust qui le lira au moment de se
connecter (T18). Dans l'éditeur, l'utilisateur voit si un secret est enregistré, peut le remplacer ou l'oublier, et
rien ne part vers le trousseau avant « Save ».

## À réutiliser (ne pas réécrire)

- Rust : `AppError::new(ErrorKind::Secret, …)`, `AppError::validation`, `AppError::not_found` (`error.rs`) ;
  `state.read_store()` pour trouver la connexion (`state.rs`).
- TS : `ipc` ; `toAppError`, `notifyError` (`lib/errors.ts`) ; `hasControlChars` (`editor/validation.ts`) pour
  `secretError` ; `useFormHook` (`editor/form-context.ts`) et `useWatch` pour lire protocole et méthode ;
  `FieldError` (`editor/FieldError.tsx`) ; `Input`, `Button`, `Skeleton` de `components/ui`.
- Mock : `arg`, `Handler`, `MockState`, `MOCK_IDS` (`lib/mock/data.ts`), et le style des handlers de
  `lib/mock/connections.ts` (un nouvel état, jamais de mutation).

## Contrat — Rust

### Dépendances (`src-tauri/Cargo.toml`, `[dependencies]`)

```toml
oo7 = "0.6"
zeroize = { version = "1.9", features = ["serde"] }
```

### `src-tauri/src/secrets.rs` (déclaré `pub mod secrets;` dans `lib.rs`)

```rust
pub const APPLICATION: &str = "io.github.fleorens.TunL";
pub const SECRET_MAX_CHARS: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SecretKind { Password, Passphrase }
impl SecretKind { pub fn as_str(self) -> &'static str; }            // "password" | "passphrase"

/// A secret received from the frontend or read from the keyring. Its `Debug` prints `SecretValue(***)` (S3).
#[derive(Clone, Deserialize)]
#[serde(transparent)]
pub struct SecretValue(Zeroizing<String>);
impl SecretValue {
    pub fn new(value: impl Into<String>) -> Self;
    pub fn expose(&self) -> &str;
}

/// Non-empty, at most SECRET_MAX_CHARS characters, no control character (S5: it may end up on a FreeRDP line).
/// Errors: AppError::validation("value", "must not be empty" | "is too long" | "must not contain control characters").
pub fn validate_secret(value: &SecretValue) -> AppResult<()>;

/// Label shown in KWallet / Seahorse: "TunL — web-01 (password)".
pub fn secret_label(connection_name: &str, kind: SecretKind) -> String;

pub enum SecretStore {
    Keyring(tokio::sync::OnceCell<oo7::Keyring>),
    Memory(tokio::sync::Mutex<HashMap<(Uuid, SecretKind), SecretValue>>),
}
impl SecretStore {
    pub fn keyring() -> Self;   // connects to the Secret Service on FIRST USE, never at startup
    pub fn memory() -> Self;    // tests, and nothing else
    pub async fn set(&self, connection: Uuid, connection_name: &str, kind: SecretKind, value: &SecretValue) -> AppResult<()>;
    pub async fn has(&self, connection: Uuid, kind: SecretKind) -> AppResult<bool>;
    pub async fn get(&self, connection: Uuid, kind: SecretKind) -> AppResult<Option<SecretValue>>; // Rust only (T18)
    pub async fn delete(&self, connection: Uuid, kind: SecretKind) -> AppResult<()>;              // absent → Ok
    pub async fn delete_all(&self, connection: Uuid) -> AppResult<()>;                            // both kinds
}
```

Backend `Keyring` (API d'oo7 0.6 **vérifiée** par l'orchestrateur contre KWallet, `ksecretd`) :
- `oo7::Keyring::new().await` dans `OnceCell::get_or_try_init`. Échec → `AppError::new(ErrorKind::Secret, "system keyring unavailable")`,
  et `log::warn!` avec l'erreur d'oo7. Toute autre erreur d'oo7 → `ErrorKind::Secret`, `"keyring operation failed"`.
- Attributs : un tableau `[("application", APPLICATION), ("connection", id.as_str()), ("kind", kind.as_str())]`, où
  `id = connection.to_string()` (les deux éléments d'un couple doivent avoir le même type : tout en `&str`).
  `delete_all` passe les deux premiers seulement : oo7 supprime alors toutes les sortes d'un coup (vérifié).
- `set` : `if keyring.is_locked().await? { keyring.unlock().await?; }`, puis
  `keyring.create_item(&label, &attrs, value.expose().as_bytes(), true)`. Le `true` **remplace** l'entrée existante (vérifié).
- `has` : `!keyring.search_items(&attrs).await?.is_empty()`, sans déverrouiller.
- `get` : déverrouille si besoin, prend le premier élément, `item.secret().await?`, puis `std::str::from_utf8` (sinon
  `ErrorKind::Secret`, `"stored secret is not valid UTF-8"`).
- `delete` et `delete_all` : `keyring.delete(&attrs)`. Supprimer un secret absent renvoie `Ok` (vérifié).

Jamais la valeur dans un log, un message d'erreur ou un `Debug` (S3, S7, S8). Log autorisé :
`log::info!("secret stored for {connection} ({})", kind.as_str())`.

### `AppState`

- Nouveau champ `pub secrets: SecretStore`.
- `AppState::from_disk(paths, now_ms, secrets: SecretStore)` : le troisième paramètre est nouveau.
- `lib.rs` passe `SecretStore::keyring()`, aussi dans l'`AppState` de repli du `setup`.
  Les tests passent `SecretStore::memory()` : **aucun test automatique ne touche le vrai trousseau**.

### Commandes : `src-tauri/src/commands/secrets.rs`

| Commande | Arguments (JS) | Retour | Règles |
|---|---|---|---|
| `secret_set` | `{ connectionId, kind, value }` | `()` | `validate_secret` d'abord ; connexion inconnue → `not_found("connection <id>")` ; le libellé prend le nom de la connexion |
| `secret_has` | `{ connectionId, kind }` | `bool` | |
| `secret_delete` | `{ connectionId, kind }` | `()` | |

Paramètres Rust : `connection_id: Uuid, kind: SecretKind, value: SecretValue` (Tauri convertit `connectionId`).
Les trois sont ajoutées à `invoke_handler()`.

`connection_delete` (T08) : après la suppression réussie, `state.secrets.delete_all(id)`. Un échec ici ne fait **pas**
échouer la commande (la connexion est déjà supprimée) : `log::warn!`.
`connection_duplicate` ne copie aucun secret (rien à faire, mais c'est testé).

## Contrat — TypeScript

- `ipc.ts` : `secretSet(connectionId, kind, value)`, `secretHas(connectionId, kind)` → `boolean`, `secretDelete(connectionId, kind)`.
- Mock (`src/lib/mock/secrets.ts`, branché dans `HANDLERS`) :
  - `MockState.secrets: string[]`, des clés `"<connectionId>:<kind>"`. **Jamais la valeur**, même dans le mock.
  - `freshState()` : un mot de passe pour `ad-01` et une passphrase pour `db-prod` (`MOCK_IDS.ad01`, `MOCK_IDS.dbProd`).
  - `secret_set` : valeur vide → `validation` (`"value: must not be empty"`) ; connexion inconnue → `notFound`.
  - `connection_delete` retire les secrets de la connexion ; `connection_duplicate` n'en copie aucun.

### `src/features/connections/editor/secret-drafts.ts` (pur, sans React)

```ts
export type SecretDraft = { action: "keep" } | { action: "set"; value: string } | { action: "forget" };
export type SecretDrafts = Readonly<Record<SecretKind, SecretDraft>>;
export type SecretOperation = { type: "set"; kind: SecretKind; value: string } | { type: "delete"; kind: SecretKind };

export const UNCHANGED_SECRETS: SecretDrafts;                       // both "keep"
export function withDraft(drafts: SecretDrafts, kind: SecretKind, draft: SecretDraft): SecretDrafts; // new object
export function typedSecret(value: string): SecretDraft;            // "" → keep, anything else → set (not trimmed)
export function secretsDirty(drafts: SecretDrafts): boolean;        // any draft other than keep
export function secretError(value: string): ValidationCode | null;  // control chars → "controlChars", > 1024 → "tooLong"
export function secretsValid(drafts: SecretDrafts): boolean;        // every "set" draft has no secretError
/** The secrets that matter for these settings: ssh+password → [password], ssh+key → [passphrase], agent → [], rdp → [password]. */
export function secretKindsFor(values: Pick<ConnectionFormValues, "protocol" | "sshAuthMethod">): SecretKind[];
/** What to run after a successful save, for the relevant kinds only, in their order. "keep" gives nothing. */
export function secretOperations(drafts: SecretDrafts, kinds: readonly SecretKind[]): SecretOperation[];
```

### `src/features/connections/editor/use-secret-status.ts`

`useSecretStatus(connectionId: string | null, kind: SecretKind): "none" | "loading" | "saved" | "unavailable"`
- `null` (création) → `"none"`, sans appel.
- Sinon `"loading"`, puis `ipc.secretHas` → `"saved"` ou `"none"`. Rejet avec `kind: "secret"` → `"unavailable"` ;
  autre rejet → `"none"` et `notifyError`. Ignorer une réponse arrivée après un changement d'id (drapeau d'annulation).

### Éditeur

- Les brouillons de secrets vivent **hors** du formulaire react-hook-form (un secret n'entre jamais dans
  `ConnectionFormValues` ni `ConnectionInput`) : un `useState<SecretDrafts>` dans `ConnectionEditor`, remis à
  `UNCHANGED_SECRETS` à chaque ouverture, transmis aux champs par un contexte React.
- « Save » est aussi désactivé si `!secretsValid(drafts)`.
- Fermer avec `secretsDirty(drafts)` demande confirmation, comme un formulaire modifié.
- Après un `create` / `update` réussi : `secretOperations(drafts, secretKindsFor(values))`, exécutées **dans l'ordre**
  (`ipc.secretSet` / `ipc.secretDelete`) avec l'id enregistré. Au premier échec : `notifyError`, on arrête. La feuille
  se ferme quand même : la connexion, elle, est enregistrée.

### Champ `SecretField` (onglet Authentification)

Placé : sous « Key path » pour une clé SSH (passphrase) ; en méthode « Password » SSH, à la place du texte
`editor.auth.passwordHint` (clé supprimée des deux langues) ; sous « Domain » en RDP (mot de passe). Rien pour l'agent.

| État | Affichage |
|---|---|
| `loading` | un `Skeleton` de la hauteur d'un champ |
| `unavailable` | texte discret « The system keyring is unavailable: TunL will ask when connecting. », pas de champ |
| `none`, ou « Replace » cliqué | `Input type="password"` `autoComplete="off"`, label « Password (optional) » ou « Key passphrase (optional) », indication « Stored in your system keyring. Leave empty to be asked when connecting. », erreur sous le champ (`secretError`) |
| `saved` + brouillon `keep` | icône `Check`, « Saved in the keyring », boutons « Replace » et « Forget » |
| brouillon `forget` | « Will be forgotten when you save », bouton « Undo » |

« Replace » affiche le champ et un bouton « Cancel » qui revient à l'état `saved` (brouillon `keep`). Taper met le
brouillon à `typedSecret(valeur)`.

### Textes (anglais exact ; en français dans `fr.json`)

| Clé | Anglais |
|---|---|
| `editor.secret.passwordLabel` | Password (optional) |
| `editor.secret.passphraseLabel` | Key passphrase (optional) |
| `editor.secret.hint` | Stored in your system keyring. Leave empty to be asked when connecting. |
| `editor.secret.saved` | Saved in the keyring |
| `editor.secret.replace` / `forget` / `undo` | Replace / Forget / Undo |
| `editor.secret.willForget` | Will be forgotten when you save |
| `editor.secret.unavailable` | The system keyring is unavailable: TunL will ask when connecting. |

### Pièges

- `Zeroizing<String>` a un `Debug` qui **affiche** la chaîne : c'est pourquoi `SecretValue` a son propre `Debug`.
- Ne pas ouvrir le trousseau au démarrage : sur une session sans Secret Service, TunL doit démarrer normalement.
- `#[tokio::test]` n'est utilisé que par le test `#[ignore]` du vrai trousseau ; les autres tests Rust sont synchrones
  ou passent par `tauri::test` (qui a son propre runtime : pas de `#[tokio::test]` dans `ipc_tests.rs`).

## Tests du contrat

### `src-tauri/src/secrets_tests.rs` (déclaré dans `lib.rs` par `#[cfg(test)] mod secrets_tests;`)

```rust
use uuid::Uuid;

use crate::error::ErrorKind;
use crate::secrets::{SecretKind, SecretStore, SecretValue, secret_label, validate_secret};

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}

#[test]
fn debug_never_shows_the_value() {
    let value = SecretValue::new("hunter2");
    assert_eq!(format!("{value:?}"), "SecretValue(***)");
    assert_eq!(value.expose(), "hunter2");
}

#[test]
fn a_secret_value_deserializes_from_a_plain_string() {
    let value: SecretValue = serde_json::from_str("\"s3cr\\u00e9t\"").unwrap();
    assert_eq!(value.expose(), "s3crét");
}

#[test]
fn validation_rejects_empty_long_and_control_characters() {
    assert!(validate_secret(&SecretValue::new("correct horse")).is_ok());
    let empty = validate_secret(&SecretValue::new("")).unwrap_err();
    assert_eq!(empty.kind, ErrorKind::Validation);
    assert_eq!(empty.message, "value: must not be empty");
    let long = validate_secret(&SecretValue::new("x".repeat(1025))).unwrap_err();
    assert_eq!(long.message, "value: is too long");
    assert!(validate_secret(&SecretValue::new("x".repeat(1024))).is_ok());
    let newline = validate_secret(&SecretValue::new("pass\nword")).unwrap_err();
    assert_eq!(newline.message, "value: must not contain control characters");
}

#[test]
fn validation_errors_never_contain_the_value() {
    let error = validate_secret(&SecretValue::new("leak\u{7}me")).unwrap_err();
    assert!(!error.message.contains("leak"));
}

#[test]
fn kinds_and_labels() {
    assert_eq!(SecretKind::Password.as_str(), "password");
    assert_eq!(SecretKind::Passphrase.as_str(), "passphrase");
    assert_eq!(serde_json::to_string(&SecretKind::Passphrase).unwrap(), "\"passphrase\"");
    assert_eq!(secret_label("web-01", SecretKind::Password), "TunL — web-01 (password)");
}

#[test]
fn memory_store_sets_replaces_and_reads() {
    let store = SecretStore::memory();
    let id = Uuid::new_v4();
    block_on(async {
        assert!(!store.has(id, SecretKind::Password).await.unwrap());
        store.set(id, "web-01", SecretKind::Password, &SecretValue::new("one")).await.unwrap();
        store.set(id, "web-01", SecretKind::Password, &SecretValue::new("two")).await.unwrap();
        assert!(store.has(id, SecretKind::Password).await.unwrap());
        assert!(!store.has(id, SecretKind::Passphrase).await.unwrap());
        let read = store.get(id, SecretKind::Password).await.unwrap().unwrap();
        assert_eq!(read.expose(), "two");
    });
}

#[test]
fn memory_store_deletes_one_kind_or_all() {
    let store = SecretStore::memory();
    let id = Uuid::new_v4();
    let other = Uuid::new_v4();
    block_on(async {
        for kind in [SecretKind::Password, SecretKind::Passphrase] {
            store.set(id, "a", kind, &SecretValue::new("x")).await.unwrap();
        }
        store.set(other, "b", SecretKind::Password, &SecretValue::new("y")).await.unwrap();
        store.delete(id, SecretKind::Password).await.unwrap();
        assert!(!store.has(id, SecretKind::Password).await.unwrap());
        assert!(store.has(id, SecretKind::Passphrase).await.unwrap());
        store.delete_all(id).await.unwrap();
        assert!(!store.has(id, SecretKind::Passphrase).await.unwrap());
        assert!(store.has(other, SecretKind::Password).await.unwrap());
    });
}

#[test]
fn deleting_an_absent_secret_is_not_an_error() {
    let store = SecretStore::memory();
    block_on(async {
        store.delete(Uuid::new_v4(), SecretKind::Passphrase).await.unwrap();
        store.delete_all(Uuid::new_v4()).await.unwrap();
    });
}

#[test]
fn get_returns_none_when_absent() {
    let store = SecretStore::memory();
    block_on(async {
        assert!(store.get(Uuid::new_v4(), SecretKind::Password).await.unwrap().is_none());
    });
}

/// Real Secret Service round trip. Never run automatically: `cargo test -- --ignored keyring_round_trip`.
#[tokio::test]
// project-rules: allow no-ignored-rust-test — touches the real Secret Service, run by hand only
#[ignore]
async fn keyring_round_trip() {
    let store = SecretStore::keyring();
    let id = Uuid::new_v4();
    store.set(id, "tunl-test", SecretKind::Password, &SecretValue::new("round-trip")).await.unwrap();
    assert!(store.has(id, SecretKind::Password).await.unwrap());
    assert_eq!(store.get(id, SecretKind::Password).await.unwrap().unwrap().expose(), "round-trip");
    store.delete_all(id).await.unwrap();
    assert!(!store.has(id, SecretKind::Password).await.unwrap());
}
```

### `src-tauri/src/commands/ipc_tests.rs` (remplace le fichier de la revue du lot 2)

```rust
//! Drives every command through Tauri's real IPC layer (`tauri::test`, `MockRuntime`), with **exactly** the
//! argument objects that `src/lib/ipc.ts` sends. The browser mock cannot catch a mismatch between a JS key and
//! a Rust parameter name: this test does. Any command added to `ipc.ts` gets a line here, or in an
//! `ipc_<domain>_tests.rs` beside this file that reuses these `pub(crate)` helpers.
use std::path::Path;

use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder, mock_context, noop_assets};
use tauri::webview::InvokeRequest;
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};

use crate::paths::AppPaths;
use crate::secrets::SecretStore;
use crate::state::AppState;

pub(crate) fn mock_app(dir: &Path) -> (tauri::App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let paths = AppPaths {
        config_dir: dir.join("config"),
        data_dir: dir.join("data"),
        log_dir: dir.join("logs"),
    };
    paths.ensure_created().unwrap();
    let state = AppState::from_disk(&paths, 1_700_000_000_000, SecretStore::memory()).unwrap();
    let app = mock_builder()
        .invoke_handler(crate::invoke_handler())
        .build(mock_context(noop_assets()))
        .unwrap();
    app.manage(state);
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    (app, webview)
}

/// `invoke(cmd, args)` as the frontend does it; the error is the serialized `AppError` (or Tauri's own message).
pub(crate) fn invoke(webview: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize::<Value>().unwrap())
}

pub(crate) fn ok(webview: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Value {
    invoke(webview, cmd, args).unwrap_or_else(|error| panic!("{cmd} failed: {error}"))
}

pub(crate) fn create_connection(webview: &WebviewWindow<MockRuntime>, name: &str) -> Value {
    let templates = ok(webview, "connection_templates", json!({}));
    let mut input = templates["ssh"].clone();
    input["name"] = json!(name);
    input["host"] = json!("10.0.0.1");
    ok(webview, "connection_create", json!({ "input": input }))
}

#[test]
fn every_command_accepts_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());

    ok(&webview, "app_info", json!({}));
    ok(&webview, "store_load", json!({}));
    let templates = ok(&webview, "connection_templates", json!({}));

    let mut input = templates["ssh"].clone();
    input["name"] = json!("web-01");
    input["host"] = json!("10.0.0.1");
    let created = ok(&webview, "connection_create", json!({ "input": input }));
    let id = created["id"].clone();

    input["name"] = json!("web-01b");
    let updated = ok(&webview, "connection_update", json!({ "id": id, "input": input }));
    assert_eq!(updated["name"], "web-01b");
    ok(&webview, "connection_set_favorite", json!({ "id": id, "favorite": true }));
    ok(&webview, "connection_touch", json!({ "id": id }));
    let copy = ok(&webview, "connection_duplicate", json!({ "id": id }));
    ok(&webview, "connection_delete", json!({ "id": copy["id"] }));

    let group = ok(&webview, "group_create", json!({ "input": { "name": "Prod", "color": null } }));
    let group_id = group["id"].clone();
    ok(&webview, "group_update", json!({ "id": group_id, "input": { "name": "Production", "color": "teal" } }));
    ok(&webview, "group_reorder", json!({ "ids": [group_id] }));
    ok(&webview, "group_delete", json!({ "id": group_id }));

    let settings = ok(&webview, "settings_get", json!({}));
    ok(&webview, "settings_update", json!({ "settings": settings }));

    ok(&webview, "secret_set", json!({ "connectionId": id, "kind": "password", "value": "hunter2" }));
    assert_eq!(ok(&webview, "secret_has", json!({ "connectionId": id, "kind": "password" })), json!(true));
    ok(&webview, "secret_delete", json!({ "connectionId": id, "kind": "password" }));
    assert_eq!(ok(&webview, "secret_has", json!({ "connectionId": id, "kind": "password" })), json!(false));

    let snapshot = ok(&webview, "store_load", json!({}));
    assert_eq!(snapshot["connections"].as_array().unwrap().len(), 1);
}

#[test]
fn a_backend_error_reaches_the_frontend_as_an_app_error() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let error = invoke(&webview, "connection_delete", json!({ "id": uuid::Uuid::new_v4() })).unwrap_err();
    assert_eq!(error["kind"], "notFound");
}

#[test]
fn secrets_follow_their_connection_and_never_reach_the_store() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let id = create_connection(&webview, "db")["id"].clone();

    let unknown = uuid::Uuid::new_v4();
    let missing = invoke(&webview, "secret_set", json!({ "connectionId": unknown, "kind": "password", "value": "x" }));
    assert_eq!(missing.unwrap_err()["kind"], "notFound");
    let empty = invoke(&webview, "secret_set", json!({ "connectionId": id, "kind": "password", "value": "" }));
    assert_eq!(empty.unwrap_err()["kind"], "validation");

    ok(&webview, "secret_set", json!({ "connectionId": id, "kind": "passphrase", "value": "hunter2" }));
    let copy = ok(&webview, "connection_duplicate", json!({ "id": id }));
    assert_eq!(ok(&webview, "secret_has", json!({ "connectionId": copy["id"], "kind": "passphrase" })), json!(false));

    let on_disk = std::fs::read_to_string(dir.path().join("config").join("connections.json")).unwrap();
    assert!(!on_disk.contains("hunter2"));
    assert!(!ok(&webview, "store_load", json!({})).to_string().contains("hunter2"));

    ok(&webview, "connection_delete", json!({ "id": id }));
    assert_eq!(ok(&webview, "secret_has", json!({ "connectionId": id, "kind": "passphrase" })), json!(false));
}
```

### `src/features/connections/editor/secret-drafts.test.ts`

```ts
import { describe, expect, test } from "vitest";
import {
  secretError,
  secretKindsFor,
  secretOperations,
  secretsDirty,
  secretsValid,
  typedSecret,
  UNCHANGED_SECRETS,
  withDraft,
} from "./secret-drafts";

describe("secret drafts", () => {
  test("typing sets a draft, clearing the field keeps the keyring as is", () => {
    expect(typedSecret("hunter2")).toEqual({ action: "set", value: "hunter2" });
    expect(typedSecret("")).toEqual({ action: "keep" });
    expect(typedSecret("  spaced  ")).toEqual({ action: "set", value: "  spaced  " });
  });

  test("withDraft returns a new object and leaves the other kind alone", () => {
    const next = withDraft(UNCHANGED_SECRETS, "password", { action: "forget" });
    expect(next).not.toBe(UNCHANGED_SECRETS);
    expect(UNCHANGED_SECRETS.password).toEqual({ action: "keep" });
    expect(next.password).toEqual({ action: "forget" });
    expect(next.passphrase).toEqual({ action: "keep" });
  });

  test("dirty as soon as one draft is not keep", () => {
    expect(secretsDirty(UNCHANGED_SECRETS)).toBe(false);
    expect(secretsDirty(withDraft(UNCHANGED_SECRETS, "passphrase", typedSecret("x")))).toBe(true);
    expect(secretsDirty(withDraft(UNCHANGED_SECRETS, "password", { action: "forget" }))).toBe(true);
  });

  test("secretError flags control characters and length", () => {
    expect(secretError("")).toBeNull();
    expect(secretError("correct horse battery staple")).toBeNull();
    expect(secretError("pass\nword")).toBe("controlChars");
    expect(secretError("tab\there")).toBe("controlChars");
    expect(secretError("x".repeat(1024))).toBeNull();
    expect(secretError("x".repeat(1025))).toBe("tooLong");
  });

  test("secretsValid checks every set draft", () => {
    expect(secretsValid(UNCHANGED_SECRETS)).toBe(true);
    expect(secretsValid(withDraft(UNCHANGED_SECRETS, "password", typedSecret("ok")))).toBe(true);
    expect(secretsValid(withDraft(UNCHANGED_SECRETS, "password", typedSecret("a\rb")))).toBe(false);
  });

  test("the kinds that matter follow the protocol and the SSH method", () => {
    expect(secretKindsFor({ protocol: "ssh", sshAuthMethod: "password" })).toEqual(["password"]);
    expect(secretKindsFor({ protocol: "ssh", sshAuthMethod: "key" })).toEqual(["passphrase"]);
    expect(secretKindsFor({ protocol: "ssh", sshAuthMethod: "agent" })).toEqual([]);
    expect(secretKindsFor({ protocol: "rdp", sshAuthMethod: "key" })).toEqual(["password"]);
  });

  test("operations only for relevant kinds, keep gives nothing", () => {
    const drafts = withDraft(
      withDraft(UNCHANGED_SECRETS, "password", typedSecret("pw")),
      "passphrase",
      { action: "forget" },
    );
    expect(secretOperations(drafts, ["password"])).toEqual([
      { type: "set", kind: "password", value: "pw" },
    ]);
    expect(secretOperations(drafts, ["passphrase"])).toEqual([{ type: "delete", kind: "passphrase" }]);
    expect(secretOperations(drafts, [])).toEqual([]);
    expect(secretOperations(UNCHANGED_SECRETS, ["password", "passphrase"])).toEqual([]);
  });
});
```

### `src/lib/mock/secrets.test.ts`

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { ipc } from "@/lib/ipc";
import { failNextCall, resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";
import { toAppError } from "@/lib/errors";

beforeEach(() => {
  resetMockBackend();
});

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return toAppError(error);
  }
  throw new Error("expected a rejection");
}

describe("mock secrets", () => {
  test("the demo data has two saved secrets", async () => {
    expect(await ipc.secretHas(MOCK_IDS.ad01, "password")).toBe(true);
    expect(await ipc.secretHas(MOCK_IDS.dbProd, "passphrase")).toBe(true);
    expect(await ipc.secretHas(MOCK_IDS.web01, "password")).toBe(false);
  });

  test("set, has, delete", async () => {
    await ipc.secretSet(MOCK_IDS.web01, "password", "hunter2");
    expect(await ipc.secretHas(MOCK_IDS.web01, "password")).toBe(true);
    await ipc.secretDelete(MOCK_IDS.web01, "password");
    expect(await ipc.secretHas(MOCK_IDS.web01, "password")).toBe(false);
  });

  test("rejects an empty value and an unknown connection", async () => {
    expect((await rejection(ipc.secretSet(MOCK_IDS.web01, "password", ""))).kind).toBe("validation");
    const unknown = "b2000000-0000-4000-8000-000000000000";
    expect((await rejection(ipc.secretSet(unknown, "password", "x"))).kind).toBe("notFound");
  });

  test("the value is never kept, even by the mock", async () => {
    await ipc.secretSet(MOCK_IDS.web01, "password", "hunter2");
    const snapshot = await ipc.storeLoad();
    expect(JSON.stringify(snapshot)).not.toContain("hunter2");
  });

  test("deleting a connection forgets its secrets, duplicating copies none", async () => {
    const copy = await ipc.connectionDuplicate(MOCK_IDS.ad01);
    expect(await ipc.secretHas(copy.id, "password")).toBe(false);
    await ipc.connectionDelete(MOCK_IDS.ad01);
    expect(await ipc.secretHas(MOCK_IDS.ad01, "password")).toBe(false);
  });

  test("a keyring failure can be simulated", async () => {
    failNextCall("secret_has", { kind: "secret", message: "system keyring unavailable", detail: null });
    expect((await rejection(ipc.secretHas(MOCK_IDS.ad01, "password"))).kind).toBe("secret");
  });
});
```

### `src/features/connections/editor/use-secret-status.test.ts`

```ts
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { failNextCall, resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";
import { useSecretStatus } from "./use-secret-status";

beforeEach(() => {
  resetMockBackend();
});

test("a connection being created has no secret, without asking the backend", () => {
  const { result } = renderHook(() => useSecretStatus(null, "password"));
  expect(result.current).toBe("none");
});

test("loading, then saved or none", async () => {
  const saved = renderHook(() => useSecretStatus(MOCK_IDS.ad01, "password"));
  expect(saved.result.current).toBe("loading");
  await waitFor(() => expect(saved.result.current).toBe("saved"));
  const none = renderHook(() => useSecretStatus(MOCK_IDS.web01, "password"));
  await waitFor(() => expect(none.result.current).toBe("none"));
});

test("a keyring error means unavailable", async () => {
  failNextCall("secret_has", { kind: "secret", message: "system keyring unavailable", detail: null });
  const { result } = renderHook(() => useSecretStatus(MOCK_IDS.ad01, "password"));
  await waitFor(() => expect(result.current).toBe("unavailable"));
});
```

### `e2e/secrets.spec.ts`

```ts
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function editor(page: Page) {
  return page.getByRole("dialog");
}

async function openAuth(page: Page, name: string) {
  await page
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
  await editor(page).getByRole("tab", { name: "Authentication" }).click();
}

test("a password typed in the editor is saved to the keyring", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await editor(page).getByLabel("Name", { exact: true }).fill("vault");
  await editor(page).getByLabel("Host", { exact: true }).fill("10.9.9.9");
  await editor(page).getByRole("tab", { name: "Authentication" }).click();
  await editor(page).getByRole("radio", { name: "Password", exact: true }).click();
  await editor(page).getByLabel("Password (optional)").fill("hunter2");
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);

  await openAuth(page, "vault");
  await expect(editor(page).getByText("Saved in the keyring")).toBeVisible();
  await expect(editor(page).getByLabel("Password (optional)")).toHaveCount(0);
  await expectSaneUi(page);
});

test("forgetting a saved password takes effect on save", async ({ page }) => {
  await openAuth(page, "ad-01");
  await editor(page).getByRole("button", { name: "Forget", exact: true }).click();
  await expect(editor(page).getByText("Will be forgotten when you save")).toBeVisible();
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);

  await openAuth(page, "ad-01");
  await expect(editor(page).getByLabel("Password (optional)")).toBeVisible();
});

test("Replace then Cancel keeps the saved passphrase", async ({ page }) => {
  await openAuth(page, "db-prod");
  await editor(page).getByRole("button", { name: "Replace", exact: true }).click();
  await expect(editor(page).getByLabel("Key passphrase (optional)")).toBeVisible();
  await expectSaneUi(page);
  await editor(page).getByRole("button", { name: "Cancel", exact: true }).first().click();
  await expect(editor(page).getByText("Saved in the keyring")).toBeVisible();
});

test("closing with a typed secret asks first", async ({ page }) => {
  await openAuth(page, "db-prod");
  await editor(page).getByRole("button", { name: "Replace", exact: true }).click();
  await editor(page).getByLabel("Key passphrase (optional)").fill("new one");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T12`.
2. Rust : `Cargo.toml`, `secrets.rs`, `AppState`, `lib.rs`, `commands/secrets.rs`, `connection_delete`, puis
   `npm run bindings` et `npm run verify:rust`. Tout le Rust doit être vert avant le TypeScript.
3. `ipc.ts`, le mock, `secret-drafts.ts`, `use-secret-status.ts`, puis `npx vitest run src/lib src/features/connections`.
4. `SecretField` et l'éditeur (contexte, Save, fermeture), les textes en / fr.
5. `npm run format`, `npm run review`, cases, statut, commit `feat: keyring secrets and editor secret fields (T12)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T12 --check` affiche `OK` partout.
- [ ] `grep -rn "secret_get" src src-tauri/src` ne trouve rien (S2).
- [ ] Aucun test automatique n'ouvre le vrai trousseau (seul `keyring_round_trip` le fait, et il est `#[ignore]`).
- [ ] Visuel : l'état « Saved in the keyring » est sur une ligne, icône verte, boutons discrets alignés à droite.

## À regarder par Florian

Dans `npm run tauri dev` : créer une connexion SSH « Password » avec un mot de passe, enregistrer, puis ouvrir KWallet
(ou `secret-tool search application io.github.fleorens.TunL`) : l'entrée « TunL — <nom> (password) » est là.
Supprimer la connexion : l'entrée disparaît. Puis `cd src-tauri && cargo test -- --ignored keyring_round_trip`.
