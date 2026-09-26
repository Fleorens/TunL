---
description: Fait repasser au vert la recette d'une fiche TunL (ex. /repare T06)
model: llama-cpp/peculiar-ragdoll/Cyber-Tiel-Coder-35B-A3B-GGUF:UD-Q4_K_M
---

La fiche **$1** a été codée, mais `npm run review` échoue. Ta mission : la faire passer au vert, rien de plus.

1. Relis `AGENTS.md` (« Fiches contrat », « Quand ça bloque ») et la fiche (`ls tasks/$1-*.md`).
2. Lance `npm run review` et note **chaque** échec : commande, fichier, message exact.
3. Corrige le **code**, un échec à la fois, puis relance. Les tests fournis par la fiche ne se modifient pas.
4. Au vert : `npm run format`, `npm run review`, statut `livrée` dans `tasks/README.md`, puis commit
   `fix: make $1 acceptance pass`.
5. Compte rendu : la cause de chaque échec et ce que tu as changé. Si un échec résiste à 3 tentatives, arrête-toi
   et décris-le précisément (message, ce que tu as essayé, ton hypothèse).
