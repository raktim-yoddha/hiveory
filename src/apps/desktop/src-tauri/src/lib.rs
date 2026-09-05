#![allow(clippy::result_large_err)]

//! Stable public facade for the desktop application host.
//!
//! The implementation lives under `application/` so native commands and
//! lifecycle code can be split by responsibility without changing the crate's
//! public entry point.

mod application;

pub use application::run;

/// Runs the local stdio MCP bridge used only by coding CLIs launched from a
/// Hiveory pane. The bridge reads plugin metadata from Hiveory's SQLite store,
/// resolves credentials through the OS keyring, and never prints secrets.
pub fn run_plugin_bridge_if_requested() -> bool {
    if !std::env::args().any(|argument| argument == "--plugin-bridge") {
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
    let session_id = value_for("--session-id").unwrap_or_else(|| "hiveory-cli".to_owned());
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(_) => return true,
    };
    let _ = runtime.block_on(run_plugin_bridge(
        std::path::PathBuf::from(database_path),
        session_id,
    ));
    true
}

async fn run_plugin_bridge(
    database_path: std::path::PathBuf,
    session_id: String,
) -> Result<(), String> {
    use hiveory_secret_store::HiveoryKeyringSecretStore;
    use hiveory_tool_runtime::HiveoryAuditLog;
    use serde_json::{json, Value};
    use std::sync::Arc;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let persistence = hiveory_persistence::HiveoryPersistence::open(&database_path)
        .await
        .map_err(|error| error.to_string())?;
    let secrets: hiveory_secret_store::HiveorySecretStoreHandle =
        Arc::new(HiveoryKeyringSecretStore);
    let audit = HiveoryAuditLog::new(persistence.clone());
    let plugins = hiveory_plugin_runtime::HiveoryPluginRuntime::new(persistence, secrets, audit)
        .map_err(|error| error.to_string())?;
    plugins
        .initialize()
        .await
        .map_err(|error| error.to_string())?;

    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut stdout = tokio::io::stdout();
    while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
        let Ok(request) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(id) = request.get("id").cloned() else {
            continue;
        };
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let response = match method {
            "initialize" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "hiveory-local-plugins", "version": env!("CARGO_PKG_VERSION") }
                }
            }),
            "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
            "tools/list" => match plugins.session_definitions().await {
                Ok(definitions) => json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "tools": definitions.into_iter().map(|tool| json!({
                            "name": tool.name,
                            "description": tool.description,
                            "inputSchema": serde_json::from_str::<Value>(&tool.input_schema_json)
                                .unwrap_or_else(|_| json!({ "type": "object" }))
                        })).collect::<Vec<_>>()
                    }
                }),
                Err(error) => mcp_error(id, -32603, &error.to_string()),
            },
            "tools/call" => {
                let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
                let name = params
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let arguments = params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                match plugins
                    .execute_session(&session_id, name, &arguments.to_string())
                    .await
                {
                    Ok(output) => json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": { "content": [{ "type": "text", "text": output }], "isError": false }
                    }),
                    Err(error) => json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": { "content": [{ "type": "text", "text": error.to_string() }], "isError": true }
                    }),
                }
            }
            _ => mcp_error(id, -32601, "method not found"),
        };
        stdout
            .write_all(format!("{}\n", response).as_bytes())
            .await
            .map_err(|error| error.to_string())?;
        stdout.flush().await.map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn mcp_error(id: serde_json::Value, code: i64, message: &str) -> serde_json::Value {
    serde_json::json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

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
