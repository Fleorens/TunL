pub mod app;
pub mod connections;
pub mod groups;
pub mod import;
pub mod probe;
pub mod prompts;
pub mod rdp;
pub mod secrets;
pub mod settings;
pub mod sftp;
pub mod ssh;
pub mod store;
pub mod transfer;
pub mod wol;

#[cfg(test)]
mod ipc_prompts_tests;

#[cfg(test)]
mod ipc_probe_tests;

#[cfg(test)]
mod ipc_rdp_tests;

#[cfg(test)]
mod ipc_sftp_tests;

#[cfg(test)]
mod ipc_wol_tests;

#[cfg(test)]
mod ipc_tests;

#[cfg(test)]
mod ipc_import_tests;

#[cfg(test)]
mod ipc_ssh_tests;

#[cfg(test)]
mod ipc_transfer_tests;
