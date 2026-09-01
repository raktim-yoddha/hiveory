#![allow(clippy::result_large_err)]

//! Stable public facade for the desktop application host.
//!
//! The implementation lives under `application/` so native commands and
//! lifecycle code can be split by responsibility without changing the crate's
//! public entry point.

mod application;

pub use application::run;

/// Runs the hidden terminal-host mode when the packaged Hiveory executable is
/// launched by the desktop process for PTY ownership.  Keeping this mode in
/// the same executable means release bundles do not need a second visible app
/// or console binary.
pub fn run_terminal_host_if_requested() -> bool {
    if !std::env::args().any(|argument| argument == "--terminal-host") {
        return false;
    }

    let value_for = |name: &str| {
        let mut arguments = std::env::args().skip(1);
        while let Some(argument) = arguments.next() {
            if argument == name {
                return arguments.next();
            }
        }
        None
    };
    let Some(database_path) = value_for("--database") else {
        return true;
    };
    let Some(ready_file) = value_for("--ready-file") else {
        return true;
    };
    let Some(lock_file) = value_for("--lock-file") else {
        return true;
    };
    let Some(history_key_ref) = value_for("--history-key-ref") else {
        return true;
    };
    let Some(token) = value_for("--host-token") else {
        return true;
    };

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(_) => return true,
    };
    let _ = runtime.block_on(hiveory_terminal_host::run_server(
        hiveory_terminal_host::HostConfig {
            database_path: std::path::PathBuf::from(database_path),
            ready_file: std::path::PathBuf::from(ready_file),
            lock_file: std::path::PathBuf::from(lock_file),
            token,
            history_key_ref,
        },
    ));
    true
}
