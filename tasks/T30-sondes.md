# T30 — Sondes de disponibilité : pastilles et latence

| | |
|---|---|
| **Jalon** | M6 — Confort |
| **Dépend de** | T09 |
| **Lire avant** | `docs/06-securite.md` S15, `docs/04-ecrans.md` §1 (« Sidebar », « StatusBar »), `docs/03-design.md` (lignes `status-*` et l'accessibilité des pastilles) |
| **Livrable** | `src-tauri/src/probe.rs`, commande `probe_check` + `ipc.probeCheck` + mock ; `src/features/reachability/` (modèle, store, scrutation, pastille) ; pastilles de la sidebar et de l'accueil branchées, latence dans la barre d'état ; 5 fichiers de tests |

## Pourquoi

Les pastilles de la sidebar et des cartes d'accueil affichent toutes « inconnu ». Cette fiche les colore : TunL tente
une connexion TCP vers le port de chaque connexion, **sans rien envoyer**, au démarrage puis à intervalle régulier.
La barre d'état montre la latence de l'hôte de l'onglet actif.

S15 fixe les règles : TCP seul, aucune donnée, délai de 2 s, 16 sondes en parallèle au plus, **jamais** vers un hôte
derrière un bastion (TunL le joindrait depuis le mauvais réseau, et révélerait son nom au DNS local). Les sondes se
désactivent dans les réglages (`reachability.enabled`, interface en T31).

Prototypé par l'orchestrateur : les tests de cette fiche passent.

## À réutiliser (ne pas réécrire)

- `StatusDot` (`src/components/StatusDot.tsx`) et son type `Status` ; les clés i18n `status.online`,
  `status.offline`, `status.unknown` existent.
- `useConnections`, `useSettings` (stores zustand) ; `notifyError` (`lib/errors.ts`).
- T08 : `AppState::get_settings()` et `get_store()` ; `ReachabilitySettings { enabled, interval_secs }` existe déjà.
- `commands/ipc_tests.rs` : `mock_app`, `ok`, `create_connection`.
- Mock : `arg` et `Handler` de `lib/mock/data.ts`, `MOCK_IDS`.

## Contrat — Rust

### `src-tauri/src/probe.rs` (nouveau ; `lib.rs` : `pub mod probe;` et `#[cfg(test)] mod probe_tests;`)

```rust
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(2);
pub const MAX_PARALLEL_PROBES: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)] #[serde(rename_all = "camelCase")] #[ts(export)]
pub enum ProbeStatus { Online, Offline, Skipped }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)] #[serde(rename_all = "camelCase")] #[ts(export)]
pub struct ProbeResult { pub connection_id: Uuid, pub status: ProbeStatus, pub latency_ms: Option<u32> }

/// TCP vers `host:port` en `timeout` au plus, fermé aussitôt. `Some(durée du connect)` si ça a répondu.
pub async fn probe(host: &str, port: u16, timeout: Duration) -> Option<Duration>;

/// Toutes les connexions, `max_parallel` à la fois, résultats dans l'ordre de `connections`.
pub async fn probe_all(connections: &[Connection], timeout: Duration, max_parallel: usize) -> Vec<ProbeResult>;
```

- `probe` : `tokio::time::timeout(timeout, TcpStream::connect((host, port)))`. Connecté → on mesure, puis on
  **lâche** le flux (rien n'est écrit). Refus, nom inconnu, réseau injoignable, délai dépassé : `None`.
- `probe_all` :
  - une connexion avec `jump_host_id` → `Skipped`, **sans aucun accès réseau** (pas de tâche lancée pour elle) ;
  - les autres : une tâche chacune (`tokio::task::JoinSet`), limitées par un `tokio::sync::Semaphore` de
    `max_parallel` jetons ;
  - `Online` avec `latency_ms` = la durée en millisecondes, sinon `Offline` et `latency_ms: None` ;
  - le résultat garde l'ordre d'entrée, quel que soit l'ordre d'arrivée des tâches. Une tâche qui échouerait compte
    comme `Offline`.
- Aucun `log::` par sonde : 16 lignes par minute ne diraient rien d'utile.

### `src-tauri/src/commands/probe.rs` (nouveau)

```rust
#[tauri::command]
pub async fn probe_check(state: State<'_, AppState>, ids: Vec<Uuid>) -> AppResult<Vec<ProbeResult>>
```

- Garde les connexions de `ids` qui existent, **dans l'ordre de `ids`** ; un id inconnu est omis de la réponse.
- `settings.reachability.enabled == false` → toutes `Skipped`, aucun accès réseau.
- Sinon `probe_all(&connexions, PROBE_TIMEOUT, MAX_PARALLEL_PROBES)`.
- `commands/mod.rs` : `pub mod probe;` et `#[cfg(test)] mod ipc_probe_tests;`. `lib.rs` : la commande dans
  `invoke_handler()`.

## Contrat — Frontend

- `npm run bindings` : `ProbeResult.ts`, `ProbeStatus.ts`.
- `src/lib/ipc.ts` : `probeCheck: (ids: string[]) => call<ProbeResult[]>("probe_check", { ids }),` (section
  `// Reachability (T30): …`).
- `src/lib/mock/probe.ts` (nouveau) : `export const MOCK_OFFLINE = ["win-desktop", "kiosk-01"];` et
  `probeHandlers` avec `probe_check` : id inconnu omis ; sondes désactivées ou connexion derrière un bastion →
  `skipped` ; nom dans `MOCK_OFFLINE` → `offline` ; sinon `online` avec `latencyMs: 2 + ((name.length * 7) % 40)`
  (fixe, pour des captures stables). `ipc-mock.ts` : `...probeHandlers`.

### `src/features/reachability/` (nouveau dossier)

| Fichier | Contenu |
|---|---|
| `reachability-model.ts` | fonctions **pures** : `dotStatus(result \| undefined): Status` (`online` → `online`, `offline` → `offline`, `skipped` ou absent → `unknown`) ; `latencyOf(result \| undefined): number \| null` (seulement `online`) ; `mergeResults(previous, batch)` (nouvel objet : les ids du lot remplacés, les autres gardés) ; `probeKey(connections)` (une chaîne qui change avec l'ensemble des connexions, leur hôte, leur port, leur bastion ; `""` sans connexion) |
| `store.ts` | `useReachability` (zustand) : `results: Readonly<Record<string, ProbeResult>>`, `refresh(ids)` (rien si `ids` est vide ; `ipc.probeCheck` dans un `try/catch` → `notifyError`, puis `mergeResults`), `clear()` |
| `use-reachability-polling.ts` | `useReachabilityPolling()` : sondes désactivées → `clear()` et rien d'autre ; aucune connexion → rien ; sinon une sonde **tout de suite**, puis toutes les `intervalSecs` secondes (`setInterval`, nettoyé au démontage). À chaque tour, les ids sont relus dans `useConnections.getState()`, et un tour est **sauté** quand `document.visibilityState === "hidden"`. L'effet dépend de `[enabled, intervalSecs, probeKey(...)]` : une connexion ajoutée, ou une adresse changée, relance une sonde aussitôt |
| `ConnectionStatusDot.tsx` | `ConnectionStatusDot({ connectionId, className })` : lit `results[connectionId]`, rend `<StatusDot status={dotStatus(r)} label={t(\`status.${status}\`)} className={className} />` |

### Branchements

- `AppLayout.tsx` : `useReachabilityPolling();` (une fois, à côté de `useGlobalShortcuts`).
- `sidebar/ConnectionRow.tsx` et `home/ConnectionCard.tsx` : le `<StatusDot status="unknown" …>` devient
  `<ConnectionStatusDot connectionId={connection.id} … />` (la carte garde son `className` qui masque la pastille au
  survol).
- `StatusBar.tsx` : après la taille, la latence du `connectionId` de l'onglet actif, si `latencyOf` en donne une :
  `<span>{t("statusbar.latency", { ms })}</span>`. Clé `statusbar.latency` = `"{{ms}} ms"` dans `en.json` **et**
  `fr.json`.

## Pièges (vus au prototype)

- **Sélecteur zustand** : `useReachability((s) => s.results[connectionId])` renvoie l'objet stocké, stable tant
  qu'il ne change pas. Ne jamais construire un objet ou un tableau dans le sélecteur.
- `probeKey` est une **chaîne** : React compare les dépendances par valeur, donc un favori coché ou une date de
  dernière connexion (qui recréent le tableau `connections`) ne relancent pas les sondes.
- Biome (`useExhaustiveDependencies`) refuse une dépendance que l'effet n'utilise pas : l'effet se sert de la clé
  pour sortir quand il n'y a aucune connexion (`if (key === "") return;`).
- La sidebar est un `complementary` (pas un `navigation`) et une carte d'accueil un `article` : utile pour tes
  propres scénarios.
- Le texte de la barre d'état est concaténé sans espaces par `textContent` : on cherche l'élément de latence par
  `getByText(/^\d+ ms$/)`, pas une regex sur toute la barre.
- Un `Skipped` n'est pas une erreur : la pastille reste « inconnu », et la barre d'état n'affiche pas de latence.

## Tests du contrat

### `src-tauri/src/probe_tests.rs` (nouveau)

```rust
use std::time::Duration;

use tokio::net::TcpListener;
use uuid::Uuid;

use crate::model::{Connection, ConnectionInput, Protocol};
use crate::probe::{ProbeStatus, probe, probe_all};

const QUICK: Duration = Duration::from_millis(500);

fn connection(host: &str, port: u16, jump: Option<Uuid>) -> Connection {
    Connection::from_input(
        Uuid::new_v4(),
        ConnectionInput {
            name: format!("{host}-{port}"),
            host: host.into(),
            port,
            jump_host_id: jump,
            ..ConnectionInput::template(Protocol::Ssh)
        },
        1_000,
    )
}

/// A port that answers, and one that refuses (a listener bound then dropped).
async fn open_and_closed_ports() -> (TcpListener, u16, u16) {
    let open = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let open_port = open.local_addr().unwrap().port();
    let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let closed_port = closed.local_addr().unwrap().port();
    drop(closed);
    (open, open_port, closed_port)
}

#[tokio::test]
async fn an_open_port_answers_with_a_latency_a_closed_one_does_not() {
    let (_listener, open, closed) = open_and_closed_ports().await;
    let latency = probe("127.0.0.1", open, QUICK).await.expect("online");
    assert!(latency < QUICK);
    assert_eq!(probe("127.0.0.1", closed, QUICK).await, None);
}

#[tokio::test]
async fn an_unknown_name_is_offline() {
    assert_eq!(probe("nowhere.invalid", 22, QUICK).await, None);
}

#[tokio::test]
async fn nothing_is_sent_on_the_connection() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut received = Vec::new();
        tokio::io::AsyncReadExt::read_to_end(&mut socket, &mut received)
            .await
            .unwrap();
        received
    });
    assert!(probe("127.0.0.1", port, QUICK).await.is_some());
    let received = tokio::time::timeout(Duration::from_secs(2), server)
        .await
        .expect("the probe closes the connection at once")
        .unwrap();
    assert!(received.is_empty(), "S15: TCP connect only, no data");
}

#[tokio::test]
async fn results_keep_the_order_and_a_bastion_target_is_skipped() {
    let (_listener, open, closed) = open_and_closed_ports().await;
    let bastion = connection("127.0.0.1", open, None);
    let behind = connection("db.internal", 22, Some(bastion.id));
    let down = connection("127.0.0.1", closed, None);
    let all = vec![behind.clone(), bastion.clone(), down.clone()];

    let results = probe_all(&all, QUICK, 16).await;
    let ids: Vec<Uuid> = results.iter().map(|r| r.connection_id).collect();
    assert_eq!(ids, [behind.id, bastion.id, down.id]);

    assert_eq!(results[0].status, ProbeStatus::Skipped);
    assert_eq!(results[0].latency_ms, None);
    assert_eq!(results[1].status, ProbeStatus::Online);
    assert!(results[1].latency_ms.is_some());
    assert_eq!(results[2].status, ProbeStatus::Offline);
    assert_eq!(results[2].latency_ms, None);
}

#[tokio::test]
async fn many_connections_are_all_probed_even_with_few_at_a_time() {
    let (_listener, open, closed) = open_and_closed_ports().await;
    let all: Vec<Connection> = (0..40)
        .map(|i| connection("127.0.0.1", if i % 2 == 0 { open } else { closed }, None))
        .collect();
    let results = probe_all(&all, QUICK, 3).await;
    assert_eq!(results.len(), 40);
    for (i, result) in results.iter().enumerate() {
        let expected = if i % 2 == 0 {
            ProbeStatus::Online
        } else {
            ProbeStatus::Offline
        };
        assert_eq!(result.status, expected, "connection {i}");
    }
}

#[tokio::test]
async fn no_connection_no_probe() {
    assert!(probe_all(&[], QUICK, 16).await.is_empty());
}
```

### `src-tauri/src/commands/ipc_probe_tests.rs` (nouveau)

```rust
use serde_json::json;

use super::ipc_tests::{create_connection, mock_app, ok};

#[test]
fn probe_check_accepts_the_ids_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let web = create_connection(&webview, "web");

    // Probes off: nothing touches the network, every known connection is skipped.
    let mut settings = ok(&webview, "settings_get", json!({}));
    settings["reachability"]["enabled"] = json!(false);
    ok(&webview, "settings_update", json!({ "settings": settings }));

    let unknown = "5b6f2d3e-0000-4000-8000-000000000009";
    let results = ok(
        &webview,
        "probe_check",
        json!({ "ids": [web["id"], unknown] }),
    );
    assert_eq!(
        results,
        json!([{ "connectionId": web["id"], "status": "skipped", "latencyMs": null }])
    );
}
```

### `src/features/reachability/reachability-model.test.ts` (nouveau)

```ts
// T30: what a probe result means for a connection's dot and latency.
import { describe, expect, test } from "vitest";
import type { ProbeResult } from "@/bindings/ProbeResult";
import { dotStatus, latencyOf, mergeResults, probeKey } from "./reachability-model";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

function result(connectionId: string, status: ProbeResult["status"], latencyMs: number | null) {
  return { connectionId, status, latencyMs } satisfies ProbeResult;
}

describe("dotStatus", () => {
  test("online and offline map to their dot; skipped and not probed yet are unknown", () => {
    expect(dotStatus(result(A, "online", 4))).toBe("online");
    expect(dotStatus(result(A, "offline", null))).toBe("offline");
    expect(dotStatus(result(A, "skipped", null))).toBe("unknown");
    expect(dotStatus(undefined)).toBe("unknown");
  });
});

describe("latencyOf", () => {
  test("only an online result has a latency", () => {
    expect(latencyOf(result(A, "online", 12))).toBe(12);
    expect(latencyOf(result(A, "online", null))).toBeNull();
    expect(latencyOf(result(A, "offline", 12))).toBeNull();
    expect(latencyOf(undefined)).toBeNull();
  });
});

describe("mergeResults", () => {
  test("a batch replaces its ids and keeps the others, without touching the previous record", () => {
    const previous = { [A]: result(A, "online", 3), [B]: result(B, "online", 9) };
    const next = mergeResults(previous, [result(B, "offline", null)]);
    expect(next).toEqual({ [A]: result(A, "online", 3), [B]: result(B, "offline", null) });
    expect(previous[B].status).toBe("online");
    expect(next).not.toBe(previous);
  });
});

describe("probeKey", () => {
  const web = { id: A, host: "10.0.0.12", port: 22, jumpHostId: null };

  test("changes with the address, the port, the jump host and the set of connections", () => {
    const key = probeKey([web]);
    expect(probeKey([{ ...web }])).toBe(key);
    expect(probeKey([{ ...web, host: "10.0.0.13" }])).not.toBe(key);
    expect(probeKey([{ ...web, port: 2222 }])).not.toBe(key);
    expect(probeKey([{ ...web, jumpHostId: B }])).not.toBe(key);
    expect(probeKey([web, { ...web, id: B }])).not.toBe(key);
    expect(probeKey([])).toBe("");
  });
});
```

### `src/lib/mock/probe.test.ts` (nouveau)

```ts
// T30: the mock's probes, as the dots of the browser UI show them.
import { beforeEach, describe, expect, test } from "vitest";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";

beforeEach(() => {
  resetMockBackend();
});

describe("mock probe_check", () => {
  test("a direct host answers, a down one does not, one behind a bastion is skipped", async () => {
    const results = await ipc.probeCheck([MOCK_IDS.nas, MOCK_IDS.web01]);
    expect(results.map((r) => [r.connectionId, r.status])).toEqual([
      [MOCK_IDS.nas, "online"],
      [MOCK_IDS.web01, "skipped"],
    ]);
    expect(results[0].latencyMs).toBeGreaterThan(0);
    expect(results[1].latencyMs).toBeNull();
  });

  test("an unknown id is left out", async () => {
    expect(await ipc.probeCheck(["00000000-0000-4000-8000-0000000000ff"])).toEqual([]);
  });

  test("with the probes off, everything is skipped", async () => {
    const settings = await ipc.settingsGet();
    await ipc.settingsUpdate({
      ...settings,
      reachability: { ...settings.reachability, enabled: false },
    });
    const [nas] = await ipc.probeCheck([MOCK_IDS.nas]);
    expect(nas.status).toBe("skipped");
  });
});
```

### `e2e/reachability.spec.ts` (nouveau)

```ts
// T30: the reachability dots (mock: win-desktop and kiosk-01 are down, web-01 is behind bastion-01).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function row(page: Page, name: string) {
  return page
    .getByRole("complementary")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first();
}

test("each sidebar row shows what its probe found", async ({ page }) => {
  await expect(row(page, "nas").getByRole("img", { name: "Online" })).toBeVisible();
  await expect(row(page, "win-desktop").getByRole("img", { name: "Offline" })).toBeVisible();
  // Behind a bastion: never probed (S15), the dot stays unknown.
  await expect(row(page, "web-01").getByRole("img", { name: "Unknown" })).toBeVisible();
  await expectSaneUi(page);
});

test("the home cards show the same dots", async ({ page }) => {
  const card = (name: string) => page.getByRole("article", { name });
  await expect(card("ad-01").getByRole("img", { name: "Online" })).toBeVisible();
  await expect(card("web-01").getByRole("img", { name: "Unknown" })).toBeVisible();
});

test("the status bar shows the latency of the active session's host", async ({ page }) => {
  await row(page, "nas").dblclick();
  const latency = page.getByRole("contentinfo").getByText(/^\d+ ms$/);
  await expect(latency).toBeVisible();

  // No latency for a host behind a bastion.
  await row(page, "web-01").dblclick();
  await expect(page.getByRole("tab", { selected: true })).toContainText("web-01");
  await expect(page.getByRole("contentinfo")).toContainText("via bastion-01");
  await expect(latency).toHaveCount(0);
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T30`.
2. `probe.rs`, `lib.rs` : `cd src-tauri && cargo test --lib probe` jusqu'au vert.
3. `commands/probe.rs`, `commands/mod.rs`, `lib.rs` (`invoke_handler`) : `cargo test --lib commands::ipc_probe`,
   puis `npm run bindings`.
4. `ipc.ts`, `lib/mock/probe.ts`, `ipc-mock.ts`, puis `features/reachability/` : `npm run typecheck`,
   `npx vitest run src/features/reachability src/lib/mock`.
5. `AppLayout.tsx`, `ConnectionRow.tsx`, `ConnectionCard.tsx`, `StatusBar.tsx`, `en.json`, `fr.json` :
   `npx playwright test e2e/reachability.spec.ts e2e/home.spec.ts e2e/connections.spec.ts`.
6. `npm run format`, `npm run review`, cases, statut, ligne « Works today » du `README.md` (pastilles de
   disponibilité), commit `feat: reachability probes for the status dots (T30)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T30 --check` affiche `OK` partout.
- [x] `grep -rn 'status="unknown"' src/features` ne trouve rien.
- [x] `grep -rn "write_all\|\.write(" src-tauri/src/probe.rs` ne trouve rien (aucune donnée envoyée, S15).
- [x] Aucune nouvelle exception `project-rules: allow`.
- [x] Visuel : les pastilles vertes et grises restent lisibles en clair et en sombre ; la latence de la barre d'état
      ne décale pas les autres éléments.

## À regarder par Florian

`npm run tauri dev` : quelques secondes après le lancement, les pastilles des connexions joignables passent au vert,
les autres au gris ; celles derrière un bastion restent en anneau (« inconnu »). Ouvre une session : la barre d'état
montre la latence de l'hôte.
