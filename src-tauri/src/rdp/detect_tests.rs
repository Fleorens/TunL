use std::ffi::OsString;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::detect::{RdpFlavor, candidates, detect, flavor_of, parse_version};
use crate::error::ErrorKind;

const QUICK: Duration = Duration::from_secs(5);

/// A fake client in `dir` that prints `output` for `--version`.
fn fake(dir: &Path, name: &str, output: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, format!("#!/bin/sh\necho '{output}'\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn v3(dir: &Path, name: &str) -> PathBuf {
    fake(dir, name, "This is FreeRDP version 3.10.3 (3.10.3)")
}

fn path_of(dirs: &[&Path]) -> OsString {
    std::env::join_paths(dirs).unwrap()
}

#[test]
fn versions_are_read_from_the_usual_banner_and_only_3_x_is_kept() {
    assert_eq!(
        parse_version("This is FreeRDP version 3.10.3 (3.10.3)").as_deref(),
        Some("3.10.3")
    );
    assert_eq!(
        parse_version("[12:00] warn\nThis is FreeRDP version 3.5.1 (git abc)\n").as_deref(),
        Some("3.5.1")
    );
    assert_eq!(
        parse_version("This is FreeRDP version 2.11.7 (2.11.7)"),
        None
    );
    assert_eq!(parse_version("This is FreeRDP version 30.1.0"), None);
    assert_eq!(parse_version("This is FreeRDP version 3"), None);
    assert_eq!(parse_version("rdesktop 1.9"), None);
    assert_eq!(parse_version(""), None);
}

#[test]
fn the_flavor_comes_from_the_file_name() {
    assert_eq!(
        flavor_of(Path::new("/usr/bin/sdl-freerdp3")),
        Some(RdpFlavor::Sdl)
    );
    assert_eq!(
        flavor_of(Path::new("/usr/bin/sdl-freerdp")),
        Some(RdpFlavor::Sdl)
    );
    assert_eq!(
        flavor_of(Path::new("/usr/bin/xfreerdp3")),
        Some(RdpFlavor::X11)
    );
    assert_eq!(
        flavor_of(Path::new("/usr/bin/wlfreerdp")),
        Some(RdpFlavor::Wayland)
    );
    assert_eq!(flavor_of(Path::new("/opt/rdp/my-wrapper")), None);
}

#[test]
fn candidates_follow_the_name_order_then_the_path_order() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let x_in_a = v3(a.path(), "xfreerdp3");
    let sdl_in_b = v3(b.path(), "sdl-freerdp");
    let sdl3_in_b = v3(b.path(), "sdl-freerdp3");
    let sdl3_in_a = v3(a.path(), "sdl-freerdp3");
    // Not executable: skipped.
    let wl = a.path().join("wlfreerdp3");
    std::fs::write(&wl, "#!/bin/sh\n").unwrap();
    std::fs::set_permissions(&wl, std::fs::Permissions::from_mode(0o644)).unwrap();

    assert_eq!(
        candidates(&path_of(&[a.path(), b.path()])),
        [sdl3_in_a, sdl3_in_b, sdl_in_b, x_in_a]
    );
}

#[tokio::test]
async fn the_first_3_x_client_wins_and_older_ones_are_skipped() {
    let dir = tempfile::tempdir().unwrap();
    fake(
        dir.path(),
        "sdl-freerdp3",
        "This is FreeRDP version 2.11.7 (2.11.7)",
    );
    let x = v3(dir.path(), "xfreerdp3");
    v3(dir.path(), "wlfreerdp3");

    let client = detect(None, &path_of(&[dir.path()]), QUICK).await.unwrap();
    assert_eq!(client.path, x.to_string_lossy());
    assert_eq!(client.version, "3.10.3");
    assert_eq!(client.flavor, RdpFlavor::X11);
}

#[tokio::test]
async fn nothing_on_the_path_is_a_missing_client() {
    let empty = tempfile::tempdir().unwrap();
    let error = detect(None, &path_of(&[empty.path()]), QUICK)
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::RdpClientMissing);

    let error = detect(None, &OsString::new(), QUICK).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::RdpClientMissing);
}

#[tokio::test]
async fn a_forced_path_is_the_only_one_tried() {
    let dir = tempfile::tempdir().unwrap();
    v3(dir.path(), "sdl-freerdp3");
    let wrapper = v3(dir.path(), "my-rdp");

    let client = detect(
        Some(&wrapper.to_string_lossy()),
        &path_of(&[dir.path()]),
        QUICK,
    )
    .await
    .unwrap();
    assert_eq!(client.path, wrapper.to_string_lossy());
    // An unknown name is taken for an SDL client.
    assert_eq!(client.flavor, RdpFlavor::Sdl);
}

#[tokio::test]
async fn a_forced_path_that_is_not_a_3_x_client_is_refused_even_with_one_on_the_path() {
    let dir = tempfile::tempdir().unwrap();
    v3(dir.path(), "sdl-freerdp3");
    let old = fake(
        dir.path(),
        "xfreerdp",
        "This is FreeRDP version 2.11.7 (2.11.7)",
    );
    let path = path_of(&[dir.path()]);

    let error = detect(Some(&old.to_string_lossy()), &path, QUICK)
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::RdpClientMissing);

    let missing = dir.path().join("nope");
    let error = detect(Some(&missing.to_string_lossy()), &path, QUICK)
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::RdpClientMissing);
}

#[tokio::test]
async fn a_client_that_hangs_is_given_up_on() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sdl-freerdp3");
    std::fs::write(&path, "#!/bin/sh\nsleep 30\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    let x = v3(dir.path(), "xfreerdp3");

    let started = std::time::Instant::now();
    let client = detect(None, &path_of(&[dir.path()]), Duration::from_millis(300))
        .await
        .unwrap();
    assert_eq!(client.path, x.to_string_lossy());
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
}
