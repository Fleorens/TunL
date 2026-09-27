---
description: Fait repasser au vert la recette d'une fiche TunL (ex. /repare T06)
model: llama-cpp/peculiar-ragdoll/Cyber-Tiel-Coder-35B-A3B-GGUF:Q4_K_M
---

La fiche **$1** a été codée, mais `npm run review` échoue. Ta mission : la faire passer au vert, rien de plus.

`AGENTS.md` est déjà dans tes instructions : ne le relis pas (« Contexte limité » et « Quand ça bloque »
s'appliquent).

1. `node scripts/contract-tests.mjs $1 --check` : un test du contrat modifié se remet d'abord à l'identique avec
   `node scripts/contract-tests.mjs $1`.
2. Lance `npm run review` et note **chaque** échec : commande, fichier, message exact.
3. Ne lis pas toute la fiche : `grep -nE '^#{2,4} ' tasks/$1-*.md` donne l'index, puis lis seulement la section qui
   concerne l'échec.
4. Corrige le **code**, un échec à la fois, puis relance. Les tests fournis par la fiche ne se modifient pas.
5. Au vert : `npm run format`, `npm run review`, `--check` tout `OK`, statut `livrée` dans `tasks/README.md`, puis
   commit `fix: make $1 acceptance pass`.
6. Compte rendu : la cause de chaque échec et ce que tu as changé. Si un échec résiste à 3 tentatives, arrête-toi
   et décris-le précisément (message, ce que tu as essayé, ton hypothèse).
