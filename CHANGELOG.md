# Changelog

Every notable change of TunL, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-10-23 — first preview

### Added

- Connections: create, edit, duplicate, delete; groups, tags, favorites, recents, instant filter.
- SSH sessions in tabs: password, private key and passphrase, SSH agent, keyboard-interactive (two-factor).
- Host keys checked against TunL's own `known_hosts` and `~/.ssh/known_hosts` (read only); a changed key is refused.
- Jump hosts: a chain of up to four saved SSH connections, for SSH, SFTP and RDP.
- SFTP explorer: browse, new folder, rename, delete, permissions, downloads and uploads, drag and drop.
- RDP through FreeRDP 3, credentials on its standard input; through a jump host with a stable tunnel port, so that
  FreeRDP checks the server's certificate.
- Wake-on-LAN, and reachability dots (one TCP connection per address, nothing sent).
- Passwords and passphrases in the system keyring.
- Command palette, quick connect, keyboard shortcuts (F1), arrow keys in lists.
- Import of `~/.ssh/config`; export and import of the connections as a JSON file (without secrets).
- Settings: appearance, terminal, SSH defaults and known hosts, SFTP download folder, RDP client, reachability.
- English and French; light, dark and system themes; reduced motion.
- Packages: `.deb`, `.rpm`, AppImage, with a desktop entry and AppStream metadata.

[Unreleased]: https://github.com/Fleorens/TunL/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Fleorens/TunL/releases/tag/v0.1.0
