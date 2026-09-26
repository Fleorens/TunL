---
description: Exécute une fiche de tâche TunL (ex. /tache T06)
model: llama-cpp/peculiar-ragdoll/Cyber-Tiel-Coder-35B-A3B-GGUF:UD-Q4_K_M
---

Exécute la fiche de tâche **$1** du projet TunL.

1. Relis `AGENTS.md` : le « Déroulé obligatoire d'une session » et les « Fiches contrat » s'appliquent à la lettre.
2. Trouve la fiche avec `ls tasks/$1-*.md`, puis lis-la en entier.
3. Vérifie `git status` et, dans `tasks/README.md`, le statut des fiches listées dans « Dépend de ».
   Si le point de départ n'est pas bon, arrête-toi et explique pourquoi.
4. Crée d'abord les tests fournis par la fiche, **à l'identique**. Ensuite, écris le code.
5. Boucle : `npm run review` → corrige le code → recommence, jusqu'au vert. Ne modifie jamais un test fourni.
6. Termine : `npm run format`, `npm run review` vert, cases cochées (sauf les critères visuels), statut `livrée`,
   commit, et compte rendu au format d'`AGENTS.md`.

Rappel : si la même erreur résiste à 3 tentatives, tu t'arrêtes et tu décris le blocage. Aucun contournement.
