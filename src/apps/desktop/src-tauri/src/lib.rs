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
    let endpoint = value_for("--endpoint");
    let token = value_for("--token");
    let database_path = value_for("--database");
    let session_id = value_for("--session-id").unwrap_or_else(|| "hiveory-cli".to_owned());
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(_) => return true,
    };
    let _ = runtime.block_on(async move {
        if let (Some(endpoint), Some(token)) = (endpoint, token) {
            run_desktop_session_bridge(endpoint, token).await
        } else if let Some(database_path) = database_path {
            run_plugin_bridge(std::path::PathBuf::from(database_path), session_id).await
        } else {
            Err("A Hiveory CLI bridge needs a desktop endpoint or database path.".to_owned())
        }
    });
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

/// Proxies a CLI's stdio MCP exchange into the already-running Hiveory desktop
/// process. Browser and computer tools must execute there because they own the
/// native webview and desktop accessibility runtimes.
async fn run_desktop_session_bridge(endpoint: String, token: String) -> Result<(), String> {
    use serde_json::{json, Value};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

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
                    "serverInfo": { "name": "hiveory-cli-session", "version": env!("CARGO_PKG_VERSION") }
                }
            }),
            "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
            "tools/list" => {
                match desktop_bridge_request(&endpoint, &token, "tools/list", None, None).await {
                    Ok(payload) => match payload.get("tools").and_then(Value::as_array) {
                        Some(tools) => json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "tools": tools.iter().map(|tool| json!({
                                    "name": tool.get("name").and_then(Value::as_str).unwrap_or_default(),
                                    "description": tool.get("description").and_then(Value::as_str).unwrap_or_default(),
                                    "inputSchema": tool.get("input_schema_json")
                                        .and_then(Value::as_str)
                                        .and_then(|schema| serde_json::from_str::<Value>(schema).ok())
                                        .unwrap_or_else(|| json!({ "type": "object" }))
                                })).collect::<Vec<_>>()
                            }
                        }),
                        None => mcp_error(id, -32603, "Hiveory returned an invalid tool catalog"),
                    },
                    Err(error) => mcp_error(id, -32603, &error),
                }
            }
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
                match desktop_bridge_request(
                    &endpoint,
                    &token,
                    "tools/call",
                    Some(name),
                    Some(arguments),
                )
                .await
                {
                    Ok(payload) => match payload.get("output").and_then(Value::as_str) {
                        Some(output) => json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": { "content": [{ "type": "text", "text": output }], "isError": false }
                        }),
                        None => mcp_error(id, -32603, "Hiveory returned an invalid tool result"),
                    },
                    Err(error) => json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": { "content": [{ "type": "text", "text": error }], "isError": true }
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

async fn desktop_bridge_request(
    endpoint: &str,
    token: &str,
    method: &str,
    name: Option<&str>,
    arguments: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    use serde_json::{json, Value};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let stream = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::net::TcpStream::connect(endpoint),
    )
    .await
    .map_err(|_| "Hiveory desktop bridge did not respond in time.".to_owned())?
    .map_err(|error| format!("Hiveory desktop bridge is unavailable: {error}"))?;
    let mut reader = BufReader::new(stream);
    let request = json!({
        "token": token,
        "method": method,
        "name": name,
        "arguments": arguments,
    });
    let encoded = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    reader
        .get_mut()
        .write_all(format!("{encoded}\n").as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    reader
        .get_mut()
        .flush()
        .await
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    let read = tokio::time::timeout(
        std::time::Duration::from_secs(65),
        reader.read_line(&mut response),
    )
    .await
    .map_err(|_| "Hiveory desktop tool call timed out.".to_owned())?
    .map_err(|error| error.to_string())?;
    if read == 0 || response.len() > 4 * 1024 * 1024 {
        return Err("Hiveory desktop bridge returned no usable response.".to_owned());
    }
    let payload: Value = serde_json::from_str(&response)
        .map_err(|_| "Hiveory desktop bridge returned malformed data.".to_owned())?;
    if payload.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(payload)
    } else {
        Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Hiveory desktop bridge rejected the tool call.")
            .to_owned())
    }
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
