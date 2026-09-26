---
description: Exécute une fiche de tâche TunL (ex. /tache T03)
model: llama-cpp/peculiar-ragdoll/Cyber-Tiel-Coder-35B-A3B-GGUF:UD-Q4_K_M
---

Exécute la fiche de tâche **$1** du projet TunL.

1. Relis `AGENTS.md` : son « Déroulé obligatoire d'une session » s'applique à la lettre.
2. Trouve la fiche avec `ls tasks/$1-*.md`, puis lis-la en entier.
3. Vérifie `git status` et, dans `tasks/README.md`, le statut des fiches listées dans « Dépend de ».
   Si le point de départ n'est pas bon, arrête-toi et explique pourquoi.
4. Déroule les étapes de la fiche dans l'ordre, sans rien ajouter.
5. Termine par `npm run format`, puis `npm run verify` (sauf si la fiche dit autrement), cases cochées, statut
   `livrée`, commit, et compte rendu au format d'`AGENTS.md`.

Rappel : si la même erreur résiste à 3 tentatives, tu t'arrêtes et tu décris le blocage. Aucun contournement.
