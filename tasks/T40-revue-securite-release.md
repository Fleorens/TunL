# T40 — Revue de sécurité finale et liste de publication (faite par Claude)

| | |
|---|---|
| **Jalon** | M8 — Distribution |
| **Dépend de** | T38, T39 |
| **Lire avant** | `docs/06-securite.md` en entier, `docs/02-decisions.md`, `src-tauri/.cargo/audit.toml` |
| **Livrable** | un compte rendu de revue (`docs/08-revue-securite.md`), les défauts corrigés et figés en tests, la publication `v0.1.0` en brouillon prête à publier |

## Pourquoi

`docs/00-vision.md` fait de cette revue un critère de réussite de la v1 : « la revue sécurité finale (T40) ne remonte
aucun point bloquant ». Elle n'est **pas** confiée au modèle local : l'orchestrateur la mène, sur le code livré et
sur les paquets construits, pas sur les fiches. Chaque défaut trouvé devient un test ou une règle (`npm run rules`),
comme aux revues de lot.

Pas de prototype : cette fiche est une liste de contrôle. Chaque point dit **comment** le vérifier ; « vu » ne suffit
pas, le compte rendu donne la commande et ce qu'elle a montré.

## 1. Les règles S1 à S16, une par une

| Règle | Vérification |
|---|---|
| S1 secrets dans le trousseau seulement | après une session avec mot de passe mémorisé : `grep -rIl "<le mot de passe>" ~/.config/io.github.fleorens.TunL ~/.local/share/io.github.fleorens.TunL` ne trouve rien ; même chose dans un export JSON (T32) |
| S2 aucune lecture de secret par le frontend | `npm run rules` (`no-secret-read-command`) ; relire `commands/secrets.rs` : trois commandes, aucune ne rend une valeur |
| S3 secrets en mémoire | `grep -rn "SecretValue\|Zeroizing" src-tauri/src` : chaque secret transite dans un de ces types ; `Debug` imprime `***` (test de `secrets_tests.rs`) |
| S4 aucun secret en argument | session RDP réelle (`npm run test-env:rdp`, FreeRDP 3 installé) : `cat /proc/$(pgrep -f freerdp)/cmdline \| tr '\0' ' '` ne montre que `/args-from:stdin` |
| S5 rien d'injectable | `args_tests.rs`, `tunnel_cert_tests.rs` (T28c : `/server-name`) ; essayer un hôte, un utilisateur, un domaine avec `\n` dans l'éditeur : refusé |
| S6 clés d'hôte | les tests `ssh_hostkey*.rs` ; à la main : clé changée sur le conteneur (`scripts/test-env/rotate-host-key.sh`) → refus, suppression seulement en tapant le nom d'hôte ; RDP via bastion : la 2ᵉ session retrouve son certificat (T28c) |
| S7 erreurs sans fuite | `grep -rn "format!(" src-tauri/src \| grep -i "secret\|password\|passphrase"` : aucun cas qui recopie une valeur |
| S8 logs | après une journée d'usage : `grep -riE "password|passphrase|BEGIN .*PRIVATE" ~/.local/share/io.github.fleorens.TunL/logs` ne trouve rien |
| S9 permissions | `stat -c '%a %n' ~/.config/io.github.fleorens.TunL ~/.config/io.github.fleorens.TunL/*` : `700` pour le dossier, `600` pour chaque fichier ; un export (T32) en `600` |
| S10 terminal | pas d'addon `clipboard` (`grep -rn "addon-clipboard\|ClipboardAddon" src`) ; un lien ne s'ouvre qu'avec `Ctrl+clic` et en `http(s)` ; `cat` d'un fichier de 200 Mo ne gèle pas l'interface |
| S11 SFTP | les tests de `sftp/ops_tests.rs` et `transfer_*` ; à la main, un serveur avec un nom de fichier `../x` : ignoré |
| S12 import ssh_config | un `~/.ssh/config` avec `ProxyCommand`, `LocalCommand`, `Match exec`, `KnownHostsCommand` : rien n'est exécuté (`strace -f -e execve` sur l'app pendant l'aperçu), tout est signalé |
| S13 WebView, CSP | voir §2 |
| S14 capacités | `src-tauri/capabilities/default.json` : chaque permission a sa fiche (opener : URL `http(s)` et `reveal-item-in-dir` ; presse-papiers lecture et écriture de texte ; dialog `open` et `save`) ; rien d'autre |
| S15 réseau | `ss -tnp` et `tcpdump -i any not port 22` pendant 10 minutes app ouverte, sondes coupées : aucune connexion ; sondes actives : une connexion TCP par adresse (T30b), jamais vers un hôte derrière un bastion, rien d'envoyé |
| S16 dépendances | CI verte (`npm audit --omit=dev`, `cargo audit`) ; **relire chaque exception** de `src-tauri/.cargo/audit.toml` (aujourd'hui RUSTSEC-2023-0071, `rsa` : vérifier si russh dépend enfin d'une version corrigée) ; `npm audit` complet : les avis restants ne touchent que les outils de build |

## 2. La CSP sur le binaire de release (S13)

`devCsp` est désactivée en développement : la CSP n'existe que dans les builds de production.
1. `npx tauri build --debug --no-bundle` : la configuration de production (avec la CSP), et l'inspecteur WebKit.
2. Lancer le binaire sous Xvfb avec `WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9333` (recette de la mémoire « Vraie app
   sous Xvfb »).
3. Dans la console de l'inspecteur : la balise `meta[http-equiv="Content-Security-Policy"]` (ou l'en-tête de la
   réponse) porte la politique de `docs/06-securite.md` §3 ; `eval("1")` et l'injection d'un `<script>` en ligne
   sont **refusés** (erreur CSP dans la console) ; `fetch("https://example.com")` est refusé (`connect-src`).
4. Le menu contextuel natif de WebKit n'apparaît pas hors des champs de saisie (S13).

## 3. Le Flatpak (T38)

- `finish-args` : chaque permission justifiée dans le manifeste ; pas de `--filesystem=home`, pas de
  `--talk-name=org.freedesktop.Flatpak` (TunL ne lance rien sur l'hôte : FreeRDP est dans le bac à sable).
- Le trousseau passe par le portail Secret (D05) : vérifier qu'un mot de passe mémorisé dans le Flatpak ne se lit pas
  hors du bac à sable (`secret-tool search application io.github.fleorens.TunL` ne le montre pas en clair).
- `flatpak run --command=sh io.github.fleorens.TunL -c 'ls ~'` : seul ce que les permissions ouvrent est visible.

## 4. Les menaces de `docs/06-securite.md` §1, relues

Pour chaque ligne du tableau (actif, menace), écrire dans le compte rendu la ou les protections en place et le test
qui les garde. Une menace sans test est un point **à traiter** (test à écrire, ou risque accepté par Florian, écrit
noir sur blanc).

## 5. Liste de publication de `v0.1.0`

1. Version : `node scripts/check-version.mjs v0.1.0` réussit (package.json, tauri.conf.json, Cargo.toml, metainfo).
2. `CHANGELOG.md` : la section `[0.1.0]` reçoit sa date ; `## [Unreleased]` reste en tête, vide.
3. Metainfo : la `<release>` passe de `type="development"` à `type="stable"`, avec la même date ;
   `npm run check:packaging` reste vert.
4. `npm run review` vert sur `main` ; CI verte sur le commit à publier.
5. `npm run screenshots` si l'interface a changé depuis T36, puis commit des captures.
6. `git tag -s v0.1.0` (signé), `git push origin v0.1.0` : la CI de publication produit le **brouillon**.
7. Télécharger les trois paquets du brouillon, vérifier `sha256sum -c SHA256SUMS`, installer le `.deb` sur une
   Debian 13 propre (podman) et le `.rpm` sur une Fedora propre : TunL démarre, se connecte au conteneur SSH de test.
8. Florian publie le brouillon. Puis la soumission Flathub (T38, « À regarder »).

## Critères d'acceptation

- [x] `docs/08-revue-securite.md` : une section par règle (S1–S16), CSP, Flatpak, menaces, avec les commandes et
      leurs résultats.
- [x] Aucun point bloquant ouvert ; chaque risque accepté l'est par écrit, par Florian.
- [x] Chaque défaut trouvé est corrigé et gardé par un test ou une règle.
- [x] La publication `v0.1.0` existe en brouillon, ses paquets vérifiés.
