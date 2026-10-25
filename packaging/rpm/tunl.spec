# TunL — RPM spec for COPR (T41).
# Built from the code (Source0) and the vendored dependencies (Source1), fully offline.
# The release binary is stripped (src-tauri/Cargo.toml), so skip the empty debuginfo package.
%global debug_package %{nil}

Name:           tunl
Version:        0.1.0
Release:        1%{?dist}
Summary:        Connect to your servers over SSH, SFTP and RDP
License:        GPL-3.0-or-later
URL:            https://github.com/Fleorens/TunL
Source0:        tunl-%{version}.tar.gz
Source1:        tunl-%{version}-vendor.tar.xz

# Rust and Cargo (>= 1.90), Node 22 and npm (the Flatpak uses node22), the Tauri
# system libraries, and the validators of %check. freerdp is optional: without it
# only RDP is missing, so it is recommended, never required.
BuildRequires:  rust cargo
BuildRequires:  nodejs22 nodejs22-npm
BuildRequires:  webkit2gtk4.1-devel gtk3-devel libsoup3-devel librsvg2-devel openssl-devel
BuildRequires:  desktop-file-utils libappstream-glib
Recommends:     freerdp

%description
TunL is a modern, keyboard-first SSH, SFTP and RDP connection manager for Linux,
with jump hosts and Wake-on-LAN.

%prep
%autosetup -n tunl-%{version} -a 1

%build
# Install the npm dependencies from the vendored cache, then build the binary
# with the interface embedded (no bundle: COPR supplies the %install files).
npm ci --offline --ignore-scripts --cache npm-cache
npx tauri build --no-bundle -- --offline

%check
# Render the desktop entry from the template, then validate the entry and the
# AppStream metadata (same sources as the Flatpak, under the tunl.desktop id).
sed -e 's/{{exec}}/tunl/' -e 's/{{icon}}/tunl/' \
    -e 's/{{comment}}/SSH, SFTP and RDP connections, with jump hosts and Wake-on-LAN/' \
    packaging/linux/tunl.desktop.hbs > tunl.desktop
desktop-file-validate tunl.desktop
appstream-util validate-relax --nonet packaging/linux/io.github.fleorens.TunL.metainfo.xml

%install
install -Dm755 src-tauri/target/release/tunl %{_bindir}/tunl
install -Dm644 tunl.desktop %{_datadir}/applications/tunl.desktop
install -Dm644 packaging/linux/io.github.fleorens.TunL.metainfo.xml \
    %{_datadir}/metainfo/io.github.fleorens.TunL.metainfo.xml
install -Dm644 src-tauri/icons/32x32.png %{_datadir}/icons/hicolor/32x32/apps/tunl.png
install -Dm644 src-tauri/icons/64x64.png %{_datadir}/icons/hicolor/64x64/apps/tunl.png
install -Dm644 src-tauri/icons/128x128.png %{_datadir}/icons/hicolor/128x128/apps/tunl.png
install -Dm644 src-tauri/icons/128x128@2x.png %{_datadir}/icons/hicolor/256x256@2/apps/tunl.png
install -Dm644 src-tauri/icons/icon.png %{_datadir}/icons/hicolor/512x512/apps/tunl.png

%files
%license LICENSE
%doc README.md CHANGELOG.md
%{_bindir}/tunl
%{_datadir}/applications/tunl.desktop
%{_datadir}/metainfo/io.github.fleorens.TunL.metainfo.xml
%{_datadir}/icons/hicolor/32x32/apps/tunl.png
%{_datadir}/icons/hicolor/64x64/apps/tunl.png
%{_datadir}/icons/hicolor/128x128/apps/tunl.png
%{_datadir}/icons/hicolor/256x256@2/apps/tunl.png
%{_datadir}/icons/hicolor/512x512/apps/tunl.png

%changelog
* Sun Oct 25 2026 Florian <florian@leorens.com> - 0.1.0-1.fc44
- Initial package built for COPR.
