# Documentation du domaine

Comment les skills d'ingénierie lisent la documentation de TunL avant d'explorer le code. Dépôt à contexte unique.

## Avant d'explorer, lire

- **`CONTEXT.md`** à la racine, s'il existe (glossaire du domaine).
- **`docs/02-decisions.md`** : les décisions d'architecture (D01, D02…). Elles tiennent lieu d'ADR. Lire celles qui
  touchent la zone de travail.
- La **section** utile du document concerné (`docs/01-architecture.md`, `docs/05-modele-donnees.md`,
  `docs/06-securite.md`…), d'après la carte des documents d'`AGENTS.md`. Jamais un document entier.

Si `CONTEXT.md` n'existe pas, **continuer sans le signaler** ; ne pas proposer de le créer d'avance. Le skill
`/domain-modeling` le crée au moment où un terme est réellement tranché.

## Structure

```
/
├── CONTEXT.md              ← glossaire (créé au besoin)
├── docs/
│   ├── 02-decisions.md     ← décisions D01…Dnn (pas de docs/adr/)
│   └── 0x-*.md
└── src/, src-tauri/
```

Une nouvelle décision s'ajoute à `docs/02-decisions.md` sous un titre `## Dnn — <titre>`, avec le numéro suivant.
On ne crée pas de dossier `docs/adr/`.

## Utiliser le vocabulaire du glossaire

Quand une sortie nomme un concept du domaine (titre de fiche, proposition de refactorisation, hypothèse, nom de
test), employer le terme défini dans `CONTEXT.md`, sans dériver vers un synonyme qu'il écarte.

Si le concept manque au glossaire : soit on invente un langage que le projet n'emploie pas (à reconsidérer), soit il
y a un vrai manque (à noter pour `/domain-modeling`).

## Signaler les conflits avec une décision

Si une sortie contredit une décision de `docs/02-decisions.md`, le dire explicitement plutôt que passer outre :

> _Contredit D06 (fichiers JSON plutôt que SQLite), mais à rouvrir parce que…_
