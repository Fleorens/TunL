# T53 — Réglages et sondes : deux changements rapprochés gardés tous les deux, une seule alerte de sonde

| | |
|---|---|
| **Jalon** | M9 — Revue globale (lot 7) |
| **Dépend de** | T52 |
| **Lire avant** | `docs/04-ecrans.md` § « Paramètres » |
| **Livrable** | `settings/save-settings.ts` (et `settings/store.ts` si besoin), `reachability/store.ts`, `AppearanceSection.tsx` ; `src/features/settings/save-settings-order.test.ts`, `src/features/reachability/probe-alert.test.ts` |

## Pourquoi

Revue globale du 2026-10-27 :

1. **Changement perdu — supposé (lecture)** : `saveSettings(change)` applique `change` aux réglages **connus de
   l'interface**, qui ne sont mis à jour qu'au retour du backend. Deux changements rapprochés (deux interrupteurs
   basculés vite, un curseur qu'on fait glisser) : le second part de l'état d'avant le premier et l'efface à son
   retour.
2. **Alertes en rafale — supposé (lecture)** : une sonde qui échoue (store bloqué, erreur interne) affiche un toast
   d'erreur **à chaque tour** (toutes les 60 s par défaut), indéfiniment.
3. **Alignement — constaté (capture)** : dans Apparence, la liste « Barre de titre » est plus étroite que les trois
   autres listes (elle commence 43 px plus à droite).

## À réutiliser (ne pas réécrire)

- `useSettings().update` (retour `Result`), `notifyError`, `mergeResults`, `SettingRow`.

## Contrat — Frontend

- `saveSettings(change)` : les changements sont **mis en file**. Chacun est calculé sur le dernier état demandé (le
  précédent changement compris, même pas encore confirmé), puis envoyé après la fin du précédent. Un refus du backend
  affiche le toast, et l'état repart du dernier état confirmé. La signature et le retour (`Promise<boolean>`) ne
  changent pas.
- `useReachability().refresh` : un échec affiche le toast **une fois** ; les échecs suivants se taisent jusqu'à la
  prochaine réussite, qui réarme l'alerte.
- Apparence : les quatre listes ont la même largeur.

## Pièges

- Garder la file au niveau du module (`save-settings.ts`), pas dans un composant : deux sections différentes peuvent
  enregistrer en même temps.
- Pas de mutation : chaque changement reçoit un objet `Settings` et en rend un nouveau.

## Tests du contrat

### `src/features/settings/save-settings-order.test.ts` (nouveau)

```ts
// T53: two changes made before the first one is saved are both kept, in order.
import { afterEach, expect, test, vi } from "vitest";
import type { Settings } from "@/bindings/Settings";
import { ipc } from "@/lib/ipc";
import { saveSettings } from "./save-settings";
import { useSettings } from "./store";

afterEach(() => {
  vi.restoreAllMocks();
});

test("two quick changes are both kept", async () => {
  const initial = await ipc.settingsGet();
  useSettings.setState({ settings: initial });
  const sent: Settings[] = [];
  vi.spyOn(ipc, "settingsUpdate").mockImplementation(async (next) => {
    sent.push(next);
    await new Promise((resolve) => setTimeout(resolve, 10));
    return next;
  });

  const copy = !initial.terminal.copyOnSelect;
  const motion = initial.reduceMotion === "on" ? "off" : "on";
  const first = saveSettings((s) => ({ ...s, terminal: { ...s.terminal, copyOnSelect: copy } }));
  const second = saveSettings((s) => ({ ...s, reduceMotion: motion }));
  expect(await Promise.all([first, second])).toEqual([true, true]);

  expect(sent).toHaveLength(2);
  expect(sent[1]?.terminal.copyOnSelect).toBe(copy);
  expect(sent[1]?.reduceMotion).toBe(motion);
  expect(useSettings.getState().settings?.terminal.copyOnSelect).toBe(copy);
  expect(useSettings.getState().settings?.reduceMotion).toBe(motion);
});
```

### `src/features/reachability/probe-alert.test.ts` (nouveau)

```ts
// T53: a probe that keeps failing warns once, and a success re-arms the warning.
import { toast } from "sonner";
import { afterEach, expect, test, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { useReachability } from "./store";

afterEach(() => {
  vi.restoreAllMocks();
  useReachability.setState({ results: {} });
});

test("repeated failures warn once until a success", async () => {
  const alert = vi.spyOn(toast, "error").mockImplementation(() => "toast");
  const probe = vi
    .spyOn(ipc, "probeCheck")
    .mockRejectedValue({ kind: "store", message: "blocked", detail: null });

  const refresh = useReachability.getState().refresh;
  await refresh(["a"]);
  await refresh(["a"]);
  await refresh(["a"]);
  expect(alert).toHaveBeenCalledTimes(1);

  probe.mockResolvedValueOnce([]);
  await refresh(["a"]);
  await refresh(["a"]);
  expect(alert).toHaveBeenCalledTimes(2);
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T53`.
2. `save-settings.ts` : `npx vitest run src/features/settings`.
3. `reachability/store.ts` : `npx vitest run src/features/reachability`.
4. `AppearanceSection.tsx` : `npx playwright test e2e/settings.spec.ts`.
5. `npm run format`, `npm run review`, cases, statut, commit
   `fix: queue settings saves, warn once about failing probes (T53)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T53 --check` affiche `OK` partout.
- [x] Aucune nouvelle exception `project-rules: allow`.
- [x] Apparence : les quatre listes déroulantes sont alignées et de même largeur (à l'écran).

## À regarder par Florian

`npm run tauri dev`, Paramètres → Apparence : les quatre listes alignées. Bascule vite plusieurs interrupteurs du
Terminal, ferme puis rouvre les Paramètres : tous les changements sont là.
