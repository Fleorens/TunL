# 00 — Vision et périmètre

## En une phrase

**TunL** est un gestionnaire de connexions SSH, SFTP et RDP pour Linux, beau, rapide et moderne.
C'est l'outil qu'on ouvre le matin et qu'on garde ouvert toute la journée.

## Pour qui

L'app est publique. Elle s'adresse à toute personne qui se connecte régulièrement à des machines distantes :

- **Admin sys / homelab** : 10 à 200 machines, des bastions, des machines qu'on réveille par le réseau.
- **Dev** : quelques serveurs, des fichiers à pousser en SFTP, des configs `~/.ssh/config` existantes.
- **Support / MSP** : des postes Windows en RDP, souvent derrière un bastion SSH.

Elle doit plaire à un utilisateur de Termius ou de Tabby. Elle doit aussi rassurer un utilisateur de Remmina :
on voit clairement ce qui se passe, et les secrets ne traînent nulle part.

## Principes produit (ils tranchent les arbitrages)

1. **Clavier d'abord.** Tout se fait sans souris : palette `Ctrl+Shift+P`, connexion rapide, onglets.
2. **Zéro surprise sur la sécurité.** Aucun mot de passe en clair sur disque ni dans la liste des processus.
   Les clés d'hôte sont vérifiées, et en cas de changement on bloque et on explique.
3. **Beau par défaut.** Thème sombre soigné, animations sobres, états vides et erreurs aussi travaillés que le reste.
4. **Honnête.** Chaque étape de connexion est visible (réveil → bastion → hôte → authentification → shell).
   Chaque erreur dit quoi faire.
5. **Local et privé.** Pas de compte, pas de télémétrie, pas de cloud. Les données restent dans des fichiers lisibles.

## Périmètre v1 (ce qui DOIT être livré)

| Domaine | Fonction |
|---|---|
| Connexions | Créer / modifier / dupliquer / supprimer des connexions SSH et RDP |
| Organisation | Groupes (un niveau, couleur), étiquettes, favoris, récents, recherche instantanée |
| SSH | Terminal intégré en onglets (xterm.js), auth mot de passe / clé / agent / keyboard-interactive |
| Sécurité SSH | Vérification des clés d'hôte (TOFU avec confirmation, blocage si la clé change) |
| Bastion | Rebond via une autre connexion SSH enregistrée, chaînable (4 sauts max) |
| SFTP | Explorateur de fichiers distant : navigation, créer / renommer / supprimer, transferts avec progression, glisser-déposer |
| RDP | Lancement de FreeRDP 3 dans sa propre fenêtre, piloté par l'app (identifiants injectés sans fuite, résolution, presse-papiers, audio, partage de dossier), y compris via un bastion SSH |
| Wake-on-LAN | Bouton « Réveiller », réveil automatique avant connexion puis attente que la machine réponde |
| Secrets | Mots de passe et passphrases dans le trousseau système (Secret Service : KWallet, GNOME Keyring…) |
| Import | Import de `~/.ssh/config` avec aperçu et sélection |
| Confort | Palette de commandes, connexion rapide `user@host:port`, pastilles de disponibilité, thèmes clair / sombre / système |
| Langues | Anglais (par défaut) et français |
| Distribution | `.deb`, `.rpm`, AppImage, Flatpak (cible Flathub) |

## Hors périmètre v1 (volontairement)

- **RDP affiché dans l'app.** Il faudrait intégrer FreeRDP en C ou IronRDP : c'est la partie la plus risquée.
  → v2, voir `02-decisions.md` (D04).
- VNC, Telnet, Mosh, port série.
- Synchronisation cloud, comptes, partage d'équipe.
- Terminal local (shell de la machine), écran partagé (split panes).
- Tunnels / redirections de ports **gérés par l'utilisateur** (le moteur existe pour le RDP via bastion ;
  l'interface dédiée viendra en v2).
- Windows et macOS. Tauri le permettrait plus tard, mais on ne s'en soucie pas en v1.

## Critères de réussite de la v1

- Une personne qui a un `~/.ssh/config` est connectée à sa première machine en moins de 60 secondes après l'installation.
- Ouvrir un onglet SSH vers une machine du LAN prend moins d'une seconde, hors authentification.
- Le terminal est aussi fluide que Konsole ou GNOME Terminal sur `cat` d'un gros fichier ou `htop`.
- `npm run verify` passe, et la revue sécurité finale (T40) ne remonte aucun point bloquant.
