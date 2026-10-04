# Suivi des tâches : fiches `tasks/`

Les « issues » de TunL sont les **fiches** `tasks/Txx-*.md`. Pas de GitHub ni de GitLab : `origin` est un dépôt nu
local, `gh` et `glab` ne servent pas.

## Conventions

- Une fiche = un ticket : `tasks/T<NN>[b]-<slug>.md` (slug en français, kebab-case). Une fiche nouvelle prend le
  numéro suivant ; une fiche découpée après coup prend le suffixe `b` (ex. `T17b`).
- Structure : tableau d'en-tête (Jalon, Dépend de, Lire avant, Livrable), puis « Pourquoi », « À réutiliser »,
  « Contrat », « Tests du contrat », « Étapes », « Critères d'acceptation ». Modèle : une fiche récente, par exemple
  `tasks/T21b-prompts.md`.
- Le statut vit **uniquement** dans `tasks/README.md`, colonne « Statut » du tableau du jalon (voir
  `triage-labels.md`). La fiche elle-même ne porte pas de statut.
- Les dépendances sont dans la colonne « Dépend de » ; `node scripts/contract-tests.mjs Txx` refuse une fiche dont
  les dépendances ne sont pas `livrée` ou `validée`.
- Les remarques et l'historique s'ajoutent en bas de la fiche, sous un titre `## Commentaires`.

## Quand un skill dit « publier dans le tracker »

1. Créer `tasks/T<NN>-<slug>.md` selon la structure ci-dessus.
2. Ajouter sa ligne dans le tableau du jalon de `tasks/README.md` : Fiche, Titre, Dépend de, Risque, Repli, Statut.

## Quand un skill dit « récupérer le ticket »

L'utilisateur donne l'identifiant (`T21b`) ou le chemin : `ls tasks/T21b-*.md`. Lire la fiche selon les règles
d'`AGENTS.md` (une seule lecture, sans les blocs « Tests du contrat »).

## Wayfinding

Utilisé par `/wayfinder`. Une exploration n'est pas une fiche : elle vit dans `.scratch/<effort>/`.

- **Carte** : `.scratch/<effort>/map.md` (Notes / Decisions-so-far / Fog).
- **Ticket enfant** : `.scratch/<effort>/issues/NN-<slug>.md`, numéroté à partir de `01`, la question dans le corps.
  Une ligne `Type:` (`research`/`prototype`/`grilling`/`task`), une ligne `Status:` (`claimed`/`resolved`).
- **Blocage** : une ligne `Blocked by: NN, NN` en tête. Un ticket est débloqué quand tous ceux qu'il cite sont
  `resolved`.
- **Frontière** : les fichiers de `.scratch/<effort>/issues/` ouverts, débloqués et non pris ; le plus petit numéro
  gagne.
- **Prendre** : passer à `Status: claimed` et enregistrer avant tout travail.
- **Résoudre** : ajouter la réponse sous `## Answer`, passer à `Status: resolved`, puis ajouter un pointeur (résumé +
  lien) dans la section Decisions-so-far de `map.md`.
- Une exploration qui débouche sur du code à écrire devient une fiche `tasks/` (voir « publier dans le tracker »).
