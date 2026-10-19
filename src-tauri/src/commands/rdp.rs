//! The `rdp_detect` and `rdp_open` commands (this sheet).
//!
//! `rdp_detect` reports the FreeRDP 3 client TunL would launch with. `rdp_open` opens an RDP tab: it
//! resolves the connection and the client, reads the password from the vault, registers the tab, and
//! runs it in the background (answering at once, like `sftp_open`).
use std::sync::Arc;

use tauri::State;
use tauri::ipc::Channel;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::commands::sftp::EventSink;
use crate::error::AppResult;
use crate::rdp::args::RdpCredentials;
use crate::rdp::detect::{detect, RdpClient, VERSION_TIMEOUT};
use crate::rdp::session::{RdpRun, resolve_rdp, run_rdp_session};
use crate::secrets::SecretKind;
use crate::sessions::{SessionEvent, SessionHandle, SessionSink};
use crate::ssh::session::default_username;
use crate::state::AppState;
use crate::wol::{WAKE_POLL_INTERVAL, run_wake_step, wake_target};

/// Find the FreeRDP 3 client, from the forced path in the settings or the `PATH`.
#[tauri::command]
pub async fn rdp_detect(state: State<'_, AppState>) -> AppResult<RdpClient> {
    let settings = state.get_settings().await;
    // The `PATH` of the process; empty when it is not set.
    let path_var = std::env::var_os("PATH").unwrap_or_default();
    detect(
        settings.rdp.client_path.as_deref(),
        &path_var,
        VERSION_TIMEOUT,
    )
    .await
}

/// Open an RDP tab against a stored connection (this sheet).
///
/// Resolve the connection and the client, read the password, register the tab, then spawn the task and
/// answer at once (like `sftp_open`).
#[tauri::command]
pub async fn rdp_open(
    state: State<'_, AppState>,
    session_id: Uuid,
    connection_id: Uuid,
    on_event: Channel<SessionEvent>,
) -> AppResult<()> {
    let settings = state.get_settings().await;
    let store = state.read_store().await?;

    // The connection must exist and be RDP; the client must be a FreeRDP 3 binary. These errors come
    // back at once, before anything starts.
    let connection = store
        .connections
        .iter()
        .find(|c| c.id == connection_id);
    let target = resolve_rdp(connection_id, &store, &settings.ssh, default_username().as_deref())?;
    let client = detect(
        settings.rdp.client_path.as_deref(),
        &std::env::var_os("PATH").unwrap_or_default(),
        VERSION_TIMEOUT,
    )
    .await?;

    // The password from the vault is not fatal: an error is logged by kind only, and FreeRDP will ask
    // in its own window (S2).
    let password = match state.secrets.get(connection_id, SecretKind::Password).await {
        Ok(password) => password,
        Err(error) => {
            log::warn!("cannot read the RDP password: {:?}", error.kind);
            None
        }
    };

    // A direct connection that asked to be woken first (T29); never behind a bastion.
    let wake = connection.and_then(wake_target);

    // The tab's cancel token, so it can be ended. An RDP tab receives no keystrokes: one channel whose
    // receiver is never read.
    let (input, _output) = mpsc::unbounded_channel::<crate::sessions::ShellInput>();
    let cancel = CancellationToken::new();
    state.sessions.insert(
        session_id,
        SessionHandle {
            cancel: cancel.clone(),
            input,
        },
    )?;

    // Everything the spawned task needs, cloned out of `state` before the command returns.
    let sessions = state.sessions.clone();
    let prompts = state.prompts.clone();
    let ctx = state.ssh_context();
    let credentials = RdpCredentials {
        username: target.username.clone(),
        password,
    };
    let sink: Arc<dyn SessionSink> = Arc::new(EventSink { on_event });

    tauri::async_runtime::spawn(async move {
        // Wake first, and only connect when it finished (a failure or a closed tab stops here). The
        // cleanup below runs in every case.
        let woke = match wake {
            Some(wake) => run_wake_step(&wake, WAKE_POLL_INTERVAL, cancel.clone(), &*sink).await,
            None => true,
        };
        if woke {
            run_rdp_session(
                ctx,
                RdpRun {
                    id: session_id,
                    target,
                    credentials,
                    client: client.path.into(),
                    cancel,
                },
                sink,
            )
            .await;
        }
        sessions.remove(session_id);
        prompts.cancel_session(session_id);
    });

    Ok(())
}
