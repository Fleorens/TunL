---
description: Exécute une fiche de tâche TunL (ex. /tache T06)
model: llama-cpp/peculiar-ragdoll/Cyber-Tiel-Coder-35B-A3B-GGUF:Q4_K_M
---

Exécute la fiche de tâche **$1** du projet TunL.

`AGENTS.md` est déjà dans tes instructions : ne le relis pas. Son « Déroulé obligatoire », « Contexte limité » et
« Fiches contrat » s'appliquent à la lettre.

1. `ls tasks/$1-*.md`, puis `grep -nE '^#{2,4} ' tasks/$1-*.md` : garde cet index (sections et numéros de ligne).
2. Lis la fiche **une fois**, **sans** la section « Tests du contrat » (le script l'écrit à l'étape 4) :
   `awk '/^## Tests du contrat/{s=1} /^## Étapes/{s=0} !s' tasks/$1-*.md`.
   Un test ne se lit que s'il échoue, dans son fichier, pas dans la fiche.
   Des documents de « Lire avant », lis seulement les sections citées.
3. Point de départ : `git status` propre. Sinon, arrête-toi et explique pourquoi.
4. Tests du contrat : `node scripts/contract-tests.mjs $1`. Tu ne les recopies pas, tu ne les modifies jamais.
   Le script vérifie aussi « Dépend de » : s'il refuse (code 3, « STOP »), **arrête la session tout de suite**,
   sans écrire de code ni de bouchon, et rapporte-le. Ce refus ne se contourne pas.
5. Code : fichier par fichier, dans l'ordre des « Étapes ». Pour chacun, relis seulement sa section de la fiche
   (index de l'étape 1), et sers-toi de ce que liste « À réutiliser ». Dès que la logique est écrite :
   `npm run typecheck`, `npm run rules` et `npx vitest run <dossier>`, avant l'interface.
6. Boucle : `npm run review` → corrige le code → recommence, jusqu'au vert.
7. Termine : `npm run format`, `npm run review` vert, `node scripts/contract-tests.mjs $1 --check` tout `OK`,
   cases cochées (sauf les critères visuels), statut `livrée`, commit, et compte rendu au format d'`AGENTS.md`.

Après une compaction : `git status --short` et l'index de la fiche te disent où reprendre. Ne relis pas tout.
Si la même erreur résiste à 3 tentatives, tu t'arrêtes et tu décris le blocage. Aucun contournement.
