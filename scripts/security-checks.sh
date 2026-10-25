#!/usr/bin/env bash
# T40: the security checks that need the real app on Florian's desktop (docs/08-revue-securite.md §6).
# Interactive: it says what to do in TunL, waits, checks, and writes every result to ~/tunl-t40-checks.txt.
# No password is ever written: it is read silently, used by grep, then forgotten.
set -u
cd "$(dirname "$0")/.." || exit 1

REPORT="$HOME/tunl-t40-checks.txt"
CONFIG="$HOME/.config/io.github.fleorens.TunL"
DATA="$HOME/.local/share/io.github.fleorens.TunL"
EXPORT="$HOME/tunl-export.json"

: > "$REPORT"
log() { echo "$*" | tee -a "$REPORT"; }
step() { echo; log "=== $* ==="; }
wait_user() { read -rp "→ $* (Entrée quand c'est fait) " _; }
ask_yes() { local a; read -rp "→ $* [o/N] " a; [[ "$a" =~ ^[oOyY] ]]; }

# grep for the password typed at the prompt in the given paths; logs only the verdict and the file names.
grep_secret() {
  local pw found
  read -rsp "→ Tape le mot de passe mémorisé (invisible) : " pw; echo
  found=$(grep -rIlF -- "$pw" "$@" 2>/dev/null)
  unset pw
  if [[ -z "$found" ]]; then log "OK : le mot de passe n'apparaît dans aucun fichier"; else log "ÉCHEC, trouvé dans :"; log "$found"; fi
}

log "TunL — vérifications T40 — $(date -Iseconds) — $(uname -sr)"

step "S15a — aucun trafic sans action (sondes coupées)"
wait_user "Lance TunL (npm run tauri dev), sans ouvrir de session, et désactive les sondes dans Paramètres › Disponibilité"
log "Observation de 5 minutes (ss toutes les 2 s)…"
seen=""
for _ in $(seq 150); do
  line=$(ss -tunp 2>/dev/null | grep -i tunl)
  [[ -n "$line" ]] && seen+="$line"$'\n'
  sleep 2
done
if [[ -z "$seen" ]]; then log "OK : aucune connexion de TunL"; else log "À REGARDER, connexions vues :"; log "$seen"; fi

step "S15b — une sonde par adresse (sondes actives)"
if ask_yes "Vérifier sur un de tes serveurs SSH (journal de sshd, sudo sur le serveur) ?"; then
  read -rp "→ Serveur (comme pour ssh, ex. user@nas) : " server
  wait_user "Réactive les sondes et mets l'intervalle à 15 s"
  log "Journal de sshd sur $server pendant 70 s…"
  timeout 70 ssh -t "$server" "sudo journalctl -u sshd -u ssh -f -n 0" 2>&1 | tee -a "$REPORT"
  log "(attendu : environ une connexion toutes les 15 s, rien vers un hôte derrière un bastion)"
  wait_user "Remets l'intervalle à 5 minutes"
fi

step "S1 — le mot de passe n'est écrit nulle part"
wait_user "Dans TunL : connecte-toi par mot de passe en le mémorisant, puis Paramètres › Sauvegarde › Exporter vers $EXPORT, puis ferme TunL"
grep_secret "$CONFIG" "$DATA" "$EXPORT"

step "S8 — rien de sensible dans les logs"
hits=$(grep -riE "passphrase|BEGIN .*PRIVATE|/p:" "$DATA/logs" 2>/dev/null)
if [[ -z "$hits" ]]; then log "OK : aucune ligne suspecte"; else log "À REGARDER :"; log "$hits"; fi

step "S9 — permissions (attendu : 700 pour le dossier, 600 pour les fichiers)"
stat -c '%a %n' "$CONFIG" "$CONFIG"/* "$EXPORT" 2>&1 | tee -a "$REPORT"

step "Flatpak (T40 §3) — 20 à 40 minutes au premier build"
if ask_yes "Construire et vérifier le Flatpak maintenant ?"; then
  flatpak install -y flathub org.gnome.Platform//51 org.gnome.Sdk//51 org.freedesktop.Sdk.Extension.rust-stable//26.08 \
    org.freedesktop.Sdk.Extension.node22//26.08 2>&1 | tail -3 | tee -a "$REPORT"
  flatpak-builder --user --install --force-clean build packaging/flatpak/io.github.fleorens.TunL.yml 2>&1 \
    | tail -5 | tee -a "$REPORT"
  log "Build terminé (code ${PIPESTATUS[0]})"
  wait_user "Lance-le (flatpak run io.github.fleorens.TunL) : icône dans le menu, une session SSH avec l'agent, une session RDP, un mot de passe mémorisé, puis ferme-le"
  grep_secret "$HOME/.var/app/io.github.fleorens.TunL"
  log "Ce que le bac à sable voit du home (attendu : .ssh, .var, le dossier de téléchargements) :"
  flatpak run --command=sh io.github.fleorens.TunL -c 'ls -A ~' 2>&1 | tee -a "$REPORT"
  read -rp "→ Icône, session SSH, session RDP : tout a marché ? (note libre) " note
  log "Essais à la main : $note"
fi

echo
log "Fini. Envoie le contenu de $REPORT à Claude."
