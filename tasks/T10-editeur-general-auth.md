# T10 — Éditeur de connexion : Général et Authentification

| | |
|---|---|
| **Jalon** | M1 — Connexions |
| **Dépend de** | T09 |
| **Lire avant** | `docs/04-ecrans.md` §3, `docs/05-modele-donnees.md` §2 et §6, `docs/03-design.md` §1.4, §7, §8 et §10 (le reste du design est déjà en place dans `src/index.css` et `src/components/`) |
| **Livrable** | Feuille latérale de création et de modification (onglets Général et Authentification), 14 tests unitaires et 7 scénarios e2e verts |

## Pourquoi

C'est l'écran où l'utilisateur crée ses machines. Il doit être agréable :
- validation en direct, avec le message sous le champ ;
- port qui suit le protocole ;
- `Ctrl+S` pour enregistrer ;
- aucune perte silencieuse d'une saisie.

Les onglets Réseau et Avancé arrivent en T11. Les champs mot de passe et trousseau, en T12.

## Contrat

### Dépendances

```bash
npm install react-hook-form@^7.89 @hookform/resolvers@^5.9 zod@^4.6
CI=1 npx shadcn add toggle-group radio-group -y </dev/null
```

Prototype fait par l'orchestrateur le 2026-09-26 (react-hook-form 7.89, resolvers 5.9.1, zod 4.6.5, TypeScript 6).
Le code suivant compile sans autre générique :

```ts
useForm<ConnectionFormValues>({ resolver: zodResolver(connectionFormSchema), mode: "onChange", defaultValues })
```

À condition que `ConnectionFormValues = z.infer<typeof connectionFormSchema>` et que le schéma n'ait **aucune
transformation de type**. `.trim()` est permis : l'entrée et la sortie restent des `string`.

### Fichiers

```
src/features/connections/editor/
├── form-values.ts       schéma zod, type ConnectionFormValues, toFormValues, toConnectionInput, backendFieldError
├── validation.ts        isValidHost, isValidPath, hasControlChars, TAG_PATTERN, VALIDATION_CODES, isValidationCode
├── ConnectionEditor.tsx Sheet, en-tête, onglets, pied, clavier, confirmation d'abandon
├── GeneralTab.tsx  AuthTab.tsx  TagsInput.tsx  FieldError.tsx  ProtocolSwitch.tsx
└── form-values.test.ts  ⚠ fourni
e2e/editor.spec.ts       ⚠ fourni
```

### Les valeurs du formulaire : que des chaînes, jamais `null`

Un `<input>` n'accepte pas `null`, et une conversion dans le schéma casserait le typage (voir plus haut). Le
formulaire manipule donc **uniquement** des chaînes, des booléens et des tableaux de chaînes. La conversion vers
`ConnectionInput` se fait à part, dans des fonctions pures testées.

```ts
// Shape at the end of T10 (T11 adds the Network and Advanced fields).
{
  protocol: "ssh" | "rdp";
  name: string; host: string; port: string; username: string;
  groupId: string;                          // "" = no group
  tags: string[];
  color: AccentColor | "";                  // "" = no color
  notes: string;
  sshAuthMethod: "password" | "key" | "agent";
  sshKeyPath: string;
  rdpDomain: string;
}

export function toFormValues(input: ConnectionInput, templates: ConnectionTemplates): ConnectionFormValues;
export function toConnectionInput(
  values: ConnectionFormValues,
  base: ConnectionInput,                    // the edited connection (toInput) or the template
  templates: ConnectionTemplates,
): ConnectionInput;
export function backendFieldError(error: AppError): { field: keyof ConnectionFormValues; message: string } | null;
```

- `toFormValues` :
  - `null` → `""` ; port → `String(port)` ;
  - les champs SSH d'une connexion RDP (et inversement) prennent les valeurs du modèle de l'autre protocole ;
  - `sshKeyPath` vaut `""` sauf avec `{ method: "key" }`.
- `toConnectionInput` :
  - `trim` sur `name`, `host`, `username`, `sshKeyPath` et `rdpDomain` ;
  - `""` (après `trim`) → `null` pour `username`, `groupId`, `color`, `notes` et `domain` ;
  - `port` → `Number` ;
  - `notes` non vides gardées **telles quelles** ;
  - `favorite`, `jumpHostId` et `wol` viennent de `base` (le formulaire ne les édite pas encore) ;
  - `settings` : si `values.protocol` est celui de `base`, on part de `base.settings`, sinon de
    `templates[values.protocol].settings`. Puis :
    - SSH : `auth` vient de la méthode (`{ method: "key", path }` seulement pour une clé) ;
    - RDP : `domain`.
- `backendFieldError` : seulement pour `kind === "validation"`. Le message `"<chemin>: <raison>"` est coupé au premier
  `": "`. Chemins reconnus : `name`, `host`, `port`, `username`, `tags`, `notes`, `groupId`, `settings.auth.path`
  (→ `sshKeyPath`), `settings.domain` (→ `rdpDomain`). Tout autre chemin → `null` : l'erreur part en toast.

### Le schéma

Les règles de `docs/05-modele-donnees.md` §6, reproduites **à l'identique** pour le confort (le Rust reste l'autorité).

- Chaque message d'erreur est un **code** de `VALIDATION_CODES`, affiché par `FieldError` via `t(\`validation.${code}\`)`.
  Un message qui n'est pas un code (erreur renvoyée par le backend) s'affiche tel quel.
- `superRefine` pour tout ce qui dépend d'un autre champ : le chemin de la clé n'est exigé et contrôlé que si
  `protocol === "ssh"` et `sshAuthMethod === "key"`. Émettre les erreurs avec
  `ctx.addIssue({ code: "custom", message: "<code>", path: ["<champ>"] })`.
- **Un champ vide ne produit QUE `required`.** Les contrôles suivants ignorent la chaîne vide, ou le `min(1)` porte
  `{ error: "required", abort: true }`. Sinon un hôte vide renverrait deux erreurs.
  Exception : le port n'a qu'un seul code, `invalidPort`, y compris quand il est vide.
- Les étiquettes du formulaire sont déjà en minuscules : `TagsInput` applique `trim().toLowerCase()` à la saisie. Le
  schéma exige `TAG_PATTERN` (`/^[a-z0-9._-]{1,24}$/`) et 10 étiquettes au plus.

| Code | Anglais (`validation.*`) |
|---|---|
| `required` | Required |
| `tooLong` | Too long |
| `controlChars` | Contains a forbidden character |
| `invalidHost` | Enter a host name or an IP address |
| `invalidPort` | Enter a port between 1 and 65535 |
| `invalidTag` | Letters, digits, dots, dashes and underscores only |
| `tooManyTags` | 10 tags at most |
| `invalidPath` | Use an absolute path or one starting with ~/ |

`isValidHost` : IPv4 (4 nombres de 0 à 255), IPv6 sans crochets (seulement des chiffres hexadécimaux et des `:`, avec
au moins un `:`), ou nom d'hôte (étiquettes `[A-Za-z0-9_-]{1,63}` séparées par `.`, sans `-` au début ni à la fin).
Pas plus de 253 caractères.

### L'éditeur

- **Ouverture** : `useUi` gagne `editor: EditorTarget | null`, `openEditor(target)` et `closeEditor()`, avec
  `type EditorTarget = { mode: "create"; protocol?: Protocol } | { mode: "edit"; id: string }`.
  Déclencheurs :
  - bouton « New » de la TopBar ;
  - bouton « New connection » de l'accueil ;
  - raccourci `connection.new` (`Ctrl+Shift+N`) dans `AppLayout` ;
  - « Edit » du menu contextuel.

  `<ConnectionEditor />` est rendu une seule fois, dans `AppLayout`.
- **Valeurs initiales** :
  - création : `toFormValues(templates[protocol ?? "ssh"], templates)` ;
  - modification : `toFormValues(toInput(connexion), templates)`. Connexion introuvable → fermeture et `notifyError`.

  Le formulaire est **réinitialisé** (`reset`) à chaque ouverture.
- **Feuille** : `Sheet` à droite, largeur 520 px (`w-full sm:max-w-130`).
  - Titre (`SheetTitle`) : « New connection », ou « Edit {{name}} » avec le nom **enregistré** (pas la saisie en cours).
  - Sous le titre, `ProtocolSwitch` : un `ToggleGroup` `type="single"` avec « SSH » et « RDP ».
    Le désélectionner (valeur `""`) ne fait rien.
- **Port qui suit le protocole** : un `ref` `portTouched`, mis à `true` quand l'utilisateur modifie le champ Port.
  Tant qu'il vaut `false`, changer de protocole remplace le port par celui du modèle. `setValue` avec
  `{ shouldValidate: true }`, et `{ shouldDirty: true }` pour le protocole seulement.
- **Onglets** (`Tabs`) : « General », « Authentication ».
  - General : Name*, Host* et Port (sur une ligne), Username, Group, Tags, Color, Notes.
  - Authentication, SSH : méthode en `RadioGroup` de cartes, « Password », « Private key », « SSH agent ».
    - Private key → champ « Key path » (placeholder `~/.ssh/id_ed25519`).
    - Password → texte « You will be asked for the password when connecting. ».
    - SSH agent → texte « Uses the keys loaded in your SSH agent. ».
  - Authentication, RDP : « Domain », et le même texte que pour le mot de passe.
  - Chaque champ : `<Label htmlFor>` + `id`, exactement le libellé du tableau des textes (les tests le cherchent par son
    libellé).
- **Group** : `Select` avec :
  - « No group » ;
  - les groupes du store ;
  - un séparateur ;
  - « New group… », qui ouvre le `GroupDialog` de T09 et sélectionne le groupe créé.
- **Tags** : `TagsInput`.
  - Chaque étiquette est un chip avec un bouton de retrait, `aria-label` « Remove tag {{tag}} ».
  - `Entrée` ou `,` ajoute l'étiquette (sauf si vide ou déjà présente).
  - `Retour arrière` dans le champ vide retire la dernière.
- **Color** : le `ColorPicker` de T09.
- **Pied collant** :
  - à gauche, « Delete » (destructive, modification seulement), avec confirmation (`AlertDialog` de T09) ;
  - à droite, « Cancel » et « Save ».
  - « Save » est désactivé si `!formState.isValid || formState.isSubmitting`.
- **Enregistrer** :
  - `toConnectionInput`, puis `create` ou `update` du store ;
  - succès : fermeture et `toast.success(t("editor.saved", { name }))` ;
  - erreur avec `backendFieldError` : `setError` sur le champ, et bascule vers l'onglet qui le contient ;
  - autre erreur : `notifyError`.
- **Clavier** : sur le contenu de la feuille, `Ctrl+S` (et `⌘S`) → `preventDefault()`, puis enregistre si le formulaire
  est valide.
- **Fermer** (`Échap`, croix, clic hors de la feuille, « Cancel ») passe par une seule fonction `requestClose()`.
  - Formulaire modifié (`formState.isDirty`) → `AlertDialog` « Discard changes? », avec « Keep editing » et
    « Discard ».
  - Sinon, fermeture directe.

  Le plus simple : intercepter `onOpenChange(false)` de la `Sheet`, que Radix appelle dans tous ces cas.

### Textes (anglais exact ; en français dans `fr.json`)

| Clé | Anglais |
|---|---|
| `editor.createTitle` / `editTitle` | New connection / Edit {{name}} |
| `editor.tabs.general` / `authentication` | General / Authentication |
| `editor.fields.name` / `host` / `port` / `username` / `group` / `tags` / `color` / `notes` | Name / Host / Port / Username / Group / Tags / Color / Notes |
| `editor.fields.keyPath` / `domain` | Key path / Domain |
| `editor.auth.password` / `key` / `agent` | Password / Private key / SSH agent |
| `editor.auth.passwordHint` | You will be asked for the password when connecting. |
| `editor.auth.agentHint` | Uses the keys loaded in your SSH agent. |
| `editor.noGroup` / `newGroup` | No group / New group… |
| `editor.removeTag` | Remove tag {{tag}} |
| `editor.saved` | “{{name}}” saved |
| `editor.discardTitle` / `discard` / `keepEditing` | Discard changes? / Discard / Keep editing |

Les boutons « Save », « Cancel » et « Delete » reprennent les clés `common.*` existantes.

### Pièges

- **Radix `Select` interdit `value=""` sur un `SelectItem`** : l'app plante à l'ouverture. Utiliser une valeur
  sentinelle (`"__none__"`) pour « No group », et la convertir en `""` dans le `Controller`.
- Les champs contrôlés par Radix (`Select`, `RadioGroup`, `ToggleGroup`) passent par un `Controller` de
  react-hook-form, pas par `register`.
- Radix `Tabs` démonte l'onglet inactif. C'est sans danger, parce que react-hook-form garde les valeurs
  (`shouldUnregister` vaut `false` par défaut). Ne pas passer `shouldUnregister: true`.
- zod 4 : `{ error: "code" }`, pas `{ message: "code" }` dans les paramètres d'un schéma. Dans `ctx.addIssue`, c'est
  bien `message`.
- Playwright cherche les champs avec `exact: true` : « Name » ne doit pas être le libellé d'un autre champ, et
  « Username » ne gêne pas.

## Tests du contrat

### `src/features/connections/editor/form-values.test.ts`

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

const templates: ConnectionTemplates = {
  ssh: {
    ...common,
    port: 22,
    settings: { protocol: "ssh", auth: { method: "password" }, keepaliveSecs: null, connectTimeoutSecs: null },
  },
  rdp: {
    ...common,
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
  },
  wol: { mac: "", broadcast: "255.255.255.255", port: 9, wakeBeforeConnect: false, waitTimeoutSecs: 120 },
};

const richSsh: ConnectionInput = {
  ...templates.ssh,
  name: "db-prod",
  host: "db.internal",
  port: 2222,
  username: "root",
  groupId: "g-1",
  tags: ["prod", "pg"],
  favorite: true,
  color: "violet",
  notes: "primary database",
  jumpHostId: "j-1",
  settings: {
    protocol: "ssh",
    auth: { method: "key", path: "~/.ssh/id_ed25519" },
    keepaliveSecs: 30,
    connectTimeoutSecs: null,
  },
};

function valid(patch: Partial<ConnectionFormValues> = {}): ConnectionFormValues {
  return { ...toFormValues(templates.ssh, templates), name: "web-01", host: "10.0.0.12", ...patch };
}

function issuesOf(values: ConnectionFormValues): Record<string, string> {
  const result = connectionFormSchema.safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((issue) => [String(issue.path[0]), issue.message]));
}

describe("form values", () => {
  it("round-trips a connection input", () => {
    expect(toConnectionInput(toFormValues(richSsh, templates), richSsh, templates)).toEqual(richSsh);
  });

  it("fills the form with strings, never null", () => {
    expect(toFormValues(templates.ssh, templates)).toMatchObject({
      protocol: "ssh",
      name: "",
      port: "22",
      username: "",
      groupId: "",
      color: "",
      notes: "",
      sshAuthMethod: "password",
      sshKeyPath: "",
      rdpDomain: "",
    });
  });

  it("turns empty fields into null and trims text", () => {
    const values = valid({ name: "  web-01 ", username: "  ", notes: " ", port: "2222" });
    expect(toConnectionInput(values, templates.ssh, templates)).toMatchObject({
      name: "web-01",
      username: null,
      groupId: null,
      color: null,
      notes: null,
      port: 2222,
    });
  });

  it("takes the settings of a new protocol from its template", () => {
    const input = toConnectionInput(valid({ protocol: "rdp", rdpDomain: " CORP " }), richSsh, templates);
    expect(input.settings).toEqual({ ...templates.rdp.settings, domain: "CORP" });
  });

  it("builds the SSH authentication from the chosen method", () => {
    const withKey = toConnectionInput(valid({ sshAuthMethod: "key", sshKeyPath: " ~/.ssh/id " }), templates.ssh, templates);
    expect(withKey.settings).toMatchObject({ protocol: "ssh", auth: { method: "key", path: "~/.ssh/id" } });
    const agent = toConnectionInput(valid({ sshAuthMethod: "agent", sshKeyPath: "~/.ssh/id" }), templates.ssh, templates);
    expect(agent.settings).toMatchObject({ protocol: "ssh", auth: { method: "agent" } });
  });
});

describe("form schema", () => {
  it("accepts a minimal valid connection", () => {
    expect(issuesOf(valid())).toEqual({});
  });

  it("requires a name, bounded and without control characters", () => {
    expect(issuesOf(valid({ name: "  " }))).toEqual({ name: "required" });
    expect(issuesOf(valid({ name: "a\tb" }))).toEqual({ name: "controlChars" });
    expect(issuesOf(valid({ name: "x".repeat(81) }))).toEqual({ name: "tooLong" });
  });

  it("checks the host like the backend does", () => {
    for (const host of ["10.0.0.12", "fe80::1", "db.internal", "my_host-01.example.com"]) {
      expect(issuesOf(valid({ host }))).toEqual({});
    }
    for (const host of ["bad host", "user@host", "a/b", "-lead.example", "a..b", "[::1]"]) {
      expect(issuesOf(valid({ host }))).toEqual({ host: "invalidHost" });
    }
    expect(issuesOf(valid({ host: "" }))).toEqual({ host: "required" });
  });

  it("checks the port", () => {
    for (const port of ["0", "65536", "22a", "", "-1"]) {
      expect(issuesOf(valid({ port }))).toEqual({ port: "invalidPort" });
    }
  });

  it("checks tags", () => {
    expect(issuesOf(valid({ tags: ["no spaces"] }))).toEqual({ tags: "invalidTag" });
    const eleven = Array.from({ length: 11 }, (_, index) => `t${index}`);
    expect(issuesOf(valid({ tags: eleven }))).toEqual({ tags: "tooManyTags" });
  });

  it("requires a usable key path only for key authentication", () => {
    expect(issuesOf(valid({ sshAuthMethod: "key", sshKeyPath: "" }))).toEqual({ sshKeyPath: "required" });
    expect(issuesOf(valid({ sshAuthMethod: "key", sshKeyPath: "id_rsa" }))).toEqual({ sshKeyPath: "invalidPath" });
    expect(issuesOf(valid({ sshAuthMethod: "key", sshKeyPath: "~/.ssh/id_ed25519" }))).toEqual({});
    expect(issuesOf(valid({ sshAuthMethod: "password", sshKeyPath: "id_rsa" }))).toEqual({});
  });

  it("ignores the SSH fields of an RDP connection", () => {
    expect(issuesOf(valid({ protocol: "rdp", sshAuthMethod: "key", sshKeyPath: "" }))).toEqual({});
    expect(issuesOf(valid({ protocol: "rdp", rdpDomain: "CO\nRP" }))).toEqual({ rdpDomain: "controlChars" });
  });
});

describe("backend errors", () => {
  it("attaches a backend validation error to its form field", () => {
    const error: AppError = { kind: "validation", message: "settings.auth.path: must be absolute", detail: null };
    expect(backendFieldError(error)).toEqual({ field: "sshKeyPath", message: "must be absolute" });
    const host: AppError = { ...error, message: "host: invalid host name" };
    expect(backendFieldError(host)).toEqual({ field: "host", message: "invalid host name" });
  });

  it("leaves the other errors to a toast", () => {
    expect(backendFieldError({ kind: "io", message: "name: disk full", detail: null })).toBeNull();
    expect(backendFieldError({ kind: "validation", message: "ids: must list every group", detail: null })).toBeNull();
  });
});
```

### `e2e/editor.spec.ts`

```ts
import { expect, type Page, test } from "@playwright/test";

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

test("creating a connection from the keyboard shortcut", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await expect(editor(page).getByRole("heading", { name: "New connection" })).toBeVisible();
  await field(page, "Name").fill("staging");
  await field(page, "Host").fill("10.1.1.1");
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  const ungrouped = page.getByRole("region", { name: "Ungrouped", exact: true });
  await expect(ungrouped.getByRole("button", { name: /^staging/ })).toBeVisible();
});

test("Save stays disabled until the form is valid", async ({ page }) => {
  await page.getByRole("button", { name: "New", exact: true }).click();
  const save = editor(page).getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  await field(page, "Name").fill("x");
  await field(page, "Host").fill("bad host");
  await expect(editor(page).getByText("Enter a host name or an IP address")).toBeVisible();
  await expect(save).toBeDisabled();
  await field(page, "Host").fill("good.host");
  await expect(save).toBeEnabled();
});

test("the port follows the protocol until the user edits it", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  const port = field(page, "Port");
  await expect(port).toHaveValue("22");
  await editor(page).getByRole("radio", { name: "RDP", exact: true }).click();
  await expect(port).toHaveValue("3389");
  await port.fill("3390");
  await editor(page).getByRole("radio", { name: "SSH", exact: true }).click();
  await expect(port).toHaveValue("3390");
});

test("editing from the context menu, saved with Ctrl+S", async ({ page }) => {
  await openEdit(page, "pi-hole");
  await expect(editor(page).getByRole("heading", { name: "Edit pi-hole" })).toBeVisible();
  await expect(field(page, "Name")).toHaveValue("pi-hole");
  await field(page, "Name").fill("pi-dns");
  await page.keyboard.press("Control+s");
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^pi-dns/ }).first()).toBeVisible();
});

test("closing with unsaved changes asks first", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await field(page, "Name").fill("draft");
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Discard changes?");
  await confirm.getByRole("button", { name: "Keep editing" }).click();
  await expect(field(page, "Name")).toHaveValue("draft");
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("deleting from the editor", async ({ page }) => {
  await openEdit(page, "media-server");
  await editor(page).getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^media-server/ })).toHaveCount(0);
});

test("SSH key authentication needs a usable path", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await field(page, "Name").fill("keyed");
  await field(page, "Host").fill("10.2.2.2");
  await editor(page).getByRole("tab", { name: "Authentication" }).click();
  await editor(page).getByRole("radio", { name: "Private key", exact: true }).click();
  await field(page, "Key path").fill("id_rsa");
  await expect(editor(page).getByText("Use an absolute path or one starting with ~/")).toBeVisible();
  await field(page, "Key path").fill("~/.ssh/id_ed25519");
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: /^keyed/ }).first()).toBeVisible();
});
```

## Étapes

1. Dépendances, puis les deux fichiers de tests : `node scripts/contract-tests.mjs T10`.
2. `validation.ts` et `form-values.ts` : `npm run test` doit passer le test unitaire avant d'attaquer l'UI.
3. Les composants, `useUi`, et le branchement des déclencheurs (TopBar, accueil, raccourci, menu contextuel).
4. `npm run format`, `npm run review` (6 + 7 + 7 scénarios), cases, statut,
   commit `feat: connection editor, general and authentication tabs (T10)`.

## Critères d'acceptation

- [x] `npm run review` passe, avec les 14 tests de `form-values.test.ts` et les 7 scénarios de `editor.spec.ts`.
- [x] Les fichiers de tests sont identiques à la fiche : `node scripts/contract-tests.mjs T10 --check` affiche `OK` partout.
- [x] Aucun fichier de `editor/` ne dépasse 400 lignes, aucune fonction ne dépasse 50 lignes.
- [x] `grep -rn "as unknown as\|: any\|@ts-ignore" src/features/connections` est vide.
- [x] Visuel : feuille de 520 px à droite, pied collant, champs Hôte et Port sur une même ligne.
- [x] Visuel : le message d'erreur apparaît sous le champ, en couleur `destructive`, sans décaler le reste du formulaire
      de façon brutale.

## À regarder par Florian

Dans `npm run tauri dev` :
- créer une vraie connexion avec « New » ou `Ctrl+Shift+N`, la modifier (clic droit → Edit), puis la supprimer ;
- vérifier que `~/.config/io.github.fleorens.TunL/connections.json` apparaît, en `-rw-------`, avec un
  `connections.json.bak` dès la deuxième modification.
