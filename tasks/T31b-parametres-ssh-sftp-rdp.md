# T31b — Paramètres : SSH (valeurs par défaut, serveurs connus), SFTP, RDP

| | |
|---|---|
| **Jalon** | M7 — Finitions |
| **Dépend de** | T31 |
| **Lire avant** | `docs/04-ecrans.md` §10, `docs/06-securite.md` S6 et S14, `docs/02-decisions.md` D10 |
| **Livrable** | commande `known_hosts_list` (+ `ipc`, mock) ; `pickFile` / `pickFolder` (`lib/files.ts`) ; sections SSH, SFTP et RDP de l'onglet Paramètres ; 5 fichiers de tests |

## Pourquoi

T31 a posé l'onglet Paramètres avec ses quatre premières sections. Restent les trois qui touchent aux connexions :
- **SSH** : le délai de connexion et le keepalive par défaut (`settings.ssh`, déjà lus par le backend pour une
  connexion qui n'en fixe pas), et la liste des **serveurs connus** de TunL, avec « Oublier » ;
- **SFTP** : le dossier où vont les téléchargements (`settings.ui.downloadDir`, déjà lu par `sftp_download`) ;
- **RDP** : le client FreeRDP trouvé, et un programme choisi à la main (`settings.rdp.clientPath`, déjà lu par
  `rdp_detect` et `rdp_open`).

Seule la liste des serveurs connus demande du backend : une commande en lecture seule sur le `known_hosts` **de
TunL**. Celui de l'utilisateur (`~/.ssh/known_hosts`) n'est jamais listé ni modifié (D10).

Prototypé par l'orchestrateur : les tests de cette fiche passent, avec toute la recette.

## À réutiliser (ne pas réécrire)

- T31 : `SettingRow`, `SettingSelect`, `SettingSwitch`, `SettingGroup`, `saveSettings`, `withCurrent`,
  `SettingsView` et `SETTINGS_SECTIONS`.
- T17 / T19b : `KnownHosts` (`own`, `learn`, `remove`), `fingerprint()`, `host_pattern()` ; la commande
  `known_host_remove` et `ipc.knownHostRemove` (elle sert à « Oublier »).
- Le module `known_hosts_file.rs` lit déjà une ligne comme OpenSSH (`Entry`, `HostPatterns`, `Marker`).
- T26b : `lib/files.ts` (seul fichier qui importe `@tauri-apps/plugin-dialog`) ; la permission `dialog:allow-open`
  suffit (S14 : rien à ajouter dans `capabilities/default.json`).
- T27 : `ipc.rdpDetect()`, l'erreur `rdpClientMissing`, le mock `rdp_detect` qui suit déjà `clientPath`.
- `AlertDialog` (shadcn), `toAppError`, `notifyError`.

## Contrat — Rust

### `src-tauri/src/ssh/known_hosts_file.rs`

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)] #[serde(rename_all = "camelCase")] #[ts(export)]
pub struct KnownHostEntry { pub host: String, pub port: u16, pub key_type: String, pub fingerprint: String }

/// Chaque hôte « simple » d'un fichier que TunL écrit, trié par hôte puis port.
pub fn own_entries(path: &Path) -> Vec<KnownHostEntry>;
```

- Fichier absent ou illisible : liste vide.
- Pour chaque ligne : on saute les vides et les commentaires ; on normalise les blancs (comme `parse_line`) ;
  `Entry` illisible, nom haché (`HostPatterns::HashedName`) ou **marqueur** (`@revoked`, `@cert-authority`) : sautée.
- Une ligne peut lister plusieurs hôtes (`a.lan,[a.lan]:2200`) : une entrée par hôte, chacune avec la clé de la
  ligne. Un motif avec `*`, `?` ou `!` est sauté (pas les autres motifs de la ligne).
- `host` sans crochets = port 22 ; `[host]:port` = ce port (port illisible : sauté).
- `key_type` = `key.algorithm().to_string()` (`ssh-ed25519`…), `fingerprint` = `fingerprint(key)` (`SHA256:…`, celle
  du dialogue de clé d'hôte).

### `src-tauri/src/ssh/known_hosts.rs` et la commande

- `KnownHosts::list_own(&self) -> Vec<KnownHostEntry>` = `own_entries(&self.own)`. Jamais le fichier de
  l'utilisateur.
- `commands/prompts.rs` : `#[tauri::command] pub async fn known_hosts_list(state) -> AppResult<Vec<KnownHostEntry>>`
  (aucun argument). Mettre à jour le commentaire d'en-tête du fichier.
- `lib.rs` : la commande dans `invoke_handler()`, après `known_host_remove`.
- `ssh/mod.rs` : `#[cfg(test)] mod known_hosts_list_tests;` ; `commands/mod.rs` : `#[cfg(test)] mod
  ipc_known_hosts_tests;`.
- `npm run bindings` : `KnownHostEntry.ts`.

## Contrat — Frontend

### IPC et mock

- `ipc.ts`, après `knownHostRemove` : `knownHostsList: () => call<KnownHostEntry[]>("known_hosts_list"),`
  (commentaire `// Known hosts (T31b): …`).
- `lib/mock/prompts.ts` (il garde déjà les clés apprises et retirées) : `export const MOCK_KNOWN_HOSTS` (trois
  hôtes : `192.168.1.1` et `192.168.1.10` en `ssh-ed25519`, `192.168.1.2` en `ecdsa-sha2-nistp256`, port 22, chacun
  une empreinte `SHA256:…` fixe) ; le handler `known_hosts_list` rend ces trois hôtes **plus** les clés apprises
  dans les scénarios (`ssh-ed25519`, une empreinte fixe), **moins** celles retirées par `known_host_remove`, triés
  par hôte (`localeCompare`) puis port.

### `lib/files.ts`

```ts
export const MOCK_PICKED_PROGRAM = "/opt/freerdp/bin/sdl-freerdp3";
export const MOCK_PICKED_FOLDER = "/home/user/Transfers";
/** Un fichier choisi, ou `null` si l'utilisateur annule. Tauri : `open({ multiple: false, directory: false })`. */
export async function pickFile(): Promise<string | null>;
/** Un dossier choisi, ou `null`. Tauri : `open({ multiple: false, directory: true })`. */
export async function pickFolder(): Promise<string | null>;
```

Mettre à jour le commentaire d'en-tête (« ou un dossier, T31b »).

### L'onglet Paramètres

- `SettingRow` : `children` devient **facultatif** ; sans contrôle, le libellé est un `<p id={id}>` (rien à
  associer), et la colonne de droite n'est pas rendue.
- `settings-options.ts` : `CONNECT_TIMEOUTS = [5, 10, 15, 30, 60, 120]`, `KEEPALIVES = [0, 15, 30, 60, 120, 300]`
  (0 = désactivé), `hostLabel(host, port)` (`host` sur le port 22, `host:port` sinon).
- `SettingsView` : `SETTINGS_SECTIONS` = `appearance`, `terminal`, `ssh`, `sftp`, `rdp`, `availability`, `about`
  (icônes `KeyRound`, `FolderTree`, `Monitor` pour les trois nouvelles).

| Fichier (`features/settings/sections/`) | Contenu |
|---|---|
| `SshSection.tsx` | un `SettingGroup` titré « Valeurs par défaut » : délai de connexion (`withCurrent(CONNECT_TIMEOUTS, …)`, `{{count}} seconds`) et keepalive (`0` → « Off ») ; puis un `SettingGroup` qui contient `KnownHostsList` |
| `KnownHostsList.tsx` | `ipc.knownHostsList()` au montage ; le titre, l'aide (qui dit que `~/.ssh/known_hosts` n'est pas listé), puis soit « aucun serveur », soit un `<ul aria-label="Known hosts">` : un `<li aria-label={hostLabel(…)}>` par entrée, avec l'hôte en `font-mono text-sm`, `keyType · fingerprint` en `font-mono text-xs text-muted-foreground` tronqué (empreinte entière en `title`), et un bouton icône `Trash2` « Forget {{host}} » (avec `Tooltip`) ; le bouton ouvre un `AlertDialog` (« Forget the key of {{host}}? », l'explication, Annuler / Oublier) ; « Oublier » → `ipc.knownHostRemove(host, port)` puis on relit la liste |
| `SftpSection.tsx` | une rangée « Download folder » : en aide, le dossier choisi ou « The system Downloads folder » ; à droite « Use the system folder » (seulement si un dossier est choisi → `downloadDir: null`) et « Choose… » (`FolderOpen`, `pickFolder()`, `null` → rien) |
| `RdpSection.tsx` | une rangée sans contrôle « FreeRDP client » : `ipc.rdpDetect()` → `{{path}} (version {{version}})`, ou, sur `rdpClientMissing`, « Not found… » (toute autre erreur → `notifyError`) ; cette rangée est un composant monté avec `key={clientPath ?? ""}`, qui redemande donc au backend quand le programme change. Puis une rangée « Program » : en aide le chemin choisi ou « Found automatically », à droite « Find automatically » (si un chemin est choisi → `clientPath: null`) et « Choose… » (`FileCode`, `pickFile()`) |

### i18n (`settings.*`, en et fr)

| Clé | en | fr |
|---|---|---|
| `sections.ssh` / `sftp` / `rdp` | SSH / SFTP / RDP | SSH / SFTP / RDP |
| `ssh.defaults` | Defaults | Valeurs par défaut |
| `ssh.defaultsHelp` | For connections that set none. | Pour les connexions qui n'en fixent pas. |
| `ssh.connectTimeout` | Connection timeout | Délai de connexion |
| `ssh.keepalive` | Keepalive | Maintien de connexion |
| `ssh.keepaliveHelp` | Keeps idle sessions open through firewalls. | Garde les sessions inactives ouvertes à travers les pare-feu. |
| `ssh.off` | Off | Désactivé |
| `ssh.seconds_one` / `_other` | {{count}} second / {{count}} seconds | {{count}} seconde / {{count}} secondes |
| `ssh.knownHosts` | Known hosts | Serveurs connus |
| `ssh.knownHostsHelp` | Servers whose key TunL trusts. Hosts from ~/.ssh/known_hosts are not listed: TunL never changes that file. | Les serveurs dont TunL fait confiance à la clé. Ceux de ~/.ssh/known_hosts ne sont pas listés : TunL ne modifie jamais ce fichier. |
| `ssh.noKnownHosts` | No server yet. TunL asks to check a server's key the first time it connects. | Aucun serveur pour l'instant. TunL demande de vérifier la clé d'un serveur à la première connexion. |
| `ssh.forget` | Forget {{host}} | Oublier {{host}} |
| `ssh.forgetTitle` | Forget the key of {{host}}? | Oublier la clé de {{host}} ? |
| `ssh.forgetDescription` | The next connection to this server will show its fingerprint again, for you to check. | La prochaine connexion à ce serveur affichera de nouveau son empreinte, pour que vous la vérifiiez. |
| `ssh.forgetConfirm` | Forget | Oublier |
| `sftp.downloadDir` | Download folder | Dossier de téléchargement |
| `sftp.systemDownloads` | The system Downloads folder | Le dossier Téléchargements du système |
| `sftp.useSystem` | Use the system folder | Utiliser celui du système |
| `sftp.choose` / `rdp.choose` | Choose… | Choisir… |
| `rdp.client` | FreeRDP client | Client FreeRDP |
| `rdp.found` | {{path}} (version {{version}}) | {{path}} (version {{version}}) |
| `rdp.missing` | Not found. Install FreeRDP 3, or choose the program below. | Introuvable. Installez FreeRDP 3, ou choisissez le programme ci-dessous. |
| `rdp.path` | Program | Programme |
| `rdp.pathAuto` | Found automatically | Trouvé automatiquement |
| `rdp.useFound` | Find automatically | Trouver automatiquement |

## Pièges (vus au prototype)

- Biome (`useExhaustiveDependencies`) refuse un effet qui dépend de `clientPath` sans s'en servir : d'où la rangée
  remontée par `key`, plutôt qu'un effet à dépendance artificielle.
- Un `<Label htmlFor>` qui vise un bouton lui donne **son** nom accessible : le bouton « Choose… » du dossier
  s'appelle « Download folder » pour un lecteur d'écran (et dans les tests). C'est voulu : deux boutons « Choose… »
  seraient indiscernables.
- `useEffect(() => { reload(); }, [reload])`, pas `useEffect(reload, [])` (Biome, et un effet ne renvoie rien d'autre
  qu'un nettoyage).
- Oublier une clé n'est **pas** le cas de la clé changée (S6 : taper le nom d'hôte) : ici la clé n'est pas suspecte,
  et la prochaine connexion redemande de vérifier l'empreinte. Une confirmation simple suffit.
- Le `AlertDialogAction` ferme le dialogue tout seul : ne pas appeler l'oubli dans `onOpenChange`.

## Tests du contrat

### `src-tauri/src/ssh/known_hosts_list_tests.rs` (nouveau)

```rust
//! T31b: the hosts of TunL's own known_hosts, as the Settings tab lists them.
use russh::keys::parse_public_key_base64;

use super::known_hosts::{KnownHosts, fingerprint};

// The fixed test keys of known_hosts_tests.rs.
const KEY_A: &str = "AAAAC3NzaC1lZDI1NTE5AAAAINaLEe/SaLSsJfe8JpeWmS3B21Uw+eO2V8colcGPyFu7";
const KEY_EC: &str = "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBG+hjIUfFDzc5XLJ/LvCqK1FO7u10XSVbfBvwNlHcqltQv5LGg8ZQxugdmnnA5I3KdTvCB+Z9mfjxKRpooFj+Sk=";

fn own(text: &str) -> (tempfile::TempDir, KnownHosts) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("known_hosts");
    std::fs::write(&path, text).unwrap();
    let user = dir.path().join("user_known_hosts");
    std::fs::write(&user, format!("user-only.lan ssh-ed25519 {KEY_A}\n")).unwrap();
    (dir, KnownHosts::new(path, Some(user)))
}

#[test]
fn lists_each_plain_host_of_the_own_file_sorted() {
    let (_dir, hosts) = own(&format!(
        "# written by TunL\n\
         web.lan ssh-ed25519 {KEY_A}\n\
         [db.internal]:2222\tecdsa-sha2-nistp256  {KEY_EC}\n\
         \n\
         alpha.lan,[alpha.lan]:2200 ssh-ed25519 {KEY_A} a comment\n"
    ));
    let listed: Vec<(String, u16, String)> = hosts
        .list_own()
        .into_iter()
        .map(|e| (e.host, e.port, e.key_type))
        .collect();
    assert_eq!(
        listed,
        [
            ("alpha.lan".to_string(), 22, "ssh-ed25519".to_string()),
            ("alpha.lan".to_string(), 2200, "ssh-ed25519".to_string()),
            (
                "db.internal".to_string(),
                2222,
                "ecdsa-sha2-nistp256".to_string()
            ),
            ("web.lan".to_string(), 22, "ssh-ed25519".to_string()),
        ]
    );
}

#[test]
fn the_fingerprint_is_the_one_the_prompt_shows() {
    let (_dir, hosts) = own(&format!("web.lan ssh-ed25519 {KEY_A}\n"));
    let entry = &hosts.list_own()[0];
    let key = parse_public_key_base64(KEY_A).unwrap();
    assert_eq!(entry.fingerprint, fingerprint(&key));
    assert!(entry.fingerprint.starts_with("SHA256:"));
}

#[test]
fn hashed_wildcard_negated_marked_and_unreadable_lines_are_not_listed() {
    let (_dir, hosts) = own(&format!(
        "|1|lxCjQXgLAd7CpBkib76/uVAp1Qk=|4DrVRStkFoJkufm2tUOiO30dPu8= ssh-ed25519 {KEY_A}\n\
         *.lan ssh-ed25519 {KEY_A}\n\
         !bad.lan,ok.lan ssh-ed25519 {KEY_A}\n\
         @revoked gone.lan ssh-ed25519 {KEY_A}\n\
         broken line\n"
    ));
    let listed: Vec<String> = hosts.list_own().into_iter().map(|e| e.host).collect();
    assert_eq!(listed, ["ok.lan"]);
}

#[test]
fn no_own_file_lists_nothing_and_the_user_file_is_never_listed() {
    let dir = tempfile::tempdir().unwrap();
    let user = dir.path().join("user_known_hosts");
    std::fs::write(&user, format!("user-only.lan ssh-ed25519 {KEY_A}\n")).unwrap();
    let hosts = KnownHosts::new(dir.path().join("missing"), Some(user));
    assert!(hosts.list_own().is_empty());
}

#[test]
fn a_learned_host_is_listed_then_gone_once_removed() {
    let (_dir, hosts) = own("");
    let key = parse_public_key_base64(KEY_A).unwrap();
    hosts.learn("Router.LAN", 2222, &key).unwrap();
    let listed = hosts.list_own();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        (listed[0].host.as_str(), listed[0].port),
        ("router.lan", 2222)
    );
    hosts.remove("router.lan", 2222).unwrap();
    assert!(hosts.list_own().is_empty());
}
```

### `src-tauri/src/commands/ipc_known_hosts_tests.rs` (nouveau)

```rust
use serde_json::json;

use super::ipc_tests::{mock_app, ok};

#[test]
fn known_hosts_list_takes_no_argument_and_starts_empty() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    assert_eq!(ok(&webview, "known_hosts_list", json!({})), json!([]));
}
```

### `src/lib/mock/known-hosts.test.ts` (nouveau)

```ts
// T31b: the mock's own known_hosts, shared with the host-key scenarios and `known_host_remove`.
import { beforeEach, describe, expect, test } from "vitest";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { markHostKeyLearned } from "@/lib/mock/prompts";

beforeEach(() => {
  resetMockBackend();
});

describe("mock known_hosts_list", () => {
  test("three hosts at start, sorted by host", async () => {
    const hosts = await ipc.knownHostsList();
    expect(hosts.map((h) => `${h.host}:${h.port}`)).toEqual([
      "192.168.1.1:22",
      "192.168.1.10:22",
      "192.168.1.2:22",
    ]);
    expect(hosts.every((h) => h.fingerprint.startsWith("SHA256:"))).toBe(true);
  });

  test("a learned host joins the list; a removed one leaves it", async () => {
    markHostKeyLearned("db.internal", 2222);
    expect((await ipc.knownHostsList()).map((h) => h.host)).toContain("db.internal");

    expect(await ipc.knownHostRemove("192.168.1.10", 22)).toBe(1);
    const hosts = await ipc.knownHostsList();
    expect(hosts.map((h) => h.host)).not.toContain("192.168.1.10");
    expect(hosts.find((h) => h.host === "db.internal")?.port).toBe(2222);
  });
});
```

### `e2e/settings-ssh-sftp-rdp.spec.ts` (nouveau)

```ts
// T31b: Settings › SSH (defaults, known hosts), SFTP (download folder) and RDP (FreeRDP client).
// Mock: three known hosts at start; the chooser picks /home/user/Transfers or /opt/freerdp/bin/sdl-freerdp3.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+,");
});

function settings(page: Page) {
  return page.getByRole("region", { name: "Settings", exact: true });
}

async function openSection(page: Page, name: string) {
  await settings(page).getByRole("navigation").getByRole("button", { name, exact: true }).click();
}

test("SSH defaults are saved at once", async ({ page }) => {
  await openSection(page, "SSH");
  const timeout = settings(page).getByRole("combobox", { name: "Connection timeout" });
  await expect(timeout).toHaveText("15 seconds");
  await expect(settings(page).getByRole("combobox", { name: "Keepalive" })).toHaveText(
    "30 seconds",
  );
  await expectSaneUi(page);

  await timeout.click();
  await page.getByRole("option", { name: "60 seconds", exact: true }).click();
  await openSection(page, "Terminal");
  await openSection(page, "SSH");
  await expect(timeout).toHaveText("60 seconds");
});

test("a known host can be forgotten, after a confirmation", async ({ page }) => {
  await openSection(page, "SSH");
  const hosts = settings(page).getByRole("list", { name: "Known hosts" });
  await expect(hosts.getByRole("listitem")).toHaveCount(3);
  await expect(hosts.getByRole("listitem", { name: "192.168.1.2" })).toContainText(
    "ecdsa-sha2-nistp256",
  );

  await hosts.getByRole("button", { name: "Forget 192.168.1.2" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Forget the key of 192.168.1.2?");
  await expectSaneUi(page);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(hosts.getByRole("listitem")).toHaveCount(3);

  await hosts.getByRole("button", { name: "Forget 192.168.1.2" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Forget" }).click();
  await expect(hosts.getByRole("listitem")).toHaveCount(2);
  await expect(hosts.getByRole("listitem", { name: "192.168.1.2" })).toHaveCount(0);
});

test("a host trusted while connecting shows up in the list", async ({ page }) => {
  await page
    .getByRole("button", { name: /^db-prod/ })
    .first()
    .dblclick();
  await page.getByRole("alertdialog").getByRole("button", { name: "Trust and continue" }).click();
  await page.getByRole("tab", { name: /Settings/ }).click();
  await openSection(page, "SSH");
  const hosts = settings(page).getByRole("list", { name: "Known hosts" });
  await expect(hosts.getByRole("listitem", { name: "db.internal" })).toBeVisible();
});

test("the download folder is the system one until another is chosen", async ({ page }) => {
  await openSection(page, "SFTP");
  await expect(settings(page)).toContainText("The system Downloads folder");
  await expectSaneUi(page);
  await settings(page).getByRole("button", { name: "Download folder" }).click();
  await expect(settings(page)).toContainText("/home/user/Transfers");
  await settings(page).getByRole("button", { name: "Use the system folder" }).click();
  await expect(settings(page)).toContainText("The system Downloads folder");
});

test("the RDP client found, then a program chosen by hand", async ({ page }) => {
  await openSection(page, "RDP");
  await expect(settings(page)).toContainText("/usr/bin/sdl-freerdp3 (version 3.10.3)");
  await expect(settings(page)).toContainText("Found automatically");
  await expectSaneUi(page);

  await settings(page).getByRole("button", { name: "Program" }).click();
  await expect(settings(page)).toContainText("/opt/freerdp/bin/sdl-freerdp3 (version 3.10.3)");
  await settings(page).getByRole("button", { name: "Find automatically" }).click();
  await expect(settings(page)).toContainText("/usr/bin/sdl-freerdp3 (version 3.10.3)");
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T31b`.
2. `known_hosts_file.rs`, `known_hosts.rs`, `ssh/mod.rs` : `cd src-tauri && cargo test --lib known_hosts`.
3. `commands/prompts.rs`, `commands/mod.rs`, `lib.rs` : `cargo test --lib commands::ipc_known`, puis
   `npm run bindings`.
4. `ipc.ts`, `lib/mock/prompts.ts`, `lib/files.ts` : `npm run typecheck`, `npx vitest run src/lib`.
5. `SettingRow.tsx`, `settings-options.ts`, les trois sections, `KnownHostsList.tsx`, `SettingsView.tsx`, `en.json`,
   `fr.json` : `npx playwright test e2e/settings-ssh-sftp-rdp.spec.ts e2e/settings.spec.ts`.
6. `npm run format`, `npm run review`, cases, statut, ligne « Works today » du `README.md` (complète celle de T31),
   commit `feat: SSH, SFTP and RDP settings, known hosts list (T31b)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T31b --check` affiche `OK` partout.
- [x] `git diff src-tauri/capabilities/default.json` est vide (S14).
- [x] `grep -rn "plugin-dialog" src` ne trouve que `src/lib/files.ts`.
- [x] Aucune nouvelle exception `project-rules: allow`.
- [x] Visuel : la liste des serveurs connus reste lisible avec une longue empreinte (tronquée, pas de défilement
      horizontal), en clair et en sombre.

## À regarder par Florian

`npm run tauri dev`, Paramètres :
- **SSH** : les serveurs auxquels tu as fait confiance dans TunL ; « Oublier » l'un d'eux, puis reconnecte-toi : le
  dialogue d'empreinte revient ;
- **SFTP** : choisis un dossier, puis télécharge un fichier depuis un onglet SFTP : il arrive dans ce dossier ;
- **RDP** : le client trouvé sur ton poste (chemin et version) ; « Choisir… » un autre binaire FreeRDP, puis
  « Trouver automatiquement ».
