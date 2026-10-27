# Fonctions à venir — lots 8 et 9 (cadrage du 2026-10-27)

Fonctions retenues par Florian après la revue globale (`docs/09-revue-globale.md`). Ce document fixe le périmètre et
les décisions de chacune. Les fiches détaillées s'écrivent **à la revue du lot précédent** : le lot 7 modifie le SFTP,
les onglets, le terminal et la palette, et une fiche qui cite du code pas encore écrit finirait par mentir.

Écartées pour l'instant : redirections de ports, transfert d'agent.

## Lot 8 — SFTP et onglets (écrit à la revue du lot 7)

### SFTP : sélection multiple (T54)
- Ctrl+clic, Maj+clic, Ctrl+A dans le tableau ; la sélection survit au tri, pas à la navigation.
- Télécharger et supprimer en lot. La suppression compte d'abord **tout** ce qui part (S11), un seul dialogue.
- Renommer et Droits restent des actions sur une seule entrée.

### SFTP : dossiers récursifs (T55 téléchargement, T56 envoi)
- Un dossier se transfère avec son contenu ; les liens symboliques ne sont **jamais** suivis (S11), ils sont
  ignorés et comptés dans un avertissement.
- Un transfert de dossier est **une** ligne du panneau : progression cumulée, nombre de fichiers, une annulation qui
  arrête tout et retire les `.part`.
- Nom déjà pris : ` (1)` sur le dossier de tête, comme pour un fichier.
- T56 **reprend le contrat** de T47 sur les dossiers (le refus devient un envoi) : la fiche T56 met à jour le test de
  T47 concerné.

### SFTP : éditer un fichier distant (T57 moteur, T57b interface)
- « Modifier » télécharge le fichier dans un dossier privé (`$XDG_RUNTIME_DIR/tunl/edit/…`, 0700, effacé à la
  fermeture de l'onglet et au démarrage), puis l'ouvre avec l'application par défaut (plugin `opener`).
- À chaque enregistrement local, le fichier est renvoyé (envoi par `.part`, comme T47). Si le fichier distant a
  changé entre-temps (taille ou date), on ne l'écrase pas : on demande.
- Fichiers de plus de 10 Mio : avertissement avant l'ouverture.
- À relire avec `docs/06-securite.md` : contenu jamais journalisé, dossier privé, rien hors du dossier d'édition.

### SSH ↔ SFTP en un clic (T58)
- Depuis un onglet SSH : « Ouvrir en SFTP » (menu d'onglet, palette) ouvre un onglet SFTP sur la même connexion.
- Depuis un onglet SFTP : « Ouvrir un terminal ici » ouvre un onglet SSH qui fait `cd` dans le dossier affiché
  (chemin échappé pour le shell).
- Nouvelle connexion à chaque fois (pas de multiplexage sur le lien existant) : plus simple, et chaque onglet reste
  indépendant.

### Onglets réordonnables (T59)
- Glisser-déposer dans la barre d'onglets, et Ctrl+Maj+PgPréc / PgSuiv pour déplacer l'onglet actif.
- Menu d'onglet : Dupliquer (nouvelle session sur la même cible), Fermer les autres, Fermer à droite, Ouvrir en SFTP
  (T58). Fermer plusieurs onglets connectés demande **une** confirmation.

### Rouvrir les onglets de la dernière fois (T60)
- À la fermeture, TunL retient la liste des onglets (connexion enregistrée et type ; jamais une connexion rapide,
  jamais un secret).
- Au démarrage, l'accueil propose « Rouvrir 3 onglets ». Réglage : Jamais / Demander (défaut) / Toujours.
- Une connexion supprimée depuis est ignorée sans erreur.

## Lot 9 — SSH, RDP, volets (écrit à la revue du lot 8)

### Commandes enregistrées (T61 modèle et stockage, T61b interface)
- Fichier à part `snippets.json` (0600, écriture atomique comme le store), pour ne pas changer la version de
  `connections.json`.
- Une commande : nom, texte (multiligne), connexions ou groupes où elle est proposée (toutes par défaut).
- Envoi depuis la palette (« Envoyer : … ») ou le menu du terminal, avec collage entre crochets (bracketed paste) :
  rien ne s'exécute sans Entrée. Gestion dans les Paramètres.
- Une commande n'est pas un secret : la documentation et l'interface le disent (ne pas y mettre de mot de passe).

### Clés SSH (T62 génération, T62b installation sur un serveur)
- Générer une paire ed25519 dans `~/.ssh/` (0600 / 0644), avec phrase de passe facultative, sans jamais écraser un
  fichier existant. Depuis Paramètres → SSH et depuis l'onglet Authentification de l'éditeur.
- Installer la clé publique sur un serveur (comme `ssh-copy-id`) : ajout à `~/.ssh/authorized_keys` par SFTP, création
  du dossier en 0700 et du fichier en 0600, sans doublon. Puis proposer de passer la connexion en « Clé privée ».

### RDP rapide (T63)
- `rdp://hôte[:port]` ouvre directement un onglet RDP : connexion directe seulement (pas de bastion), aucun mot de
  passe enregistré (FreeRDP le demande), réglages RDP par défaut des Paramètres.
- Nouvelle commande backend pour une cible rapide RDP. T63 **reprend le contrat** de T51 sur `rdp://` (Entrée ouvre
  l'onglet ; « Enregistrer comme nouvelle connexion… » reste proposé).

### Terminal en volets (T64 modèle, T64b rendu et focus, T64c fermeture et reconnexion)
- Un onglet SSH peut se partager en volets (vertical / horizontal, arbre de découpes) ; chaque volet est une session
  à part entière (sa tentative, son contrôle de flux de T50).
- Raccourcis : partager, fermer le volet, passer au volet suivant ; poignées de redimensionnement
  (`react-resizable-panels`, déjà là).
- La barre d'état décrit le volet actif. Fermer le dernier volet ferme l'onglet.
