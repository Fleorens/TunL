// Lot 5 review: two downloads of the same file started together picked the same local name, and the
// second failed on its `.part` instead of becoming `name (1).ext`.
use super::transfer::reserve_local;

#[tokio::test]
async fn two_downloads_started_together_reserve_two_names() {
    let dir = tempfile::tempdir().unwrap();
    let (first, second) = tokio::join!(
        reserve_local(dir.path(), "report.pdf"),
        reserve_local(dir.path(), "report.pdf"),
    );
    let (first, first_part, _) = first.unwrap();
    let (second, second_part, _) = second.unwrap();
    assert_ne!(first, second);
    let mut names = [first, second].map(|path| path.file_name().unwrap().to_owned());
    names.sort();
    assert_eq!(
        names,
        ["report (1).pdf", "report.pdf"].map(std::ffi::OsString::from)
    );
    // Each name is held by its `.part` until the copy ends.
    assert!(std::path::Path::new(&first_part).exists());
    assert!(std::path::Path::new(&second_part).exists());
}

#[tokio::test]
async fn a_reserved_name_is_skipped_by_the_next_download() {
    let dir = tempfile::tempdir().unwrap();
    let (_, part, _) = reserve_local(dir.path(), "notes").await.unwrap();
    assert_eq!(part, format!("{}", dir.path().join("notes.part").display()));
    let (next, _, _) = reserve_local(dir.path(), "notes").await.unwrap();
    assert_eq!(next, dir.path().join("notes (1)"));
}
