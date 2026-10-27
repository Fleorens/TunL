# T42 — La version de la spec RPM vérifiée par `check-version.mjs`

| | |
|---|---|
| **Jalon** | M8 — Distribution |
| **Dépend de** | T41 |
| **Lire avant** | `scripts/check-version.mjs` (en entier, 35 lignes) ; dans `packaging/rpm/tunl.spec`, les lignes `Version:` et `%changelog` seulement |
| **Livrable** | `scripts/check-version.mjs` (modifié) ; `src/version-spec.test.ts` (contrat) |

## Pourquoi

La version de TunL est écrite à quatre endroits : `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
et la metainfo. `scripts/check-version.mjs` vérifie qu'ils concordent, et la CI de publication (`release.yml`)
l'appelle avec le tag : un tag `vX.Y.Z` qui ne correspond pas fait échouer la publication.

Depuis T41, la spec RPM de Copr (`packaging/rpm/tunl.spec`) porte aussi la version, à deux endroits :
- le champ `Version:` ;
- la dernière entrée du `%changelog` (la première sous `%changelog`), qui se termine par `- <version>-<release>`.

Le script ne les lit pas. Si on oublie de les monter, Copr construit le nouveau code sous l'ancien numéro, sans
erreur. Ces deux valeurs doivent être vérifiées comme les quatre autres.

## À réutiliser (ne pas réécrire)

- `scripts/check-version.mjs` tel qu'il est : son objet `versions` (un fichier → une version lue) et son rapport
  d'erreurs. On y ajoute deux entrées, rien d'autre.

## Contrat

### `scripts/check-version.mjs`

- Deux nouvelles entrées dans `versions`, sous ces clés exactes :
  - `"packaging/rpm/tunl.spec (Version)"` : la valeur du champ `Version:` ;
  - `"packaging/rpm/tunl.spec (%changelog)"` : dans la première entrée qui suit la ligne `%changelog`, la partie
    `<version>` de `- <version>-<release>` en fin de ligne (`0.1.0` pour `… - 0.1.0-1`).
- Une valeur introuvable s'affiche comme les autres (`no version found`).
- Le message de succès cite aussi la spec : il contient `tunl.spec`.
- Le commentaire d'en-tête dit six endroits au lieu de quatre.

## Pièges

- La spec est lue une seule fois (`readFileSync`), puis les deux expressions régulières s'appliquent au texte.
- Le `%changelog` d'un RPM liste les entrées **de la plus récente à la plus ancienne** : c'est la première qui compte.
- La partie `<release>` (`1`) ne contient pas de tiret : la version est tout ce qui précède le **dernier** tiret.
- Aucun changement à la spec ni à `release.yml` : ils sont déjà corrects.

## Tests du contrat

### `src/version-spec.test.ts` (nouveau)

```ts
// T42: the RPM spec carries the version too; check-version.mjs reads it, so a release tag that forgets it fails.
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import pkg from "../package.json";
import spec from "../packaging/rpm/tunl.spec?raw";

const checkVersion = (...args: string[]) =>
  spawnSync("node", ["scripts/check-version.mjs", ...args], { encoding: "utf8" });

describe("the RPM spec version", () => {
  test("its Version: field is the app version", () => {
    expect(spec.match(/^Version:\s*(\S+)/m)?.[1]).toBe(pkg.version);
  });

  test("its latest %changelog entry is for the app version", () => {
    const entry = spec.split(/^%changelog$/m)[1]?.match(/^\* .+ - (\S+)-[^-\s]+$/m)?.[1];
    expect(entry).toBe(pkg.version);
  });
});

describe("check-version.mjs", () => {
  test("passes on the current tree and names the spec", () => {
    const run = checkVersion(`v${pkg.version}`);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("tunl.spec");
  });

  test("a tag the spec does not carry fails, naming both places in the spec", () => {
    const run = checkVersion("v0.0.0-test");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("packaging/rpm/tunl.spec (Version)");
    expect(run.stderr).toContain("packaging/rpm/tunl.spec (%changelog)");
  });
});
```

## Étapes

1. Les tests du contrat : `node scripts/contract-tests.mjs T42`. `npx vitest run src/version-spec.test.ts` : les
   deux tests de `check-version.mjs` échouent, les deux autres passent.
2. `scripts/check-version.mjs` : les deux entrées, le message de succès, le commentaire d'en-tête.
   `npx vitest run src/version-spec.test.ts` passe, et `node scripts/check-version.mjs v0.1.0` affiche le succès.
3. `npm run format`, `npm run verify`, cases, statut, commit
   `chore: check the RPM spec version and changelog in check-version.mjs (T42)`.

## Critères d'acceptation

- [ ] `node scripts/contract-tests.mjs T42 --check` affiche `OK`, et `npm run verify` passe.
- [ ] `node scripts/check-version.mjs v0.1.0` réussit ; `node scripts/check-version.mjs v0.2.0` échoue et cite les
      six endroits, dont les deux de la spec.
- [ ] Aucun fichier modifié hors de `scripts/check-version.mjs`, du test du contrat, de cette fiche et de
      `tasks/README.md`.

## À regarder par Florian

Rien à l'écran. À la prochaine version, la CI de publication refusera un tag si la spec n'a pas été montée.
