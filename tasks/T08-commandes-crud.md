# T08 — Commandes CRUD (connexions, groupes, réglages), `ipc.ts` et mock

| | |
|---|---|
| **Jalon** | M1 — Connexions |
| **Dépend de** | T07 |
| **Lire avant** | `AGENTS.md` (« Fiches contrat »), `docs/01-architecture.md` §4 et §9, `docs/05-modele-donnees.md` §2 à §5 |
| **Livrable** | 15 commandes Tauri, leur pendant typé dans `ipc.ts` et dans le mock, 10 tests Rust et 14 tests TS verts |

## Pourquoi

Le frontend doit pouvoir lire et modifier les connexions, les groupes et les réglages. La logique vit dans des
**fonctions pures** sur `Store`, testées sans Tauri. Les commandes ne font que verrouiller, appeler, persister et
remplacer. Le mock reproduit ce comportement pour que l'UI (T09 à T11) se développe et se teste dans le navigateur.

## Contrat — Rust

### Opérations pures : `src-tauri/src/store/ops.rs`

```rust
impl Store {
    pub fn create_connection(&self, input: &ConnectionInput, id: Uuid, now_ms: i64) -> AppResult<(Store, Connection)>;
    pub fn update_connection(&self, id: Uuid, input: &ConnectionInput, now_ms: i64) -> AppResult<(Store, Connection)>;
    pub fn duplicate_connection(&self, id: Uuid, new_id: Uuid, now_ms: i64) -> AppResult<(Store, Connection)>;
    pub fn delete_connection(&self, id: Uuid) -> AppResult<Store>;
    pub fn set_favorite(&self, id: Uuid, favorite: bool, now_ms: i64) -> AppResult<(Store, Connection)>;
    pub fn touch_connection(&self, id: Uuid, now_ms: i64) -> AppResult<(Store, Connection)>;
    pub fn create_group(&self, input: &GroupInput, id: Uuid) -> AppResult<(Store, Group)>;
    pub fn update_group(&self, id: Uuid, input: &GroupInput) -> AppResult<(Store, Group)>;
    pub fn delete_group(&self, id: Uuid) -> AppResult<Store>;
    pub fn reorder_groups(&self, ids: &[Uuid]) -> AppResult<Store>;
}
```

Règles :
- `&self` n'est **jamais** modifié : chaque opération renvoie un nouveau `Store`.
- Création et modification passent par `normalize_connection_input` / `normalize_group_input` (T06), avec
  `self_id` renseigné pour une modification.
- Id inconnu → `AppError::not_found("connection <id>")` (ou `"group <id>"`).
- `update_connection` : `Connection::with_input` (garde `id`, `created_at`, `last_connected_at`). `updated_at` = `now_ms`.
- `duplicate_connection` :
  - nom `"<nom> (2)"`, ou le premier `(n)` libre ; si le résultat dépasse 80 caractères, le nom d'origine est
    raccourci pour que le total fasse 80 ;
  - `favorite: false`, `last_connected_at: None`, `created_at = updated_at = now_ms` ;
  - les secrets ne sont pas copiés (T12 n'aura rien à faire ici).
- `delete_connection` : refus si la connexion sert de bastion. Erreur `ErrorKind::InUse`, message
  `"connection is used as a jump host"`, détail `ErrorDetail::InUse { names }` trié par nom.
- `set_favorite` met à jour `updated_at`. `touch_connection` met seulement `last_connected_at = Some(now_ms)` :
  se connecter n'est pas une modification.
- `delete_group` : les connexions du groupe passent à `group_id: None`, **sans** toucher `updated_at`.
- `reorder_groups` : `ids` doit contenir chaque groupe **exactement une fois**. Sinon
  `AppError::validation("ids", "must list every group exactly once")`.

### Commandes Tauri

| Fichier | Commande | Arguments (JS) | Retour |
|---|---|---|---|
| `commands/store.rs` | `store_load` | — | `StoreSnapshot` |
| | `connection_templates` | — | `ConnectionTemplates` |
| `commands/connections.rs` | `connection_create` | `{ input }` | `Connection` |
| | `connection_update` | `{ id, input }` | `Connection` |
| | `connection_duplicate` | `{ id }` | `Connection` |
| | `connection_delete` | `{ id }` | `null` |
| | `connection_set_favorite` | `{ id, favorite }` | `Connection` |
| | `connection_touch` | `{ id }` | `Connection` |
| `commands/groups.rs` | `group_create` | `{ input }` | `Group` |
| | `group_update` | `{ id, input }` | `Group` |
| | `group_delete` | `{ id }` | `StoreSnapshot` (les connexions ont changé aussi) |
| | `group_reorder` | `{ ids }` | `Group[]` |
| `commands/settings.rs` | `settings_get` | — | `Settings` |
| | `settings_update` | `{ settings }` | `Settings` (normalisés) |

Deux nouveaux types exportés par ts-rs (à ajouter à `docs/05-modele-donnees.md` §8 par l'orchestrateur, pas par toi) :

```rust
pub struct StoreSnapshot { pub groups: Vec<Group>, pub connections: Vec<Connection>, pub quarantined: Vec<String> }
pub struct ConnectionTemplates { pub ssh: ConnectionInput, pub rdp: ConnectionInput, pub wol: WolConfig }
```

`quarantined` liste les fichiers mis en quarantaine au démarrage (store **et** réglages). L'UI l'affichera en T09.
`ConnectionTemplates` donne au frontend les valeurs par défaut sans qu'il les réinvente
(`ConnectionInput::template`, `WolConfig::default`).

### `AppState` et démarrage

```rust
pub struct AppState {
    pub paths: AppPaths,
    pub started_at_ms: i64,
    pub store: tokio::sync::RwLock<Store>,
    /// Set when connections.json could not be loaded (newer TunL, I/O error): every store command returns it,
    /// and nothing is ever written over that file.
    pub store_blocked: Option<AppError>,
    pub settings: tokio::sync::RwLock<Settings>,
    pub quarantined: Vec<String>,
}
```

Dans `setup()` : `load_store` et `load_settings` avec `clock::now_ms()`.
- `load_store` en erreur → `log::error!`, `store_blocked = Some(erreur)`, store vide.
- `load_settings` en erreur → `log::warn!`, réglages par défaut.

Toute mutation suit ce modèle. Le verrou d'écriture est gardé **jusqu'au remplacement** : deux commandes
simultanées ne peuvent pas se marcher dessus.

```rust
async fn mutate<T>(state: &AppState, change: impl FnOnce(&Store) -> AppResult<(Store, T)>) -> AppResult<T> {
    if let Some(error) = &state.store_blocked {
        return Err(error.clone());
    }
    let mut current = state.store.write().await;
    let (next, output) = change(&current)?;
    save_store(&state.paths.config_dir, &next)?;
    *current = next;
    Ok(output)
}
```

Journaux : `log::info!("connection created: {name}")`, etc. Noms autorisés, jamais de secret (il n'y en a pas ici).

## Contrat — TypeScript

### `src/lib/ipc.ts`

Une fonction par commande, en camelCase, avec les types de `src/bindings/` :
`storeLoad`, `connectionTemplates`, `connectionCreate(input)`, `connectionUpdate(id, input)`, `connectionDuplicate(id)`,
`connectionDelete(id)` (→ `Promise<void>`), `connectionSetFavorite(id, favorite)`, `connectionTouch(id)`,
`groupCreate(input)`, `groupUpdate(id, input)`, `groupDelete(id)`, `groupReorder(ids)`, `settingsGet()`,
`settingsUpdate(settings)`.

### `src/features/connections/to-input.ts`

```ts
/** The editable part of a connection (drops id and timestamps). Written field by field, no rest spread. */
export function toInput(connection: Connection): ConnectionInput;
```

Écrire chaque champ explicitement : si un champ est ajouté plus tard, TypeScript signalera l'oubli.

### Le mock

Découpage (le fichier unique dépasserait 400 lignes) :

```
src/lib/ipc-mock.ts        mockInvoke, resetMockBackend, failNextCall (point d'entrée, importé par ipc.ts)
src/lib/mock/data.ts       données de départ + réglages et modèles par défaut
src/lib/mock/connections.ts, groups.ts, settings.ts   gestionnaires par domaine
```

- **Données de départ** : les 3 groupes et les 11 connexions de `src/features/shell/demo-data.ts`, **mêmes noms, hôtes,
  ports, utilisateurs, groupes, étiquettes, favoris et dates**, convertis en vrais `Group` et `Connection` :
  - ids : UUID fixes et lisibles, exportés dans `MOCK_IDS` (ex. `MOCK_IDS.web01`) ;
  - `jumpHostName: "bastion-01"` devient `jumpHostId: MOCK_IDS.bastion01` (web-01, web-02, db-prod) ;
  - `status` disparaît : ce n'est pas une donnée stockée (sondes en T30) ;
  - `settings` part des modèles : SSH avec `{ method: "key", path: "~/.ssh/id_ed25519" }` pour db-prod,
    `{ method: "agent" }` pour les autres ; RDP avec les défauts ;
  - `win-desktop` reçoit `wol: { mac: "52:54:00:12:34:56", broadcast: "192.168.1.255", port: 9, wakeBeforeConnect: true, waitTimeoutSecs: 120 }`.
    Les autres ont `wol: null`.
- **État** : un objet en mémoire, **remplacé** (jamais modifié) à chaque mutation. `resetMockBackend()` remet les
  données de départ et les réglages par défaut.
- **Comportement** : le même que les opérations Rust ci-dessus pour tout ce que testent les tests du contrat :
  - suffixe `(n)` ;
  - `inUse` avec les noms triés ;
  - dégroupement ;
  - unicité des noms de groupe sans tenir compte de la casse ;
  - `trim` du nom ;
  - nom ou hôte vide → `{ kind: "validation", message: "name: must not be empty" }` (ou `host: …`).

  Le mock ne reproduit **pas** toute la validation Rust : c'est la validation zod de l'éditeur qui la couvre côté UI.
- `failNextCall(command, error)` : le **prochain** appel à `command` est rejeté avec `error`, puis tout redevient
  normal. `resetMockBackend()` annule un échec programmé.
- Ids : `crypto.randomUUID()`. Dates : `Date.now()`.

## Tests du contrat

### `src-tauri/src/store/ops_tests.rs` (à l'identique ; déclaré dans `store/mod.rs` par `#[cfg(test)] mod ops_tests;`)

```rust
use uuid::Uuid;

use super::Store;
use crate::error::{ErrorDetail, ErrorKind};
use crate::model::{ConnectionInput, GroupInput, Protocol};

fn ssh(name: &str) -> ConnectionInput {
    ConnectionInput {
        name: name.into(),
        host: "10.0.0.1".into(),
        ..ConnectionInput::template(Protocol::Ssh)
    }
}

fn group(name: &str) -> GroupInput {
    GroupInput { name: name.into(), color: None }
}

#[test]
fn creating_validates_and_never_mutates_the_original() {
    let empty = Store::default();
    let (next, created) = empty.create_connection(&ssh("  web-01 "), Uuid::new_v4(), 10).unwrap();
    assert_eq!(created.name, "web-01");
    assert_eq!((created.created_at, created.updated_at), (10, 10));
    assert!(empty.connections.is_empty());
    assert_eq!(next.connections, [created]);
    let error = empty.create_connection(&ssh(""), Uuid::new_v4(), 10).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
}

#[test]
fn updating_keeps_the_creation_date_and_bumps_updated_at() {
    let id = Uuid::new_v4();
    let (store, _) = Store::default().create_connection(&ssh("web"), id, 10).unwrap();
    let (store, updated) = store.update_connection(id, &ssh("web-renamed"), 20).unwrap();
    assert_eq!((updated.created_at, updated.updated_at), (10, 20));
    assert_eq!(store.connections[0].name, "web-renamed");
    let missing = store.update_connection(Uuid::new_v4(), &ssh("x"), 30).unwrap_err();
    assert_eq!(missing.kind, ErrorKind::NotFound);
}

#[test]
fn duplicates_get_the_next_free_suffix_and_no_history() {
    let id = Uuid::new_v4();
    let (store, _) = Store::default().create_connection(&ssh("web"), id, 10).unwrap();
    let (store, _) = store.set_favorite(id, true, 11).unwrap();
    let (store, _) = store.touch_connection(id, 12).unwrap();
    let (store, first) = store.duplicate_connection(id, Uuid::new_v4(), 20).unwrap();
    let (store, second) = store.duplicate_connection(id, Uuid::new_v4(), 30).unwrap();
    assert_eq!(first.name, "web (2)");
    assert_eq!(second.name, "web (3)");
    assert!(!first.favorite);
    assert_eq!(first.last_connected_at, None);
    assert_eq!((first.created_at, first.updated_at), (20, 20));
    assert_eq!(store.connections.len(), 3);
}

#[test]
fn a_duplicate_name_stays_within_eighty_characters() {
    let id = Uuid::new_v4();
    let long = "x".repeat(80);
    let (store, _) = Store::default().create_connection(&ssh(&long), id, 10).unwrap();
    let (_, copy) = store.duplicate_connection(id, Uuid::new_v4(), 20).unwrap();
    assert_eq!(copy.name.chars().count(), 80);
    assert!(copy.name.ends_with(" (2)"));
}

#[test]
fn favorites_and_touch_update_the_right_fields() {
    let id = Uuid::new_v4();
    let (store, _) = Store::default().create_connection(&ssh("web"), id, 10).unwrap();
    let (store, favorite) = store.set_favorite(id, true, 20).unwrap();
    assert!(favorite.favorite);
    assert_eq!(favorite.updated_at, 20);
    let (_, touched) = store.touch_connection(id, 30).unwrap();
    assert_eq!(touched.last_connected_at, Some(30));
    assert_eq!(touched.updated_at, 20, "connecting is not an edit");
}

#[test]
fn a_bastion_in_use_cannot_be_deleted() {
    let bastion_id = Uuid::new_v4();
    let (store, _) = Store::default().create_connection(&ssh("bastion-01"), bastion_id, 10).unwrap();
    let behind = |name: &str| ConnectionInput { jump_host_id: Some(bastion_id), ..ssh(name) };
    let (store, _) = store.create_connection(&behind("web-02"), Uuid::new_v4(), 10).unwrap();
    let (store, _) = store.create_connection(&behind("web-01"), Uuid::new_v4(), 10).unwrap();
    let error = store.delete_connection(bastion_id).unwrap_err();
    assert_eq!(error.kind, ErrorKind::InUse);
    let names = vec!["web-01".to_string(), "web-02".to_string()];
    assert_eq!(error.detail.as_deref(), Some(&ErrorDetail::InUse { names }));
    assert_eq!(store.connections.len(), 3);
}

#[test]
fn deleting_a_connection_removes_only_it() {
    let id = Uuid::new_v4();
    let (store, _) = Store::default().create_connection(&ssh("a"), id, 10).unwrap();
    let (store, _) = store.create_connection(&ssh("b"), Uuid::new_v4(), 10).unwrap();
    let store = store.delete_connection(id).unwrap();
    let names: Vec<&str> = store.connections.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["b"]);
    assert_eq!(store.delete_connection(id).unwrap_err().kind, ErrorKind::NotFound);
}

#[test]
fn deleting_a_group_ungroups_its_connections() {
    let group_id = Uuid::new_v4();
    let (store, _) = Store::default().create_group(&group("Prod"), group_id).unwrap();
    let grouped = ConnectionInput { group_id: Some(group_id), ..ssh("web") };
    let (store, _) = store.create_connection(&grouped, Uuid::new_v4(), 10).unwrap();
    let store = store.delete_group(group_id).unwrap();
    assert!(store.groups.is_empty());
    assert_eq!(store.connections[0].group_id, None);
    assert_eq!(store.connections[0].updated_at, 10);
}

#[test]
fn groups_are_validated_and_renamed() {
    let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
    let (store, _) = Store::default().create_group(&group("A"), a).unwrap();
    let (store, _) = store.create_group(&group("B"), b).unwrap();
    assert_eq!(store.create_group(&group("a"), Uuid::new_v4()).unwrap_err().kind, ErrorKind::Validation);
    let (store, renamed) = store.update_group(b, &group("Beta")).unwrap();
    assert_eq!(renamed.name, "Beta");
    assert_eq!(store.groups[1].name, "Beta");
}

#[test]
fn groups_are_reordered_only_by_a_full_permutation() {
    let (a, b, c) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
    let (store, _) = Store::default().create_group(&group("A"), a).unwrap();
    let (store, _) = store.create_group(&group("B"), b).unwrap();
    let (store, _) = store.create_group(&group("C"), c).unwrap();
    let reordered = store.reorder_groups(&[c, a, b]).unwrap();
    let ids: Vec<Uuid> = reordered.groups.iter().map(|g| g.id).collect();
    assert_eq!(ids, [c, a, b]);
    assert_eq!(store.reorder_groups(&[c, a]).unwrap_err().kind, ErrorKind::Validation);
    assert_eq!(store.reorder_groups(&[c, a, a]).unwrap_err().kind, ErrorKind::Validation);
    assert_eq!(store.reorder_groups(&[c, a, b, Uuid::new_v4()]).unwrap_err().kind, ErrorKind::Validation);
}
```

### `src/lib/ipc-mock.test.ts` (à l'identique)

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { ConnectionInput } from "@/bindings/ConnectionInput";
import { toInput } from "@/features/connections/to-input";
import { ipc } from "./ipc";
import { failNextCall, resetMockBackend } from "./ipc-mock";

async function sshInput(name: string): Promise<ConnectionInput> {
  const templates = await ipc.connectionTemplates();
  return { ...templates.ssh, name, host: "10.9.9.9" };
}

async function connectionNamed(name: string) {
  const { connections } = await ipc.storeLoad();
  const found = connections.find((connection) => connection.name === name);
  if (!found) throw new Error(`no connection named ${name}`);
  return found;
}

beforeEach(() => {
  resetMockBackend();
});

describe("mock backend: store", () => {
  it("serves the demo data", async () => {
    const snapshot = await ipc.storeLoad();
    expect(snapshot.groups.map((group) => group.name)).toEqual(["Production", "Clients", "Homelab"]);
    expect(snapshot.connections).toHaveLength(11);
    expect(snapshot.quarantined).toEqual([]);
  });

  it("starts over after a reset", async () => {
    await ipc.connectionCreate(await sshInput("temp"));
    resetMockBackend();
    expect((await ipc.storeLoad()).connections).toHaveLength(11);
  });

  it("offers templates with the protocol default ports", async () => {
    const templates = await ipc.connectionTemplates();
    expect(templates.ssh.port).toBe(22);
    expect(templates.rdp.port).toBe(3389);
    expect(templates.rdp.settings.protocol).toBe("rdp");
    expect(templates.wol.broadcast).toBe("255.255.255.255");
  });
});

describe("mock backend: connections", () => {
  it("creates a connection with an id and timestamps", async () => {
    const created = await ipc.connectionCreate(await sshInput("  staging "));
    expect(created.name).toBe("staging");
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.createdAt).toBe(created.updatedAt);
    const names = (await ipc.storeLoad()).connections.map((connection) => connection.name);
    expect(names).toContain("staging");
  });

  it("rejects an empty name with a field-tagged validation error", async () => {
    await expect(ipc.connectionCreate(await sshInput("  "))).rejects.toMatchObject({
      kind: "validation",
      message: expect.stringMatching(/^name:/),
    });
  });

  it("updates a connection and keeps its creation date", async () => {
    const router = await connectionNamed("router");
    const updated = await ipc.connectionUpdate(router.id, { ...toInput(router), name: "gateway" });
    expect(updated.name).toBe("gateway");
    expect(updated.id).toBe(router.id);
    expect(updated.createdAt).toBe(router.createdAt);
  });

  it("duplicates with the next free suffix", async () => {
    const web = await connectionNamed("web-01");
    expect((await ipc.connectionDuplicate(web.id)).name).toBe("web-01 (2)");
    expect((await ipc.connectionDuplicate(web.id)).name).toBe("web-01 (3)");
  });

  it("refuses to delete a bastion that is still in use", async () => {
    const bastion = await connectionNamed("bastion-01");
    await expect(ipc.connectionDelete(bastion.id)).rejects.toMatchObject({
      kind: "inUse",
      detail: { type: "inUse", names: ["db-prod", "web-01", "web-02"] },
    });
  });

  it("favorites, touches and deletes", async () => {
    const nas = await connectionNamed("nas");
    expect((await ipc.connectionSetFavorite(nas.id, true)).favorite).toBe(true);
    expect((await ipc.connectionTouch(nas.id)).lastConnectedAt).toBeGreaterThan(0);
    await ipc.connectionDelete(nas.id);
    const names = (await ipc.storeLoad()).connections.map((connection) => connection.name);
    expect(names).not.toContain("nas");
  });

  it("keeps the demo bastion links and the Wake-on-LAN example", async () => {
    const bastion = await connectionNamed("bastion-01");
    expect((await connectionNamed("db-prod")).jumpHostId).toBe(bastion.id);
    expect((await connectionNamed("win-desktop")).wol?.mac).toBe("52:54:00:12:34:56");
    expect((await connectionNamed("nas")).wol).toBeNull();
  });
});

describe("mock backend: groups and settings", () => {
  it("deleting a group ungroups its connections", async () => {
    const { groups } = await ipc.storeLoad();
    const homelab = groups.find((group) => group.name === "Homelab");
    if (!homelab) throw new Error("Homelab missing");
    const snapshot = await ipc.groupDelete(homelab.id);
    expect(snapshot.groups.map((group) => group.name)).toEqual(["Production", "Clients"]);
    expect(snapshot.connections.find((connection) => connection.name === "nas")?.groupId).toBeNull();
  });

  it("creates, renames and reorders groups", async () => {
    const lab = await ipc.groupCreate({ name: "Lab", color: "teal" });
    await expect(ipc.groupCreate({ name: "lab", color: null })).rejects.toMatchObject({
      kind: "validation",
    });
    expect((await ipc.groupUpdate(lab.id, { name: "Lab 2", color: null })).name).toBe("Lab 2");
    const ids = (await ipc.storeLoad()).groups.map((group) => group.id).reverse();
    expect((await ipc.groupReorder(ids)).map((group) => group.id)).toEqual(ids);
  });

  it("round-trips settings", async () => {
    const settings = await ipc.settingsGet();
    expect(settings.theme).toBe("system");
    expect((await ipc.settingsUpdate({ ...settings, theme: "light" })).theme).toBe("light");
    expect((await ipc.settingsGet()).theme).toBe("light");
  });

  it("can simulate a failure on the next call only", async () => {
    failNextCall("store_load", { kind: "store", message: "boom", detail: null });
    await expect(ipc.storeLoad()).rejects.toMatchObject({ kind: "store" });
    await expect(ipc.storeLoad()).resolves.toMatchObject({ quarantined: [] });
  });
});
```

## Étapes

1. Rust : `ops_tests.rs`, puis `ops.rs`, puis `AppState` et `setup()`, puis les commandes, enregistrées dans
   `generate_handler!`.
2. `npm run bindings` : `StoreSnapshot.ts` et `ConnectionTemplates.ts` apparaissent.
3. TS : `ipc-mock.test.ts`, puis `to-input.ts`, le mock (`src/lib/mock/`), puis `ipc.ts`.
4. `npm run format`, `npm run review` (les e2e de T05b doivent rester verts : l'UI n'a pas changé), cases, statut,
   commit `feat: CRUD commands for connections, groups and settings, with mock backend (T08)`.

## Critères d'acceptation

- [ ] `npm run review` passe, avec les 10 tests de `ops_tests.rs` et les 14 tests de `ipc-mock.test.ts`.
- [ ] Les deux fichiers de tests sont identiques à la fiche (au formatage près).
- [ ] Les 15 commandes du tableau sont dans `generate_handler!`, dans `ipc.ts` et dans le mock.
- [ ] `grep -rn "invoke(" src --include=*.ts --include=*.tsx | grep -v "src/lib/ipc.ts"` est vide.
- [ ] Aucun fichier de `src/lib/mock/` ni de `src-tauri/src/commands/` ne dépasse 400 lignes.
- [ ] `cd src-tauri && cargo build` passe (l'app démarre avec un store vide si `connections.json` est absent).

## À regarder par Florian

Rien de visible : la barre latérale affiche encore les données de démonstration jusqu'à T09. Pour vérifier les
droits, lancer `npm run tauri dev` une fois, puis `ls -l ~/.config/io.github.fleorens.TunL/`. Tant que rien n'a été
modifié, aucun `connections.json` n'est créé : c'est normal.
