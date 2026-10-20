# 04 — Écrans

Les tokens et composants sont décrits dans `03-design.md`. Ici, on décrit la **disposition** et le **comportement**
de chaque écran. Les schémas ASCII donnent les proportions, pas le pixel près.
Les textes sont en français pour la lecture, mais **tous** passent par l'i18n.

## 1. Fenêtre principale

Fenêtre par défaut 1280 × 800, minimum 960 × 600. Taille et position mémorisées (plugin `window-state`).

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ [◧] ◆ TunL        [ ⌕ Rechercher ou se connecter…        Ctrl ⇧ P ]     [+ Nouvelle] [⚙] │ TopBar 48 px
├──────────────────────┬──────────────────────────────────────────────────────────────┤
│ [⌕ Filtrer…      ]   │ ● web-01  ✕ │ ◌ db-prod  ✕ │ ● ad-01  ✕ │  +                     │ TabBar 40 px
│                      │ ▔▔▔▔▔▔▔▔▔▔▔ (indicateur dégradé glissant)                         │
│ FAVORIS              ├──────────────────────────────────────────────────────────────┤
│ ▣ web-01          ●  │                                                              │
│ ▭ ad-01           ●  │                                                              │
│ RÉCENTS              │                    ZONE DE CONTENU                           │
│ ▣ db-prod         ◌  │     (terminal, SFTP, carte RDP, paramètres — ou Accueil)     │
│ GROUPES              │                                                              │
│ ▾ ● Production    4  │                                                              │
│    ▣ db-prod      ◌  │                                                              │
│    ▣ web-01       ●  │                                                              │
│ ▸ ● Homelab       7  │                                                              │
│ SANS GROUPE          │                                                              │
│    ▣ nas          ○  │                                                              │
│──────────────────────│                                                              │
│ 14 connexions  [⇩]   │                                                              │
├──────────────────────┴──────────────────────────────────────────────────────────────┤
│ 3 sessions actives                    SSH · deploy@10.0.0.12 · via bastion · 120×40 │ StatusBar 28 px
└─────────────────────────────────────────────────────────────────────────────────────┘
```

Légende : `▣` = icône SSH (vert menthe), `▭` = RDP (bleu), `●` = en ligne, `◌` = en connexion (pulse), `○` = hors ligne.

### TopBar (fond `sidebar`, bordure basse `border`)
- Gauche : bouton icône « Afficher/masquer la barre latérale » (`PanelLeft`), `Logo` 20 px + mot-symbole.
- Centre : **faux champ** (un `button` qui ressemble à un input, largeur max 460 px, centré). Il affiche une loupe,
  le placeholder « Rechercher ou se connecter… » et `ShortcutHint` `Ctrl ⇧ P`. Clic → ouvre la palette.
- Droite : bouton `default` « Nouvelle » avec l'icône `Plus`, puis bouton icône `Settings2` (ouvre l'onglet Paramètres).
- Toute la barre est non sélectionnable (`select-none`).

### Sidebar (fond `sidebar`, redimensionnable 220–400 px, défaut 272, repliable)
- Champ « Filtrer… » (h-8). Il filtre sur le nom, l'hôte, l'utilisateur et les étiquettes, sans accents ni casse.
  Pendant un filtre, les sections disparaissent au profit d'une liste plate de résultats.
- Sections : **Favoris**, **Récents** (5 dernières connexions, calculé à partir de `lastConnectedAt`), **Groupes**
  (repliables, pastille de couleur, compteur), **Sans groupe**. Une section vide est masquée, sauf Groupes
  (affiche « Créer un groupe »).
- Ligne de connexion (h-8, `rounded-md`, `px-2`) :
  `ProtocolIcon` · nom (tronqué) · [étiquette `Waypoints` si bastion] · `StatusDot` à droite.
  - Survol : `bg-sidebar-accent`. Le bouton `⋯` (menu) remplace la pastille.
  - Sélectionnée : `bg-sidebar-accent` + barre de 2 px `bg-primary` à gauche.
  - Double-clic ou `Entrée` : action par défaut (SSH → terminal, RDP → lancement).
  - Clic droit ou `⋯` : menu contextuel (§8).
- Pied : « N connexions », puis bouton icône Import (`FileInput`).

### TabBar (fond `sidebar`)
- Onglet : largeur 120–220 px, `StatusDot` + `ProtocolIcon` + titre (nom de la connexion, suffixé ` (2)` s'il est
  ouvert plusieurs fois) + `✕` (visible au survol et sur l'onglet actif).
- Onglet actif : fond `background` (il se « fond » dans le contenu) + indicateur `bg-brand-gradient` de 2 px en bas.
- Clic du milieu = fermer. Défilement horizontal avec fondu sur les bords quand ça déborde.
- Bouton `+` à la fin : palette en mode connexion rapide.

### StatusBar (fond `sidebar`, `text-xs text-muted-foreground`, `font-mono` pour la partie droite)
- Gauche : « N sessions actives » (ou rien si 0).
- Droite (selon l'onglet actif) : `ProtocolBadge` · `user@host:port` · « via bastion-01 » · taille `cols×rows` pour
  un terminal · latence si connue.

## 2. Accueil (aucun onglet actif)

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   Bonsoir 👋                         (salutation selon l'heure)│
│   14 connexions · 3 en ligne                                 │
│                                                              │
│   ┌──────────────────────────────────────────────────────┐   │
│   │ ⌕  user@hôte:port — connexion rapide            ⏎    │   │  grand champ (h-12)
│   └──────────────────────────────────────────────────────┘   │
│                                                              │
│   FAVORIS                                                    │
│   ╭──────────────╮ ╭──────────────╮ ╭──────────────╮         │  grille auto-fill minmax(240px,1fr)
│   │ SSH      ●   │ │ RDP      ○   │ │ SSH      ◌   │         │
│   │ web-01       │ │ ad-01        │ │ db-prod      │         │
│   │ deploy@10.0… │ │ CORP\admin@… │ │ root@db.int… │         │
│   │ ⤷ bastion-01 │ │              │ │ #prod #pg    │         │
│   ╰──────────────╯ ╰──────────────╯ ╰──────────────╯         │
│                                                              │
│   RÉCENTS                                                    │
│   ▣ db-prod        root@db.internal       il y a 5 min   ⏎   │  liste
│   ▭ ad-01          CORP\admin@10.0.0.5    hier           ⏎   │
│                                                              │
│   Ctrl⇧P palette · Ctrl⇧N nouvelle connexion · F1 raccourcis │
└──────────────────────────────────────────────────────────────┘
```

- **Carte de connexion** (`ConnectionCard`) : `rounded-xl border bg-card p-4`. Survol : animation §4.4 de
  `03-design.md`, et les boutons d'action apparaissent en bas (Se connecter · SFTP pour SSH · Réveiller si WoL · ⋯).
  Clic = se connecter.
- **Premier lancement** (0 connexion) : `EmptyState` centré. Titre « Bienvenue sur TunL », texte d'une ligne,
  trois actions : « Nouvelle connexion » (primaire), « Importer ~/.ssh/config », « Connexion rapide ».

## 3. Éditeur de connexion (feuille latérale droite, 520 px)

```
┌──────────────────────────────────────────────┐
│ Nouvelle connexion                        ✕  │
│ [  SSH  |  RDP  ]   (contrôle segmenté)      │
│ ─────────────────────────────────────────────│
│ Général   Authentification   Réseau   Avancé │  (Tabs)
│                                              │
│ Nom *            [web-01                 ]   │
│ Hôte *           [10.0.0.12        ] Port [22]│
│ Utilisateur      [deploy                 ]   │
│ Groupe           [Production          ▾]     │
│ Étiquettes       [prod ✕][web ✕][+      ]    │
│ Couleur          ● ● ● ● ● ● ● ● ● ●         │
│ Notes            [                       ]   │
│                                              │
│ ─────────────────────────────────────────────│
│                    [Annuler]  [Enregistrer]  │  pied collant
└──────────────────────────────────────────────┘
```

- **Général** : nom, hôte, port (prérempli à 22 ou 3389 selon le protocole ; si l'utilisateur ne l'a pas modifié,
  il change avec le protocole), utilisateur, groupe (liste + « Nouveau groupe… »), étiquettes (saisie + `Entrée`),
  couleur (10 pastilles), notes.
- **Authentification** :
  - SSH : méthode `Mot de passe` / `Clé privée` / `Agent SSH` (radio en cartes).
    - Mot de passe : champ masqué **facultatif**, écrit dans le trousseau à l'enregistrement (vide = demandé à la
      connexion ; la case « Mémoriser » vit dans le dialogue de connexion, T18). S'il existe déjà un secret :
      « Enregistré dans le trousseau ✓ » + boutons « Remplacer » / « Oublier » (appliqués à l'enregistrement). T12.
    - Clé : chemin + bouton « Parcourir… » (dialogue fichier, dossier `~/.ssh` par défaut), passphrase facultative,
      même logique.
  - RDP : domaine, mot de passe (même logique de trousseau).
- **Réseau** : bastion (liste des connexions SSH, sauf elle-même ; affiche la chaîne résultante
  « vous → bastion-01 → web-01 »), Wake-on-LAN (MAC, adresse de diffusion, port, « Réveiller avant de se connecter »,
  délai d'attente).
- **Avancé** :
  - SSH : keepalive (s), délai de connexion (s).
  - RDP : affichage (Ajuster / Plein écran / Taille fixe + largeur × hauteur), multi-écran, résolution dynamique,
    presse-papiers, audio (Local / Distant / Aucun), partager mon dossier personnel, politique de certificat
    (Demander / Faire confiance au premier), arguments supplémentaires (liste validée).
- Validation en direct (zod) avec message sous le champ. `Enregistrer` est désactivé tant que le formulaire est
  invalide. `Ctrl+S` enregistre, `Échap` ferme (confirmation si modifié).
- Titre : « Nouvelle connexion » ou « Modifier web-01 ». En mode modification, le pied gauche a « Supprimer »
  (destructive, avec `alert-dialog`).

## 4. Palette de commandes (`Ctrl+Shift+P`)

Fenêtre flottante centrée à 20 % du haut, 640 px, `glass rounded-xl shadow-elevated`.

```
┌────────────────────────────────────────────────────────┐
│ ⌕ web                                                  │
│────────────────────────────────────────────────────────│
│ CONNEXIONS                                             │
│ ▣ web-01            deploy@10.0.0.12        ⏎ ouvrir   │
│ ▣ web-02            deploy@10.0.0.13                   │
│ CONNEXION RAPIDE                                       │
│ ⚡ SSH vers web  (port 22)                              │
│ ACTIONS                                                │
│ + Nouvelle connexion                     Ctrl ⇧ N      │
│ ⇩ Importer ~/.ssh/config                               │
│ ◐ Basculer le thème                                    │
│ ⚙ Paramètres                             Ctrl ,        │
└────────────────────────────────────────────────────────┘
```

- Recherche floue de `cmdk` sur nom, hôte, utilisateur et étiquettes.
- Si la saisie ressemble à `[user@]host[:port]`, un élément « Connexion rapide » apparaît : SSH par défaut, RDP si le
  port vaut 3389 ou si la saisie commence par `rdp://`.
- Pour une connexion, `Entrée` = action par défaut, `Ctrl+Entrée` = SFTP (si SSH), `Alt+Entrée` = modifier.

## 5. Onglet terminal (SSH)

- Le terminal occupe tout, avec son propre fond (thème §9 de `03-design.md`).
- **Mini-barre flottante** en haut à droite, visible au survol de la zone haute ou quand la recherche est ouverte :
  Rechercher · Ouvrir en SFTP · Reconnecter · Menu `⋯` (copier `user@host`, taille de police, fermer).
- **Recherche** (`Ctrl+Shift+F`) : petit champ flottant avec suivant / précédent, casse, regex.
- **Overlay de connexion** (§4.2 de `03-design.md`) par-dessus le terminal tant que `status = connecting`.
- **Erreur** : carte centrée, icône `ShieldAlert` ou `Unplug`, titre, explication (§7), « Détails » repliable,
  boutons « Réessayer » et « Modifier la connexion ».
- **Fin de session** : bandeau en bas du terminal (le contenu reste lisible) : « Session terminée (code 0) » +
  « Reconnecter ».

## 6. Onglet SFTP

```
┌──────────────────────────────────────────────────────────────────────┐
│ [↑] [⟳]  / › var › www › html                 [+ Dossier] [⇧ Envoyer] [👁] │ barre d'outils
│──────────────────────────────────────────────────────────────────────│
│ Nom ▲                          Taille     Modifié           Droits    │
│ 📁 ..                                                                 │
│ 📁 assets                          —      12 sept. 14:02    drwxr-xr-x │
│ 📄 index.html                   4,2 Ko    hier 18:40        -rw-r--r-- │
│ …                                                                     │ tableau virtualisé
│──────────────────────────────────────────────────────────────────────│
│ ▾ Transferts (2)                                                      │ panneau repliable
│   ⇧ backup.tar.gz → /var/www   ███████░░░ 68 %  12,4 Mo/s  [✕]         │
│   ⇩ access.log → ~/Téléchargements  ✓ terminé            [📂]          │
└──────────────────────────────────────────────────────────────────────┘
```

- Fil d'Ariane cliquable. Clic sur le chemin → édition du chemin en texte (`Entrée` pour aller).
- Tri par colonne. Dossiers toujours en premier. Fichiers cachés masqués par défaut (bouton œil).
- Double-clic sur un dossier : entrer. Sur un fichier : télécharger vers le dossier Téléchargements (réglable).
- **Glisser-déposer** de fichiers depuis le bureau → overlay « Déposer pour envoyer vers /var/www/html » → envoi.
- Menu contextuel : Télécharger…, Renommer (édition en ligne), Supprimer (confirmation, récursif pour un dossier),
  Copier le chemin, Droits… (dialogue chmod avec cases rwx + octal).
- Sélection multiple (`Ctrl`, `Maj`) pour télécharger ou supprimer.

## 7. Onglet RDP

L'affichage RDP se fait dans la fenêtre FreeRDP. L'onglet montre une **carte de session** :

```
            ╭─────────────────────────────────────────╮
            │        ▭  (grande icône, halo dégradé)    │
            │        ad-01                              │
            │        CORP\admin@10.0.0.5:3389          │
            │        ● Session ouverte · 12 min         │
            │        ⤷ via bastion-01 (127.0.0.1:40123) │
            │                                          │
            │   [Déconnecter]   [Relancer]              │
            │   ▸ Journal FreeRDP (filtré)              │
            ╰─────────────────────────────────────────╯
```

- États : Lancement (overlay « tunnel »), Ouverte, Terminée (code de sortie traduit en phrase quand on le connaît :
  identifiants refusés, certificat refusé, hôte injoignable…), Client introuvable (`EmptyState` avec les commandes
  d'installation par distribution).

## 8. Menus contextuels (connexion)

Se connecter · Ouvrir en SFTP (SSH) · Réveiller (si WoL) · — · Modifier · Dupliquer · Ajouter/Retirer des favoris ·
Déplacer vers le groupe ▸ · Copier `user@host` · — · Supprimer (destructive).

## 9. Dialogues de prompts (`features/prompts`)

- **Clé d'hôte inconnue** : icône `ShieldQuestion`, « Première connexion à db.internal:22 », type de clé,
  empreinte `SHA256:…` en `font-mono` sélectionnable, texte « Vérifiez cette empreinte auprès de l'administrateur. »,
  boutons « Annuler » / « Faire confiance et continuer » (primaire).
- **Clé d'hôte changée** (erreur, pas un prompt) : `ShieldAlert` rouge, ancienne et nouvelle empreintes, explication
  (§7 de `03-design.md`), boutons « Fermer » et « Supprimer l'ancienne clé… ». Ce dernier ouvre une seconde confirmation
  où il faut taper le nom d'hôte.
- **Mot de passe / passphrase** : champ masqué avec œil, « Mémoriser dans le trousseau », « Annuler » / « Se connecter ».
- **Keyboard-interactive (2FA)** : une question par champ, avec l'écho selon le serveur (`echo=false` → masqué).

## 10. Onglet Paramètres

Un onglet comme les autres, après les sessions (T31). Navigation verticale à gauche (200 px) et contenu à droite
(max 720 px) :
- **Apparence** : thème, langue, réduire les animations, confirmer la fermeture d'un onglet connecté.
- **Terminal** : thème, police, taille, interligne, curseur, défilement arrière, copier à la sélection. (La cloche
  attendra qu'un code l'écoute.)
- **SSH** : délai de connexion et keepalive par défaut, serveurs connus (ceux du `known_hosts` de TunL, avec
  « Oublier »).
- **SFTP** : dossier de téléchargement.
- **RDP** : client détecté (chemin, version) ou « introuvable », programme choisi à la main.
- **Disponibilité** : activer les sondes, intervalle.
- **À propos** : version, licence, code source, dossiers de configuration et des journaux (afficher).

Chaque réglage s'applique **immédiatement**, sans bouton Enregistrer, avec un toast discret en cas d'erreur.

## 11. Import `~/.ssh/config` (dialogue large)

Tableau avec cases à cocher :
`Host` · `HostName` · `User` · `Port` · clé · bastion (`ProxyJump` résolu) · avertissements (options ignorées, par
exemple `ProxyCommand`).
Les hôtes génériques (`*`) sont exclus d'office. Les doublons (même hôte + port + utilisateur qu'une connexion
existante) sont décochés et marqués « Déjà présent ».
En bas : « Importer dans le groupe [▾] » puis « Importer N connexions ».
