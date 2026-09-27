# T11 — Éditeur de connexion : Réseau (bastion, Wake-on-LAN) et Avancé (SSH, RDP)

| | |
|---|---|
| **Jalon** | M1 — Connexions |
| **Dépend de** | T10 |
| **Lire avant** | `docs/04-ecrans.md` §3, `docs/05-modele-donnees.md` §2 et §6, `docs/06-securite.md` (S5 et S6), et le **code** livré par T10 (`src/features/connections/editor/`) plutôt que la fiche T10 : ne relis pas celle-ci |
| **Livrable** | Onglets « Network » et « Advanced » de l'éditeur, 16 tests unitaires et 3 scénarios e2e verts ; les tests de T10 restent verts **sans modification** |

## Pourquoi

Le bastion et le Wake-on-LAN font partie de ce qui distingue TunL. L'utilisateur choisit son bastion dans une liste
qui ne propose que des choix valides, et voit la chaîne obtenue : « You → bastion-01 → web-01 ». Côté RDP, les
arguments supplémentaires sont une porte d'entrée vers FreeRDP : la validation doit refuser tout ce que TunL gère
lui-même, et tout argument sur plusieurs lignes (S5).

## Contrat

### Champs ajoutés à `ConnectionFormValues`

```ts
jumpHostId: string;                         // "" = direct connection
wolEnabled: boolean;
wolMac: string; wolBroadcast: string; wolPort: string;
wolWakeBeforeConnect: boolean; wolWaitTimeoutSecs: string;
sshKeepaliveSecs: string;                   // "" = global setting
sshConnectTimeoutSecs: string;              // "" = global setting
rdpDisplayMode: "fit" | "fullscreen" | "fixed";
rdpWidth: string; rdpHeight: string;        // "1920" / "1080" unless the display is fixed
rdpMultimon: boolean; rdpDynamicResolution: boolean; rdpClipboard: boolean; rdpShareHome: boolean;
rdpAudio: "local" | "remote" | "off";
rdpCertPolicy: "prompt" | "tofu";
rdpExtraArgs: string[];
```

- `toFormValues` :
  - `wolEnabled = input.wol !== null` ; les champs `wol*` viennent de `input.wol ?? templates.wol` ;
  - les champs `ssh*` et `rdp*` du protocole que la connexion n'utilise pas viennent du modèle de ce protocole ;
  - `rdpWidth` et `rdpHeight` valent `"1920"` et `"1080"` si l'affichage n'est pas `fixed`.
- `toConnectionInput` : `jumpHostId` et `wol` viennent désormais du **formulaire**, plus de `base`.
  - `jumpHostId` : `""` → `null`.
  - `wol` : `null` si `!wolEnabled`. Sinon, la MAC passe par `normalizeMac` (repli : la saisie après `trim`) et les
    nombres sont convertis.
  - SSH : `keepaliveSecs` et `connectTimeoutSecs` : `""` → `null`, sinon un nombre.
  - RDP : tous les champs `rdp*`. `display` vaut `{ mode: "fixed", width, height }` ou `{ mode }`.
- `backendFieldError` reconnaît en plus :

  | Chemin backend | Champ du formulaire |
  |---|---|
  | `jumpHostId` | `jumpHostId` |
  | `wol.mac`, `wol.broadcast`, `wol.port`, `wol.waitTimeoutSecs` | `wolMac`, `wolBroadcast`, `wolPort`, `wolWaitTimeoutSecs` |
  | `settings.keepaliveSecs`, `settings.connectTimeoutSecs` | `sshKeepaliveSecs`, `sshConnectTimeoutSecs` |
  | `settings.display` | `rdpWidth` |
  | `settings.extraArgs` | `rdpExtraArgs` |

- Les tests de T10 construisent leurs valeurs **à partir de** `toFormValues` : ils restent valides sans modification.
  Ne les touche pas.

### Validation (dans le `superRefine` existant)

| Condition | Champ | Code |
|---|---|---|
| `wolEnabled` et MAC non normalisable | `wolMac` | `invalidMac` |
| `wolEnabled` et diffusion qui n'est pas une IPv4 | `wolBroadcast` | `invalidIpv4` |
| `wolEnabled` et port hors 1–65535 | `wolPort` | `invalidPort` |
| `wolEnabled` et attente hors 10–600 | `wolWaitTimeoutSecs` | `waitRange` |
| SSH, keepalive non vide et pas un entier de 0 à 3600 | `sshKeepaliveSecs` | `keepaliveRange` |
| SSH, délai non vide et pas un entier de 1 à 120 | `sshConnectTimeoutSecs` | `timeoutRange` |
| RDP `fixed`, largeur hors 640–8192 | `rdpWidth` | `widthRange` |
| RDP `fixed`, hauteur hors 480–8192 | `rdpHeight` | `heightRange` |
| RDP, plus de 20 arguments | `rdpExtraArgs` | `tooManyArgs` |
| RDP, un argument : dans cet ordre, **une seule erreur** par argument : caractère de contrôle, puis longueur hors 1–200 ou premier caractère autre que `/`, `+` ou `-`, puis préfixe réservé | `rdpExtraArgs` | `controlChars`, `invalidArg`, `reservedArg` |

Préfixes réservés (comparaison en minuscules) : ceux de `docs/05-modele-donnees.md` §6, c'est-à-dire `/p:`,
`/password`, `/u:`, `/d:`, `/v:`, `/port:`, `/args-from`, `/from-stdin`, `/gateway`, `/gp:`, `/gu:`, `/gd:` et
`/cert:`. Ils vivent dans une constante `RESERVED_RDP_ARGS` de `validation.ts`, avec un commentaire qui renvoie au
document.

`normalizeMac(raw: string): string | null` dans `validation.ts` : mêmes règles que la fonction Rust de T06.

| Code | Anglais (`validation.*`) |
|---|---|
| `invalidMac` | Enter a MAC address like AA:BB:CC:DD:EE:FF |
| `invalidIpv4` | Enter an IPv4 address |
| `waitRange` | Between 10 and 600 seconds |
| `keepaliveRange` | Between 0 and 3600 seconds |
| `timeoutRange` | Between 1 and 120 seconds |
| `widthRange` | Between 640 and 8192 |
| `heightRange` | Between 480 and 8192 |
| `tooManyArgs` | 20 arguments at most |
| `invalidArg` | Must start with /, + or - |
| `reservedArg` | TunL sets this argument itself |

### Bastions — `src/features/connections/jump-hosts.ts`

```ts
export const MAX_JUMP_HOSTS = 4;
/**
 * SSH connections that can serve as the jump host of `selfId` (null for a new connection): never itself, never an
 * RDP connection, never one whose own chain goes through `selfId`, and never one that would make the chain longer
 * than MAX_JUMP_HOSTS. Sorted with compareNames.
 */
export function eligibleJumpHosts(connections: readonly Connection[], selfId: string | null): Connection[];
/** Bastion names from the user's side: the outermost bastion first, `jumpHostId` last. Stops on a loop or a missing link. */
export function jumpChainNames(connections: readonly Connection[], jumpHostId: string): string[];
```

### Onglet « Network » (SSH et RDP)

- **Jump host** : `Select` avec :
  - « None (direct connection) » ;
  - puis `eligibleJumpHosts(connections, id de la connexion éditée ou null)`.

  Sous la liste, quand un bastion est choisi : la chaîne `You → <bastions…> → <nom saisi>`, jointe par `" → "`.
  Si le nom est vide, on affiche « this connection » à sa place.
- **Wake-on-LAN** : un `Switch` libellé « Wake-on-LAN ». Activé, il montre :
  - « MAC address » ;
  - « Broadcast address » ;
  - « UDP port » ;
  - un `Switch` « Wake before connecting » ;
  - « Wait for the host (seconds) ».

### Onglet « Advanced »

- **SSH** : « Keepalive interval (seconds) » et « Connection timeout (seconds) ». Chaque champ vide affiche en
  placeholder la valeur globale des réglages (`useSettings`), par exemple « 30 (global setting) ».
- **RDP** :
  - « Display » en `RadioGroup` : « Fit to window », « Full screen », « Fixed size ». Avec « Fixed size », les champs
    « Width » et « Height » apparaissent sur une ligne.
  - Des `Switch` : « Multiple monitors », « Dynamic resolution », « Clipboard », « Share my home folder ».
  - « Audio » (`Select` : Local / Remote / Off) et « Certificate » (`Select` : Ask / Trust on first use).
    Jamais d'option « ignorer » : S6.
  - « Extra arguments » : le composant `TagsInput` de T10, avec une prop qui désactive le passage en minuscules. Un
    argument se saisit puis s'ajoute avec `Entrée`, sans filtrage : c'est la validation qui signale l'erreur, sous le
    champ.

### Textes (anglais exact ; en français dans `fr.json`)

| Clé | Anglais |
|---|---|
| `editor.tabs.network` / `advanced` | Network / Advanced |
| `editor.fields.jumpHost` | Jump host |
| `editor.noJumpHost` | None (direct connection) |
| `editor.chainYou` / `chainThisConnection` | You / this connection |
| `editor.fields.wol` / `mac` / `broadcast` / `wolPort` / `wakeBeforeConnect` / `waitTimeout` | Wake-on-LAN / MAC address / Broadcast address / UDP port / Wake before connecting / Wait for the host (seconds) |
| `editor.fields.keepalive` / `connectTimeout` | Keepalive interval (seconds) / Connection timeout (seconds) |
| `editor.globalDefault` | {{value}} (global setting) |
| `editor.fields.display` / `width` / `height` | Display / Width / Height |
| `editor.display.fit` / `fullscreen` / `fixed` | Fit to window / Full screen / Fixed size |
| `editor.fields.multimon` / `dynamicResolution` / `clipboard` / `shareHome` | Multiple monitors / Dynamic resolution / Clipboard / Share my home folder |
| `editor.fields.audio` / `certificate` / `extraArgs` | Audio / Certificate / Extra arguments |
| `editor.audio.local` / `remote` / `off` | Local / Remote / Off |
| `editor.cert.prompt` / `tofu` | Ask / Trust on first use |

### Pièges

- Un libellé « Port » existe déjà dans l'onglet Général. Celui du Wake-on-LAN s'appelle donc « UDP port » : les tests
  cherchent les champs par libellé exact.
- `ConnectionEditor.tsx` va grossir. S'il dépasse 400 lignes, sortir les onglets dans `NetworkTab.tsx` et
  `AdvancedTab.tsx`, et, au besoin, les champs RDP dans `RdpAdvancedFields.tsx`.
- Le `Select` du bastion utilise la même valeur sentinelle que celui du groupe : `value=""` interdit sur un `SelectItem`.

## Tests du contrat

### `src/features/connections/jump-hosts.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { Connection } from "@/bindings/Connection";
import { eligibleJumpHosts, jumpChainNames } from "./jump-hosts";

function ssh(name: string, jumpHostId: string | null = null): Connection {
  return {
    id: name,
    name,
    host: `${name}.example`,
    port: 22,
    username: null,
    groupId: null,
    tags: [],
    favorite: false,
    color: null,
    notes: null,
    jumpHostId,
    wol: null,
    settings: { protocol: "ssh", auth: { method: "agent" }, keepaliveSecs: null, connectTimeoutSecs: null },
    createdAt: 0,
    updatedAt: 0,
    lastConnectedAt: null,
  };
}

function rdp(name: string): Connection {
  return {
    ...ssh(name),
    port: 3389,
    settings: {
      protocol: "rdp",
      domain: null,
      display: { mode: "fit" },
      multimon: false,
      dynamicResolution: true,
      clipboard: true,
      audio: "local",
      shareHome: false,
      certPolicy: "prompt",
      extraArgs: [],
    },
  };
}

// web → inner → bastion (web jumps through inner, which jumps through bastion).
const all = [ssh("web", "inner"), rdp("win"), ssh("inner", "bastion"), ssh("bastion")];

describe("jump hosts", () => {
  it("offers the SSH connections, sorted by name", () => {
    expect(eligibleJumpHosts(all, null).map((c) => c.name)).toEqual(["bastion", "inner", "web"]);
  });

  it("never offers the connection itself, nor one that goes through it", () => {
    expect(eligibleJumpHosts(all, "inner").map((c) => c.name)).toEqual(["bastion"]);
    expect(eligibleJumpHosts(all, "bastion").map((c) => c.name)).toEqual([]);
  });

  it("never offers a host whose chain is already four bastions long", () => {
    const names = ["h1", "h2", "h3", "h4", "h5"];
    const chain = names.map((name, index) => ssh(name, index === 0 ? null : names[index - 1]));
    expect(eligibleJumpHosts(chain, null).map((c) => c.name)).toEqual(["h1", "h2", "h3", "h4"]);
  });

  it("describes the chain from the user's side", () => {
    expect(jumpChainNames(all, "web")).toEqual(["bastion", "inner", "web"]);
    expect(jumpChainNames(all, "bastion")).toEqual(["bastion"]);
    expect(jumpChainNames(all, "")).toEqual([]);
  });

  it("stops on a loop or a missing link", () => {
    expect(jumpChainNames([ssh("a", "b"), ssh("b", "a")], "a")).toEqual(["b", "a"]);
    expect(jumpChainNames([ssh("x", "gone")], "x")).toEqual(["x"]);
  });
});
```

### `src/features/connections/editor/network-advanced.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { AppError } from "@/bindings/AppError";
import type { ConnectionInput } from "@/bindings/ConnectionInput";
import type { ConnectionTemplates } from "@/bindings/ConnectionTemplates";
import {
  backendFieldError,
  type ConnectionFormValues,
  connectionFormSchema,
  toConnectionInput,
  toFormValues,
} from "./form-values";
import { normalizeMac } from "./validation";

const common = {
  name: "",
  host: "",
  username: null,
  groupId: null,
  tags: [],
  favorite: false,
  color: null,
  notes: null,
  jumpHostId: null,
  wol: null,
} satisfies Partial<ConnectionInput>;

const rdpDefaults = {
  protocol: "rdp",
  domain: null,
  display: { mode: "fit" },
  multimon: false,
  dynamicResolution: true,
  clipboard: true,
  audio: "local",
  shareHome: false,
  certPolicy: "prompt",
  extraArgs: [],
} satisfies ConnectionInput["settings"];

const templates: ConnectionTemplates = {
  ssh: {
    ...common,
    port: 22,
    settings: { protocol: "ssh", auth: { method: "password" }, keepaliveSecs: null, connectTimeoutSecs: null },
  },
  rdp: { ...common, port: 3389, settings: { ...rdpDefaults, extraArgs: [] } },
  wol: { mac: "", broadcast: "255.255.255.255", port: 9, wakeBeforeConnect: false, waitTimeoutSecs: 120 },
};

function sshValues(patch: Partial<ConnectionFormValues> = {}): ConnectionFormValues {
  return { ...toFormValues(templates.ssh, templates), name: "web-01", host: "10.0.0.12", ...patch };
}

function rdpValues(patch: Partial<ConnectionFormValues> = {}): ConnectionFormValues {
  return { ...toFormValues(templates.rdp, templates), name: "win", host: "10.0.0.5", ...patch };
}

function issuesOf(values: ConnectionFormValues): Record<string, string> {
  const result = connectionFormSchema.safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((issue) => [String(issue.path[0]), issue.message]));
}

describe("network and advanced fields", () => {
  it("maps the RDP settings", () => {
    const values = rdpValues({
      rdpDisplayMode: "fixed",
      rdpWidth: "1920",
      rdpHeight: "1080",
      rdpAudio: "off",
      rdpCertPolicy: "tofu",
      rdpClipboard: false,
      rdpExtraArgs: ["+fonts"],
    });
    expect(toConnectionInput(values, templates.rdp, templates).settings).toEqual({
      ...rdpDefaults,
      display: { mode: "fixed", width: 1920, height: 1080 },
      clipboard: false,
      audio: "off",
      certPolicy: "tofu",
      extraArgs: ["+fonts"],
    });
  });

  it("fills the form from a fixed-size RDP connection", () => {
    const input: ConnectionInput = {
      ...templates.rdp,
      settings: { ...rdpDefaults, domain: "CORP", display: { mode: "fixed", width: 1280, height: 720 }, extraArgs: [] },
    };
    expect(toFormValues(input, templates)).toMatchObject({
      rdpDomain: "CORP",
      rdpDisplayMode: "fixed",
      rdpWidth: "1280",
      rdpHeight: "720",
      wolEnabled: false,
      wolBroadcast: "255.255.255.255",
      sshKeepaliveSecs: "",
    });
  });

  it("maps Wake-on-LAN and normalizes the MAC address", () => {
    const on = sshValues({
      wolEnabled: true,
      wolMac: "aa-bb-cc-dd-ee-ff",
      wolWakeBeforeConnect: true,
      wolWaitTimeoutSecs: "60",
    });
    expect(toConnectionInput(on, templates.ssh, templates).wol).toEqual({
      mac: "AA:BB:CC:DD:EE:FF",
      broadcast: "255.255.255.255",
      port: 9,
      wakeBeforeConnect: true,
      waitTimeoutSecs: 60,
    });
    const off = sshValues({ wolEnabled: false, wolMac: "aa-bb-cc-dd-ee-ff" });
    expect(toConnectionInput(off, templates.ssh, templates).wol).toBeNull();
  });

  it("maps the jump host and the SSH timeouts, empty meaning the global setting", () => {
    const values = sshValues({ jumpHostId: "j-1", sshKeepaliveSecs: "15", sshConnectTimeoutSecs: "" });
    const input = toConnectionInput(values, templates.ssh, templates);
    expect(input.jumpHostId).toBe("j-1");
    expect(input.settings).toMatchObject({ protocol: "ssh", keepaliveSecs: 15, connectTimeoutSecs: null });
    expect(toConnectionInput(sshValues({ jumpHostId: "" }), templates.ssh, templates).jumpHostId).toBeNull();
  });

  it("normalizes MAC addresses like the backend", () => {
    expect(normalizeMac("aa-bb-cc-dd-ee-ff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normalizeMac(" aabbccddeeff ")).toBe("AA:BB:CC:DD:EE:FF");
    for (const bad of ["", "aa:bb:cc:dd:ee", "aa:bb:cc:dd:ee:gg", "aa:bb-cc:dd:ee:ff", "aabbccddeeff00"]) {
      expect(normalizeMac(bad)).toBeNull();
    }
  });

  it("attaches the new backend paths to their fields", () => {
    const error: AppError = { kind: "validation", message: "jumpHostId: creates a cycle", detail: null };
    expect(backendFieldError(error)).toEqual({ field: "jumpHostId", message: "creates a cycle" });
    const mac: AppError = { ...error, message: "wol.mac: invalid MAC address" };
    expect(backendFieldError(mac)).toEqual({ field: "wolMac", message: "invalid MAC address" });
  });
});

describe("network and advanced validation", () => {
  it("checks Wake-on-LAN only when it is enabled", () => {
    expect(issuesOf(sshValues({ wolEnabled: false, wolMac: "nope" }))).toEqual({});
    expect(issuesOf(sshValues({ wolEnabled: true, wolMac: "nope" }))).toEqual({ wolMac: "invalidMac" });
    const mac = "aabbccddeeff";
    expect(issuesOf(sshValues({ wolEnabled: true, wolMac: mac, wolBroadcast: "x" }))).toEqual({
      wolBroadcast: "invalidIpv4",
    });
    expect(issuesOf(sshValues({ wolEnabled: true, wolMac: mac, wolPort: "0" }))).toEqual({ wolPort: "invalidPort" });
    expect(issuesOf(sshValues({ wolEnabled: true, wolMac: mac, wolWaitTimeoutSecs: "5" }))).toEqual({
      wolWaitTimeoutSecs: "waitRange",
    });
  });

  it("checks the SSH timeouts when they are set", () => {
    expect(issuesOf(sshValues({ sshKeepaliveSecs: "4000" }))).toEqual({ sshKeepaliveSecs: "keepaliveRange" });
    expect(issuesOf(sshValues({ sshConnectTimeoutSecs: "0" }))).toEqual({ sshConnectTimeoutSecs: "timeoutRange" });
    expect(issuesOf(sshValues({ sshKeepaliveSecs: "", sshConnectTimeoutSecs: "" }))).toEqual({});
  });

  it("checks a fixed RDP resolution only", () => {
    expect(issuesOf(rdpValues({ rdpDisplayMode: "fixed", rdpWidth: "639" }))).toEqual({ rdpWidth: "widthRange" });
    expect(issuesOf(rdpValues({ rdpDisplayMode: "fixed", rdpHeight: "479" }))).toEqual({ rdpHeight: "heightRange" });
    expect(issuesOf(rdpValues({ rdpDisplayMode: "fit", rdpWidth: "1" }))).toEqual({});
  });

  it("refuses reserved, malformed or multi-line extra arguments", () => {
    expect(issuesOf(rdpValues({ rdpExtraArgs: ["/sound:sys:pulse", "+fonts", "-wallpaper"] }))).toEqual({});
    expect(issuesOf(rdpValues({ rdpExtraArgs: ["/p:secret"] }))).toEqual({ rdpExtraArgs: "reservedArg" });
    expect(issuesOf(rdpValues({ rdpExtraArgs: ["/V:evil"] }))).toEqual({ rdpExtraArgs: "reservedArg" });
    expect(issuesOf(rdpValues({ rdpExtraArgs: ["noprefix"] }))).toEqual({ rdpExtraArgs: "invalidArg" });
    expect(issuesOf(rdpValues({ rdpExtraArgs: ["/size:1\n/p:x"] }))).toEqual({ rdpExtraArgs: "controlChars" });
    const many = Array.from({ length: 21 }, (_, index) => `+flag${index}`);
    expect(issuesOf(rdpValues({ rdpExtraArgs: many }))).toEqual({ rdpExtraArgs: "tooManyArgs" });
  });

  it("ignores the RDP fields of an SSH connection", () => {
    expect(issuesOf(sshValues({ rdpDisplayMode: "fixed", rdpWidth: "1", rdpExtraArgs: ["/p:x"] }))).toEqual({});
  });
});
```

### `e2e/editor-network.spec.ts`

```ts
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function editor(page: Page) {
  return page.getByRole("dialog");
}

function field(page: Page, label: string) {
  return editor(page).getByLabel(label, { exact: true });
}

async function openEdit(page: Page, name: string) {
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().click({ button: "right" });
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
}

test("choosing a bastion shows the resulting chain", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await field(page, "Name").fill("app-01");
  await field(page, "Host").fill("10.3.3.3");
  await editor(page).getByRole("tab", { name: "Network" }).click();
  await editor(page).getByRole("combobox", { name: "Jump host" }).click();
  await page.getByRole("option", { name: "bastion-01" }).click();
  await expect(editor(page).getByText("You → bastion-01 → app-01")).toBeVisible();
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);

  await openEdit(page, "app-01");
  await editor(page).getByRole("tab", { name: "Network" }).click();
  await expect(editor(page).getByRole("combobox", { name: "Jump host" })).toContainText("bastion-01");
});

test("Wake-on-LAN: the MAC address is normalized and the menu offers a wake-up", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await expect(page.getByRole("menu").getByText("Wake up", { exact: true })).toHaveCount(0);
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
  await editor(page).getByRole("tab", { name: "Network" }).click();
  await editor(page).getByRole("switch", { name: "Wake-on-LAN" }).click();
  await field(page, "MAC address").fill("aa-bb-cc-dd-ee-ff");
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);

  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await expect(page.getByRole("menu").getByText("Wake up", { exact: true })).toBeVisible();
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
  await editor(page).getByRole("tab", { name: "Network" }).click();
  await expect(field(page, "MAC address")).toHaveValue("AA:BB:CC:DD:EE:FF");
});

test("RDP advanced settings are validated", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await editor(page).getByRole("radio", { name: "RDP", exact: true }).click();
  await field(page, "Name").fill("win-02");
  await field(page, "Host").fill("10.4.4.4");
  await editor(page).getByRole("tab", { name: "Advanced" }).click();
  await editor(page).getByRole("radio", { name: "Fixed size", exact: true }).click();
  await field(page, "Width").fill("100");
  await expect(editor(page).getByText("Between 640 and 8192")).toBeVisible();
  await field(page, "Width").fill("1920");
  await field(page, "Extra arguments").fill("/p:secret");
  await field(page, "Extra arguments").press("Enter");
  await expect(editor(page).getByText("TunL sets this argument itself")).toBeVisible();
  await expect(editor(page).getByRole("button", { name: "Save", exact: true })).toBeDisabled();
});
```

## Étapes

1. Les trois fichiers de tests : `node scripts/contract-tests.mjs T11`.
2. `jump-hosts.ts`, puis `validation.ts` et `form-values.ts`. Les tests unitaires de T10 **et** de T11 doivent passer
   avant d'attaquer l'UI.
3. Les onglets Network et Advanced.
4. `npm run format`, `npm run review` (6 + 7 + 7 + 3 scénarios), cases, statut,
   commit `feat: connection editor, network and advanced tabs (T11)`.

## Critères d'acceptation

- [x] `npm run review` passe, avec les 16 tests unitaires et les 3 scénarios de cette fiche.
- [x] Les fichiers de tests de T10 **et** de T11 sont identiques à leurs fiches : `node scripts/contract-tests.mjs T10 --check` et `node scripts/contract-tests.mjs T11 --check` affichent `OK` partout.
- [x] Aucun fichier de `editor/` ne dépasse 400 lignes.
- [x] Visuel : la chaîne « You → bastion-01 → app-01 » est lisible, avec des flèches discrètes (`text-muted-foreground`).
- [x] Visuel : les champs Wake-on-LAN n'apparaissent qu'une fois l'interrupteur activé, et Width / Height qu'avec
      « Fixed size ».

## À regarder par Florian

Dans `npm run tauri dev`, créer deux connexions SSH, puis mettre la première en bastion de la seconde. Ouvrir ensuite
la première et vérifier qu'elle ne peut pas choisir la seconde comme bastion : la liste ne la propose pas. Essayer
aussi l'argument supplémentaire `/p:test` sur une connexion RDP : il doit être refusé.
