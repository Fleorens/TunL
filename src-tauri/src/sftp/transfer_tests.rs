use super::transfer::{first_free, local_target, suffixed};
use crate::error::ErrorKind;

#[test]
fn the_suffix_goes_before_the_extension() {
    assert_eq!(suffixed("report.pdf", 1), "report (1).pdf");
    assert_eq!(suffixed("archive.tar.gz", 2), "archive.tar (2).gz");
    assert_eq!(suffixed("notes", 3), "notes (3)");
    assert_eq!(suffixed(".bashrc", 1), ".bashrc (1)");
}

#[test]
fn the_first_free_name_is_kept() {
    assert_eq!(first_free("a.txt", |_| false), "a.txt");
    let taken = ["a.txt", "a (1).txt"];
    assert_eq!(first_free("a.txt", |n| taken.contains(&n)), "a (2).txt");
}

#[test]
fn a_download_never_replaces_a_local_file() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        local_target(dir.path(), "log.txt").unwrap(),
        dir.path().join("log.txt")
    );
    std::fs::write(dir.path().join("log.txt"), b"mine").unwrap();
    assert_eq!(
        local_target(dir.path(), "log.txt").unwrap(),
        dir.path().join("log (1).txt")
    );
    // A transfer in progress (its .part file) holds its name too.
    std::fs::write(dir.path().join("log (1).txt.part"), b"").unwrap();
    assert_eq!(
        local_target(dir.path(), "log.txt").unwrap(),
        dir.path().join("log (2).txt")
    );
}

#[test]
fn only_a_plain_base_name_is_accepted() {
    let dir = tempfile::tempdir().unwrap();
    for bad in ["", ".", "..", "a/b", "x\0y"] {
        let error = local_target(dir.path(), bad).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Validation, "{bad:?}");
    }
}
