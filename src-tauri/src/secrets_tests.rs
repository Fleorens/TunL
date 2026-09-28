use uuid::Uuid;

use crate::error::ErrorKind;
use crate::secrets::{SecretKind, SecretStore, SecretValue, secret_label, validate_secret};

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}

#[test]
fn debug_never_shows_the_value() {
    let value = SecretValue::new("hunter2");
    assert_eq!(format!("{value:?}"), "SecretValue(***)");
    assert_eq!(value.expose(), "hunter2");
}

#[test]
fn a_secret_value_deserializes_from_a_plain_string() {
    let value: SecretValue = serde_json::from_str("\"s3cr\\u00e9t\"").unwrap();
    assert_eq!(value.expose(), "s3crét");
}

#[test]
fn validation_rejects_empty_long_and_control_characters() {
    assert!(validate_secret(&SecretValue::new("correct horse")).is_ok());
    let empty = validate_secret(&SecretValue::new("")).unwrap_err();
    assert_eq!(empty.kind, ErrorKind::Validation);
    assert_eq!(empty.message, "value: must not be empty");
    let long = validate_secret(&SecretValue::new("x".repeat(1025))).unwrap_err();
    assert_eq!(long.message, "value: is too long");
    assert!(validate_secret(&SecretValue::new("x".repeat(1024))).is_ok());
    let newline = validate_secret(&SecretValue::new("pass\nword")).unwrap_err();
    assert_eq!(
        newline.message,
        "value: must not contain control characters"
    );
}

#[test]
fn validation_errors_never_contain_the_value() {
    let error = validate_secret(&SecretValue::new("leak\u{7}me")).unwrap_err();
    assert!(!error.message.contains("leak"));
}

#[test]
fn kinds_and_labels() {
    assert_eq!(SecretKind::Password.as_str(), "password");
    assert_eq!(SecretKind::Passphrase.as_str(), "passphrase");
    assert_eq!(
        serde_json::to_string(&SecretKind::Passphrase).unwrap(),
        "\"passphrase\""
    );
    assert_eq!(
        secret_label("web-01", SecretKind::Password),
        "TunL — web-01 (password)"
    );
}

#[test]
fn memory_store_sets_replaces_and_reads() {
    let store = SecretStore::memory();
    let id = Uuid::new_v4();
    block_on(async {
        assert!(!store.has(id, SecretKind::Password).await.unwrap());
        store
            .set(id, "web-01", SecretKind::Password, &SecretValue::new("one"))
            .await
            .unwrap();
        store
            .set(id, "web-01", SecretKind::Password, &SecretValue::new("two"))
            .await
            .unwrap();
        assert!(store.has(id, SecretKind::Password).await.unwrap());
        assert!(!store.has(id, SecretKind::Passphrase).await.unwrap());
        let read = store.get(id, SecretKind::Password).await.unwrap().unwrap();
        assert_eq!(read.expose(), "two");
    });
}

#[test]
fn memory_store_deletes_one_kind_or_all() {
    let store = SecretStore::memory();
    let id = Uuid::new_v4();
    let other = Uuid::new_v4();
    block_on(async {
        for kind in [SecretKind::Password, SecretKind::Passphrase] {
            store
                .set(id, "a", kind, &SecretValue::new("x"))
                .await
                .unwrap();
        }
        store
            .set(other, "b", SecretKind::Password, &SecretValue::new("y"))
            .await
            .unwrap();
        store.delete(id, SecretKind::Password).await.unwrap();
        assert!(!store.has(id, SecretKind::Password).await.unwrap());
        assert!(store.has(id, SecretKind::Passphrase).await.unwrap());
        store.delete_all(id).await.unwrap();
        assert!(!store.has(id, SecretKind::Passphrase).await.unwrap());
        assert!(store.has(other, SecretKind::Password).await.unwrap());
    });
}

#[test]
fn deleting_an_absent_secret_is_not_an_error() {
    let store = SecretStore::memory();
    block_on(async {
        store
            .delete(Uuid::new_v4(), SecretKind::Passphrase)
            .await
            .unwrap();
        store.delete_all(Uuid::new_v4()).await.unwrap();
    });
}

#[test]
fn get_returns_none_when_absent() {
    let store = SecretStore::memory();
    block_on(async {
        assert!(
            store
                .get(Uuid::new_v4(), SecretKind::Password)
                .await
                .unwrap()
                .is_none()
        );
    });
}

/// Real Secret Service round trip. Never run automatically: `cargo test -- --ignored keyring_round_trip`.
#[tokio::test]
// project-rules: allow no-ignored-rust-test — touches the real Secret Service, run by hand only
#[ignore]
async fn keyring_round_trip() {
    let store = SecretStore::keyring();
    let id = Uuid::new_v4();
    store
        .set(
            id,
            "tunl-test",
            SecretKind::Password,
            &SecretValue::new("round-trip"),
        )
        .await
        .unwrap();
    assert!(store.has(id, SecretKind::Password).await.unwrap());
    assert_eq!(
        store
            .get(id, SecretKind::Password)
            .await
            .unwrap()
            .unwrap()
            .expose(),
        "round-trip"
    );
    store.delete_all(id).await.unwrap();
    assert!(!store.has(id, SecretKind::Password).await.unwrap());
}
