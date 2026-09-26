# 06 — Sécurité

TunL manipule des mots de passe, des clés privées et des accès à des serveurs. Une faille ici coûte cher à ses
utilisateurs. Ces règles sont **bloquantes** : une fiche qui en viole une n'est pas livrée.

## 1. Ce qu'on protège, contre qui

| Actif | Menace |
|---|---|
| Mots de passe, passphrases, réponses 2FA | fuite sur disque, dans les logs, dans `ps` / `/proc/<pid>/cmdline`, vers le frontend, dans un message d'erreur |
| Confiance dans un serveur (clé d'hôte) | homme du milieu sur le réseau |
| Poste de l'utilisateur | serveur malveillant : séquences d'échappement dans le terminal, noms de fichiers piégés en SFTP, sortie énorme |
| Config importée | `~/.ssh/config` contenant `ProxyCommand` / `LocalCommand` (exécution de commandes) |
| Fichiers de TunL | lecture par un autre utilisateur local |
| Chaîne d'approvisionnement | dépendance compromise |

## 2. Règles

**S1 — Secrets uniquement dans le trousseau.** Jamais dans `connections.json`, `settings.json`, `localStorage`,
les logs, ni un fichier temporaire.

**S2 — Le frontend ne lit jamais un secret enregistré.** Pas de commande `secret_get`. Le Rust lit le trousseau
lui-même au moment de se connecter. Le seul trajet d'un secret : saisie dans l'UI → Rust → trousseau ou serveur.

**S3 — Secrets en mémoire :** type `zeroize::Zeroizing<String>`, durée de vie la plus courte possible.
Pas de `Debug` ou `Display` qui les affiche : utiliser un type enveloppe dont le `Debug` imprime `***`.

**S4 — Aucun secret dans un argument de processus.** FreeRDP reçoit tout par `/args-from:stdin`. C'est vérifiable :
pendant une session RDP, `cat /proc/<pid>/cmdline` ne doit montrer que `/args-from:stdin`.

**S5 — Rien d'injectable dans les arguments FreeRDP.** Tout champ qui finit dans une ligne d'argument (hôte,
utilisateur, domaine, mot de passe, arguments supplémentaires) est refusé s'il contient `\n`, `\r` ou un autre
caractère de contrôle. Les arguments réservés (`/p:`, `/v:`…) sont interdits dans les arguments supplémentaires.
Voir `05-modele-donnees.md` §6.

**S6 — Clés d'hôte.**
- Clé inconnue → prompt avec l'empreinte SHA256, **refus par défaut** (Annuler, délai dépassé, onglet fermé).
- Clé différente de celle connue → **refus**, sans option « continuer quand même ».
- La suppression d'une ancienne clé exige une confirmation où l'on tape le nom d'hôte.
- La politique de certificat RDP n'offre jamais `ignore`.

**S7 — Erreurs sans fuite.** `AppError.message` est un texte technique en anglais : jamais de secret, jamais le contenu
d'un fichier de clé. Les erreurs russh sont reformulées, sans recopier les données reçues.

**S8 — Logs.** Autorisés : noms d'hôte, ports, noms d'utilisateur, étapes, codes d'erreur. Interdits : secrets,
octets du terminal, contenu du presse-papiers, arguments FreeRDP, contenus de fichiers.

**S9 — Permissions des fichiers.** Dossiers de TunL en `0700`, fichiers (`connections.json`, `settings.json`,
`known_hosts`, `.bak`, `.tmp`) en `0600`, fixés à la création.

**S10 — Terminal.**
- Pas d'addon `clipboard` d'xterm (OSC 52) : un serveur ne peut pas écrire dans le presse-papiers.
- Les liens ne s'ouvrent qu'avec `Ctrl+clic`, uniquement en `http` et `https`, via le plugin `opener`.
- Taille des lots d'écriture bornée, pour qu'une sortie énorme ne gèle pas l'UI.

**S11 — SFTP.**
- Un nom distant contenant `/`, `\0`, ou égal à `.` ou `..`, est ignoré avec un avertissement. On ne le suit jamais.
- Pour enregistrer en local, on ne garde que le nom de base. On n'écrase jamais un fichier existant :
  suffixe ` (1)`, ` (2)`…
- Suppression récursive : confirmation qui affiche le nombre d'éléments.

**S12 — Import `~/.ssh/config`.** On **n'exécute rien**. `ProxyCommand`, `LocalCommand`, `Match exec`,
`KnownHostsCommand` sont ignorés et signalés dans l'aperçu.

**S13 — WebView.**
- CSP stricte en production (voir §3). Aucun contenu distant chargé.
- Pas de `dangerouslySetInnerHTML`, pas d'`eval`, pas de `new Function`.
- Menu contextuel natif de WebKit désactivé, sauf dans les champs de saisie.

**S14 — Capacités Tauri minimales.** On n'ajoute une permission de plugin à `capabilities/default.json` que si une
fiche le demande, avec la portée la plus étroite possible.

**S15 — Réseau à l'initiative de l'utilisateur.** Pas de télémétrie, pas de vérification de mise à jour, aucun appel
réseau en dehors :
- des connexions demandées ;
- du Wake-on-LAN ;
- des sondes de disponibilité, désactivables : TCP connect seul, sans données, timeout 2 s, 16 en parallèle au plus,
  jamais vers un hôte derrière un bastion.

**S16 — Dépendances.** Lockfiles (`package-lock.json`, `Cargo.lock`) commités. `npm audit` et `cargo audit` en CI (T37).
Aucune dépendance ajoutée hors fiche.

## 3. CSP (dans `src-tauri/tauri.conf.json` → `app.security.csp`)

```json
{
  "default-src": "'self'",
  "script-src": "'self'",
  "style-src": "'self' 'unsafe-inline'",
  "img-src": "'self' data: blob:",
  "font-src": "'self' data:",
  "connect-src": "ipc: http://ipc.localhost",
  "object-src": "'none'",
  "base-uri": "'none'",
  "form-action": "'none'",
  "frame-ancestors": "'none'"
}
```

`'unsafe-inline'` n'est autorisé **que** pour les styles : xterm.js, Radix et motion posent des styles en ligne.
En développement (`devCsp`), pas de CSP, car le serveur Vite injecte des scripts en ligne. La CSP stricte est donc
**vérifiée sur le binaire de release** (T05, puis T40).

## 4. Non applicable à TunL (et pourquoi)

La checklist générique de Florian mentionne des points qui ne concernent pas une app de bureau sans serveur :

- **Injection SQL** : pas de base SQL (D06).
- **CSRF** : pas de serveur HTTP ni de cookies. L'IPC Tauri n'est joignable que depuis la WebView de l'app, qui ne
  charge aucun contenu distant.
- **Limitation de débit des endpoints** : pas d'endpoint réseau exposé. L'équivalent, c'est borner le travail qu'on
  s'impose : concurrence des sondes (S15), taille des lots du terminal (S10), un seul prompt à la fois par session.

## 5. Checklist de fin de fiche (l'agent la déroule)

- [ ] `grep -rniE "password|passphrase|secret" src-tauri/src` : chaque occurrence qui touche aux logs, à `format!`
      ou à `Debug` est justifiée.
- [ ] Aucun `println!` / `dbg!` / `console.log` ajouté.
- [ ] Toute nouvelle commande Rust valide ses entrées avant d'agir.
- [ ] Aucune nouvelle permission Tauri non demandée par la fiche.
- [ ] Aucune nouvelle dépendance non demandée par la fiche.
