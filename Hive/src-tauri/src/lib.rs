use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_file: bool,
    pub is_dir: bool,
}

// Nectar command structures
#[derive(Debug, Serialize, Deserialize)]
pub struct NectarInitRequest {
    pub project_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarInitResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarEnsureStructureRequest {
    pub project_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarEnsureStructureResponse {
    pub success: bool,
    pub created_files: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarReadMemoryFileRequest {
    pub project_path: String,
    pub relative_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarReadMemoryFileResponse {
    pub content: String,
    pub frontmatter: Option<serde_json::Value>,
    pub file_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarWriteMemoryFileRequest {
    pub project_path: String,
    pub relative_path: String,
    pub content: String,
    pub frontmatter: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarWriteMemoryFileResponse {
    pub success: bool,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarListMemoryFilesRequest {
    pub project_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarListMemoryFilesResponse {
    pub files: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarParseMarkdownToChunksRequest {
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChunkInfo {
    pub text: String,
    pub heading: Option<String>,
    #[serde(default)]
    pub chunk_index: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarParseMarkdownToChunksResponse {
    pub chunks: Vec<ChunkInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarIndexFileRequest {
    pub project_path: String,
    pub relative_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarIndexFileResponse {
    pub success: bool,
    pub chunks_indexed: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarSearchRequest {
    pub project_path: String,
    pub query: String,
    pub limit: Option<usize>,
    pub min_score: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub chunk: ChunkInfo,
    pub source_file: String,
    pub score: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarSearchResponse {
    pub results: Vec<SearchResult>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarInjectRequest {
    pub project_path: String,
    pub task: String,
    pub open_files: Vec<String>,
    pub git_diff: Option<String>,
    pub max_tokens: Option<usize>,
    pub max_chunks: Option<usize>,
    pub min_score: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InjectedChunk {
    pub content: String,
    pub source_file: String,
    pub score: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarInjectResponse {
    pub chunks: Vec<InjectedChunk>,
    pub query: String,
    pub total_tokens: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarFormatContextRequest {
    pub agent_type: String,
    pub chunks: Vec<InjectedChunk>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarFormatContextResponse {
    pub formatted_text: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarLogSessionRequest {
    pub project_path: String,
    pub session_id: String,
    pub agent_type: String,
    pub task: String,
    pub query: String,
    pub chunks: Vec<InjectedChunk>,
    pub total_tokens: usize,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub worktree_id: Option<String>,
    #[serde(default)]
    pub message_count: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarListSessionsRequest {
    pub project_path: String,
    pub scope: String,
    pub filter: Option<String>,
    pub worktree_id: Option<String>,
    pub workspace_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarSessionEntry {
    pub id: String,
    pub agent_type: String,
    pub title: String,
    pub branch: Option<String>,
    pub worktree_id: Option<String>,
    pub message_count: Option<i64>,
    pub total_tokens: Option<i64>,
    pub timestamp: Option<i64>,
    pub preview: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarListSessionsResponse {
    pub sessions: Vec<NectarSessionEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarLogSessionResponse {
    pub success: bool,
    pub log_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarCloseRequest {
    pub project_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NectarCloseResponse {
    pub success: bool,
}

/// One live terminal: the master pty, the child handle (so we can actually kill
/// it), a persistent stdin writer, and a buffer fed by a background reader thread.
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
    output: Arc<Mutex<String>>,
}

struct PtySystem {
    sessions: Mutex<HashMap<String, Arc<Mutex<PtySession>>>>,
}

#[tauri::command]
async fn spawn_terminal(
    pane_id: String,
    command: String,
    args: Vec<String>,
    working_dir: Option<String>,
    env: Option<HashMap<String, String>>,
    rows: Option<u16>,
    cols: Option<u16>,
    state: State<'_, PtySystem>,
) -> Result<String, String> {
    println!("[Rust] spawn_terminal called: pane_id={}, command={}, args={:?}", pane_id, command, args);
    
    let pty_system = native_pty_system();
    
    // Clean the command string - remove any null bytes
    let command = command.trim().replace('\0', "");
    
    // Check if this is a shell. v1 supports cmd.exe, powershell.exe, bash.exe, wsl.exe.
    let is_shell = matches!(
        command.as_str(),
        "cmd.exe" | "powershell.exe" | "bash.exe" | "wsl.exe"
    );

    let mut cmd = if command == "cmd.exe" {
        // cmd.exe itself: /K keeps it interactive.
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.arg("/K");
        cmd
    } else if is_shell {
        // Other shells (powershell, bash, wsl) resolve their own binary fine.
        CommandBuilder::new(&command)
    } else {
        // CLI agents (claude, codex, gemini, aider, opencode, kimi, cline, ...)
        // are almost always npm-global installs, which on Windows are `.cmd`/
        // `.ps1` shim scripts, not raw `.exe`s. CreateProcess (what portable-pty
        // calls under the hood) does NOT do PATHEXT resolution — only a real
        // shell does — so spawning "claude" directly fails to find the binary
        // even though `claude` works fine when typed into a normal terminal.
        // Route through cmd.exe /K exactly like a user would, so its PATHEXT-
        // aware command resolution finds the shim and the window stays open
        // to show a clear error if the CLI genuinely isn't installed.
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.arg("/K");
        cmd.arg(&command);
        cmd
    };
    
    // Set working directory. Use the CommandBuilder's own cwd so we never mutate
    // the shared process-wide current directory (which would race across panes).
    if let Some(dir) = working_dir {
        if let Ok(path) = PathBuf::from(&dir).canonicalize() {
            if path.exists() {
                // canonicalize() yields a \\?\ UNC prefix on Windows that some
                // shells choke on; strip it for a plain path.
                let path_str = path
                    .to_string_lossy()
                    .trim_start_matches(r"\\?\")
                    .to_string();
                cmd.cwd(&path_str);
            }
        }
    }
    
    // Add any additional args
    for arg in args {
        cmd.arg(&arg);
    }

    // API keys for the CLI agent (e.g. ANTHROPIC_API_KEY), set from Settings.
    if let Some(env_vars) = env {
        for (key, value) in env_vars {
            cmd.env(&key, &value);
        }
    }

    // Open the pty at the CALLER'S already-fitted size, not a hardcoded
    // default. Interactive TUIs (Claude Code, Codex CLI, OpenCode, ...) query
    // the terminal size once at startup and lay out their splash screen for
    // it; real terminals don't reflow already-drawn content when a later
    // resize (SIGWINCH) arrives. Spawning at 24x80 and resizing a moment
    // later — which is what a xterm.js pane inside a large CSS-grid card
    // actually needs — left the CLI's UI drawn for a tiny terminal, stranded
    // in the corner of a much bigger pane (the "big empty gap" bug).
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // Spawn the child, then drop the slave so the master sees EOF when the child exits.
    println!("[Rust] spawning command inside PTY...");
    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;
    drop(pty_pair.slave);

    let pid = child.process_id();
    println!("[Rust] successfully spawned process! PID={:?}", pid);

    let writer = pty_pair.master.take_writer().map_err(|e| e.to_string())?;
    let reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;

    // Background thread drains the pty into a shared buffer so reads never block
    // the async command handler (portable-pty readers are blocking).
    let output = Arc::new(Mutex::new(String::new()));
    let output_writer = output.clone();
    let pane_id_clone = pane_id.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0u8; 4096];
        let start_time = std::time::Instant::now();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    println!("[Rust PTY Reader - {}] EOF reached", pane_id_clone);
                    break;
                }
                Ok(n) => {
                    if start_time.elapsed().as_secs() < 5 {
                        let text = String::from_utf8_lossy(&buffer[..n]);
                        println!("[Rust PTY Reader Debug - {}] read {} bytes: {:?}", pane_id_clone, n, text);
                    }
                    if let Ok(mut buf) = output_writer.lock() {
                        buf.push_str(&String::from_utf8_lossy(&buffer[..n]));
                    }
                }
                Err(e) => {
                    println!("[Rust PTY Reader - {}] read error: {:?}", pane_id_clone, e);
                    break;
                }
            }
        }
    });

    let session = PtySession {
        master: pty_pair.master,
        child,
        writer,
        output,
    };

    let mut sessions = state.sessions.lock().unwrap();
    // If a pane with this id already exists, kill it first to avoid orphans.
    if let Some(old) = sessions.remove(&pane_id) {
        if let Ok(mut old) = old.lock() {
            let _ = old.child.kill();
        }
    }
    sessions.insert(pane_id.clone(), Arc::new(Mutex::new(session)));

    Ok(pane_id)
}

#[tauri::command]
async fn write_to_terminal(
    pane_id: String,
    data: String,
    state: State<'_, PtySystem>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.lock().unwrap();
        sessions.get(&pane_id).cloned()
    };
    if let Some(session) = session {
        let mut session = session.lock().unwrap();
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("No terminal found for pane: {}", pane_id))
    }
}

#[tauri::command]
async fn read_from_terminal(
    pane_id: String,
    state: State<'_, PtySystem>,
) -> Result<String, String> {
    let session = {
        let sessions = state.sessions.lock().unwrap();
        sessions.get(&pane_id).cloned()
    };
    if let Some(session) = session {
        let session = session.lock().unwrap();
        let mut buf = session.output.lock().unwrap();
        Ok(std::mem::take(&mut *buf))
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
async fn resize_terminal(
    pane_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, PtySystem>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.lock().unwrap();
        sessions.get(&pane_id).cloned()
    };
    if let Some(session) = session {
        let session = session.lock().unwrap();
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn kill_terminal(
    pane_id: String,
    state: State<'_, PtySystem>,
) -> Result<(), String> {
    let session = {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.remove(&pane_id)
    };
    if let Some(session) = session {
        if let Ok(mut session) = session.lock() {
            // Kill the child process explicitly, then reap it.
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
    }
    Ok(())
}

#[tauri::command]
async fn is_process_alive(
    pane_id: String,
    state: State<'_, PtySystem>,
) -> Result<bool, String> {
    let sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get(&pane_id) {
        if let Ok(mut session) = session.lock() {
            match session.child.try_wait() {
                Ok(Some(_status)) => Ok(false), // Exited
                Ok(None) => Ok(true), // Still running
                Err(_) => Ok(false),
            }
        } else {
            Ok(false)
        }
    } else {
        Ok(false)
    }
}

#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_directory(path: String) -> Result<Vec<FileInfo>, String> {
    let dir_path = Path::new(&path);
    if !dir_path.exists() || !dir_path.is_dir() {
        return Err("Path does not exist or is not a directory".to_string());
    }

    let mut files = Vec::new();
    let entries = fs::read_dir(dir_path).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        
        files.push(FileInfo {
            name: name.clone(),
            path: path.to_string_lossy().to_string(),
            is_file: path.is_file(),
            is_dir: path.is_dir(),
        });
    }

    files.sort_by(|a, b| {
        // Directories first, then files
        if a.is_dir && !b.is_dir {
            return std::cmp::Ordering::Less;
        }
        if !a.is_dir && b.is_dir {
            return std::cmp::Ordering::Greater;
        }
        a.name.cmp(&b.name)
    });

    Ok(files)
}

#[tauri::command]
async fn get_project_path() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

/// Return the absolute path to the Nectar MCP server script.
///
/// The server now lives in the standalone `@hiveory/nectar-mcp` package at
/// `Nectar/nectar-mcp/dist/server.js` (built from TypeScript), not the old
/// `Hive/mcp-server/index.js`. We probe a few candidate locations relative to
/// the app cwd so this works in dev (cwd = Hive) and from the repo root.
#[tauri::command]
async fn get_nectar_mcp_path() -> Result<String, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;

    let candidates = [
        // dev: cwd is the Hive/ dir
        cwd.join("..")
            .join("Nectar")
            .join("nectar-mcp")
            .join("dist")
            .join("server.js"),
        // repo root as cwd
        cwd.join("Nectar")
            .join("nectar-mcp")
            .join("dist")
            .join("server.js"),
    ];

    for candidate in candidates.iter() {
        if candidate.exists() {
            return Ok(candidate.to_string_lossy().to_string());
        }
    }

    Err(format!(
        "Nectar MCP server not found. Looked in: {:?}",
        candidates
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<_>>()
    ))
}

/// Create a directory and all its parents (like `mkdir -p`).
#[tauri::command]
async fn ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create directory {}: {}", path, e))
}

/// Run a one-off command and return stdout (used for CLI MCP registration).
#[tauri::command]
async fn run_command(command: String, args: Vec<String>) -> Result<String, String> {
    let output = std::process::Command::new(&command)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run {}: {}", command, e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{} failed: {}", command, stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
async fn get_home_dir() -> Result<String, String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub changed: u32,
}

// AGENTS.md §6: editor mode needs "basic git status/diff" — shell out to the
// system `git`, no bundled git library required for this minimal read.
#[tauri::command]
async fn git_status(project_path: String) -> Result<GitStatus, String> {
    let branch_output = std::process::Command::new("git")
        .args(["-C", &project_path, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .map_err(|e| e.to_string())?;

    if !branch_output.status.success() {
        return Err("Not a git repository".to_string());
    }

    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    let status_output = std::process::Command::new("git")
        .args(["-C", &project_path, "status", "--porcelain"])
        .output()
        .map_err(|e| e.to_string())?;

    let changed = String::from_utf8_lossy(&status_output.stdout)
        .lines()
        .filter(|l| !l.trim().is_empty())
        .count() as u32;

    Ok(GitStatus { branch, changed })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShellInfo {
    pub id: String,
    pub label: String,
    pub command: String,
}

// Return true if `name` resolves to a file on PATH.
fn exe_on_path(name: &str) -> Option<String> {
    let paths = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&paths) {
        let full = dir.join(name);
        if full.is_file() {
            return Some(full.to_string_lossy().into_owned());
        }
    }
    None
}

/// Detect the shells actually installed so the UI only offers ones that work.
#[tauri::command]
async fn detect_shells() -> Result<Vec<ShellInfo>, String> {
    let mut shells = Vec::new();
    let mut push = |id: &str, label: &str, cmd: &str| {
        if exe_on_path(cmd).is_some() {
            shells.push(ShellInfo { id: id.into(), label: label.into(), command: cmd.into() });
        }
    };

    #[cfg(windows)]
    {
        push("powershell", "Windows PowerShell", "powershell.exe");
        push("pwsh", "PowerShell 7", "pwsh.exe");
        push("cmd", "Command Prompt", "cmd.exe");
        push("git-bash", "Git Bash", "bash.exe");
        push("wsl", "WSL", "wsl.exe");
    }
    #[cfg(not(windows))]
    {
        push("bash", "Bash", "bash");
        push("zsh", "Zsh", "zsh");
        push("fish", "Fish", "fish");
        push("sh", "sh", "sh");
    }

    // Never return empty — fall back to the platform default so the button works.
    if shells.is_empty() {
        #[cfg(windows)]
        shells.push(ShellInfo { id: "cmd".into(), label: "Command Prompt".into(), command: "cmd.exe".into() });
        #[cfg(not(windows))]
        shells.push(ShellInfo { id: "sh".into(), label: "sh".into(), command: "sh".into() });
    }
    Ok(shells)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub task_id: String,
}

// HiveMind orchestration: git worktree isolation. HiveMind/src/worktree/index.ts
// implements this in Node (child_process) and is therefore unusable from the
// Tauri renderer — these commands are the backend the renderer dispatch calls.
#[tauri::command]
async fn create_worktree(project_path: String, task_id: String) -> Result<WorktreeInfo, String> {
    let branch = format!("agent/{}", task_id);
    let project = std::path::Path::new(&project_path);
    let parent = project
        .parent()
        .ok_or_else(|| "project path has no parent directory".to_string())?;
    let name = project
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "invalid project path".to_string())?;
    let worktree_str = parent
        .join(format!("{}-{}", name, task_id))
        .to_string_lossy()
        .to_string();

    let output = std::process::Command::new("git")
        .args(["-C", &project_path, "worktree", "add", &worktree_str, "-b", &branch])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "git worktree add failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(WorktreeInfo { path: worktree_str, branch, task_id })
}

fn remove_worktree_inner(project_path: &str, worktree_path: &str) -> Result<(), String> {
    let output = std::process::Command::new("git")
        .args(["-C", project_path, "worktree", "remove", worktree_path, "--force"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "git worktree remove failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

/// Merge an agent's branch back into the project, then remove its worktree.
#[tauri::command]
async fn merge_worktree(
    project_path: String,
    branch: String,
    worktree_path: String,
) -> Result<(), String> {
    let merge = std::process::Command::new("git")
        .args(["-C", &project_path, "merge", &branch])
        .output()
        .map_err(|e| e.to_string())?;
    if !merge.status.success() {
        return Err(format!(
            "git merge failed: {}",
            String::from_utf8_lossy(&merge.stderr)
        ));
    }
    remove_worktree_inner(&project_path, &worktree_path)
}

#[tauri::command]
async fn remove_worktree(project_path: String, worktree_path: String) -> Result<(), String> {
    remove_worktree_inner(&project_path, &worktree_path)
}

#[tauri::command]
async fn nectar_ensure_structure(
    req: NectarEnsureStructureRequest,
) -> Result<NectarEnsureStructureResponse, String> {
    // Synchronize process working directory to the opened folder
    let path = std::path::Path::new(&req.project_path);
    if path.exists() && path.is_dir() {
        std::env::set_current_dir(path)
            .map_err(|e| format!("Failed to set current directory to {}: {}", req.project_path, e))?;
        println!("[Rust] Changed process current directory to: {:?}", path);
    }

    let nectar_path = std::path::Path::new(&req.project_path).join(".nectar");
    let dirs = [
        nectar_path.join("memory"),
        nectar_path.join("agents").join("sessions"),
        nectar_path.join("agents").join("summaries"),
        nectar_path.join("tasks"),
        nectar_path.join("index"),
    ];

    let mut created_files = Vec::new();

    for dir in dirs {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }

    // Create default memory files
    let memory_files = [
        ("project.md", "# Project Overview\n\n<!-- Add project description here -->"),
        ("architecture.md", "# Architecture\n\n<!-- Add architecture details here -->"),
        ("decisions.md", "# Architecture Decisions\n\n<!-- Log ADRs here -->"),
        ("conventions.md", "# Coding Conventions\n\n<!-- Add coding standards here -->"),
        ("patterns.md", "# Design Patterns\n\n<!-- Document patterns used here -->"),
        ("bugs.md", "# Known Bugs & Issues\n\n<!-- Track bugs and fixes here -->"),
        ("knowledge.md", "# General Knowledge\n\n<!-- Add any other knowledge here -->"),
    ];

    let memory_path = nectar_path.join("memory");
    for (filename, content) in memory_files {
        let file_path = memory_path.join(filename);
        if !file_path.exists() {
            fs::write(&file_path, content).map_err(|e| e.to_string())?;
            created_files.push(filename.to_string());
        }
    }

    Ok(NectarEnsureStructureResponse {
        success: true,
        created_files,
    })
}

// Keep old command for backward compatibility, will remove later
#[tauri::command]
async fn ensure_nectar_structure(project_path: String) -> Result<(), String> {
    let req = NectarEnsureStructureRequest {
        project_path,
    };
    nectar_ensure_structure(req).await.map(|_| ())
}

#[tauri::command]
async fn nectar_read_memory_file(
    req: NectarReadMemoryFileRequest,
) -> Result<NectarReadMemoryFileResponse, String> {
    let full_path = std::path::Path::new(&req.project_path)
        .join(".nectar")
        .join(&req.relative_path);

    let content = fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // Simple frontmatter parsing - look for YAML between --- markers
    let frontmatter = if content.starts_with("---") {
        let parts: Vec<&str> = content.splitn(3, "---").collect();
        if parts.len() >= 2 {
            serde_yaml::from_str(parts[1]).ok()
        } else {
            None
        }
    } else {
        None
    };

    // Determine file type based on path
    let file_type = if req.relative_path.starts_with("agents/sessions/") {
        "agent_session".to_string()
    } else if req.relative_path.starts_with("agents/summaries/") {
        "agent_summary".to_string()
    } else if req.relative_path == "agents/handoffs.md" {
        "handoff".to_string()
    } else if req.relative_path.starts_with("tasks/") {
        "task_state".to_string()
    } else {
        "memory".to_string()
    };

    Ok(NectarReadMemoryFileResponse {
        content,
        frontmatter,
        file_type,
    })
}

#[tauri::command]
async fn nectar_write_memory_file(
    req: NectarWriteMemoryFileRequest,
) -> Result<NectarWriteMemoryFileResponse, String> {
    let full_path = std::path::Path::new(&req.project_path)
        .join(".nectar")
        .join(&req.relative_path);

    // Create parent directory if it doesn't exist
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // Add frontmatter if provided
    let file_content = if let Some(fm) = req.frontmatter {
        let fm_str = serde_yaml::to_string(&fm)
            .map_err(|e| format!("Failed to serialize frontmatter: {}", e))?;
        format!("---\n{}\n---\n{}", fm_str, req.content)
    } else {
        req.content.clone()
    };

    fs::write(&full_path, file_content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(NectarWriteMemoryFileResponse {
        success: true,
        path: req.relative_path,
    })
}

#[tauri::command]
async fn nectar_list_memory_files(
    req: NectarListMemoryFilesRequest,
) -> Result<NectarListMemoryFilesResponse, String> {
    let nectar_base = std::path::Path::new(&req.project_path).join(".nectar");
    let memory_path = nectar_base.join("memory");

    let mut files = Vec::new();

    // 1. All files in memory/
    if memory_path.exists() {
        let entries = fs::read_dir(&memory_path)
            .map_err(|e| format!("Failed to read directory: {}", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "md") {
                if let Some(name_str) = path.file_name().and_then(|n| n.to_str()) {
                    files.push(format!("memory/{}", name_str));
                }
            }
        }
    }

    // NOTE: Only memory/ files are returned here. agents/handoffs.md and
    // agents/sessions/* are NEVER included — handoffs are read directly by
    // the frontend (bypassing the index), and session logs are human-audit
    // only. Including them would cause a self-polluting feedback loop where
    // audit logs containing query text match FTS5 and get re-injected as
    // "relevant memory" on the next turn.
    files.sort();
    Ok(NectarListMemoryFilesResponse { files })
}

#[tauri::command]
async fn nectar_parse_markdown_to_chunks(
    req: NectarParseMarkdownToChunksRequest,
) -> Result<NectarParseMarkdownToChunksResponse, String> {
    let mut chunks = Vec::new();
    let mut current_heading: Option<String> = None;
    let mut current_text = String::new();
    
    let lines: Vec<&str> = req.content.lines().collect();
    
    for line in lines {
        let trimmed = line.trim();
        
        // Check if this is a heading
        if trimmed.starts_with('#') {
            // Save previous chunk if there's content
            if !current_text.trim().is_empty() {
                chunks.push(ChunkInfo {
                    text: current_text.trim().to_string(),
                    heading: current_heading.clone(),
                    chunk_index: Some(chunks.len()),
                });
                current_text = String::new();
            }
            
            // Extract heading level and text
            let heading_text = trimmed.trim_start_matches('#').trim().to_string();
            current_heading = Some(heading_text);
        } else if !trimmed.is_empty() {
            // Add paragraph text
            current_text.push_str(trimmed);
            current_text.push_str("\n\n");
        }
    }
    
    // Don't forget the last chunk
    if !current_text.trim().is_empty() {
        chunks.push(ChunkInfo {
            text: current_text.trim().to_string(),
            heading: current_heading,
            chunk_index: Some(chunks.len()),
        });
    }
    
    Ok(NectarParseMarkdownToChunksResponse { chunks })
}

fn get_db_path(project_path: &str) -> PathBuf {
    Path::new(project_path).join(".nectar").join("nectar.db")
}

fn init_db(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS nectar_meta (key TEXT PRIMARY KEY, value TEXT)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS memory_files (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL,
            type TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            source_file TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            heading TEXT,
            embedding BLOB,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (source_file) REFERENCES memory_files(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Migration v1 → v2: add chunk_index to FTS5 (needed for RRF dedup)
    let schema_version: i32 = conn
        .query_row(
            "SELECT value FROM nectar_meta WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if schema_version < 2 {
        // Rebuild FTS5 with chunk_index column so hybrid-search RRF can dedup
        // by (source_file, chunk_index) instead of content hashing.
        conn.execute("DROP TABLE IF EXISTS chunks_fts", [])?;
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                content, source_file, heading, chunk_index
            )",
            [],
        )?;
        // Add embedding column for vector search (safe if already present)
        conn.execute_batch("ALTER TABLE chunks ADD COLUMN embedding BLOB;").ok();
        // Re-populate FTS5 from existing chunks (no-op if chunks is empty)
        conn.execute(
            "INSERT INTO chunks_fts (content, source_file, heading, chunk_index)
             SELECT content, source_file, heading, chunk_index FROM chunks",
            [],
        )?;
        conn.execute(
            "INSERT OR REPLACE INTO nectar_meta (key, value) VALUES ('schema_version', '2')",
            [],
        )?;
    }

    Ok(())
}

#[tauri::command]
async fn nectar_index_file(
    req: NectarIndexFileRequest,
) -> Result<NectarIndexFileResponse, String> {
    // AGENTS.md §4.3: re-chunking must be incremental.  Check the file's
    // modification time against the DB's updated_at; skip if unchanged.
    let file_path = std::path::Path::new(&req.project_path)
        .join(".nectar")
        .join(&req.relative_path);
    let file_mtime = fs::metadata(&file_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let db_path = get_db_path(&req.project_path);
    
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    init_db(&conn).map_err(|e| format!("Failed to initialize database: {}", e))?;

    // Fast-path: if file hasn't been modified since last index, skip entirely.
    if file_mtime > 0 {
        let db_updated: Result<i64, _> = conn.query_row(
            "SELECT updated_at FROM memory_files WHERE id = ?",
            params![&req.relative_path],
            |row| row.get(0),
        );
        if let Ok(db_updated) = db_updated {
            if file_mtime <= db_updated {
                return Ok(NectarIndexFileResponse {
                    success: true,
                    chunks_indexed: 0,
                });
            }
        }
    }
    
    // Read the memory file
    let read_req = NectarReadMemoryFileRequest {
        project_path: req.project_path.clone(),
        relative_path: req.relative_path.clone(),
    };
    
    let memory_file = nectar_read_memory_file(read_req).await
        .map_err(|e| format!("Failed to read memory file: {}", e))?;
    
    // Parse to chunks
    let parse_req = NectarParseMarkdownToChunksRequest {
        content: memory_file.content.clone(),
    };
    
    let chunks_response = nectar_parse_markdown_to_chunks(parse_req).await
        .map_err(|e| format!("Failed to parse markdown: {}", e))?;
    
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    
    // Upsert the memory_files row BEFORE touching chunks — `chunks.source_file`
    // has a foreign key on `memory_files.id`, so inserting chunks first (the
    // previous order) fails with "FOREIGN KEY constraint failed" on every
    // first-time index of a file, which is every file on every fresh index.
    conn.execute(
        "INSERT OR REPLACE INTO memory_files (id, path, type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)",
        params![
            &req.relative_path,
            &req.relative_path,
            &memory_file.file_type,
            now,
            now,
        ],
    ).map_err(|e| format!("Failed to update memory file record: {}", e))?;

    // Delete existing chunks for this file
    conn.execute(
        "DELETE FROM chunks WHERE source_file = ?",
        params![&req.relative_path],
    ).map_err(|e| format!("Failed to delete old chunks: {}", e))?;

    // Insert new chunks with embeddings (AGENTS.md §4.3 — indexing pipeline)
    for (i, chunk) in chunks_response.chunks.iter().enumerate() {
        let chunk_id = format!("{}:{}:{}", req.relative_path, i, now);
        let embedding = embed_text(&chunk.text);
        let emb_blob = embedding_to_blob(&embedding);

        conn.execute(
            "INSERT INTO chunks (id, source_file, chunk_index, content, heading, embedding, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                &chunk_id,
                &req.relative_path,
                i as i32,
                &chunk.text,
                &chunk.heading,
                &emb_blob,
                now,
                now,
            ],
        ).map_err(|e| format!("Failed to insert chunk: {}", e))?;
    }
    
    // Refresh the FTS rows for just this file.
    conn.execute(
        "DELETE FROM chunks_fts WHERE source_file = ?",
        params![&req.relative_path],
    ).map_err(|e| format!("Failed to clear old FTS rows: {}", e))?;
    conn.execute(
        "INSERT INTO chunks_fts (content, source_file, heading, chunk_index)
         SELECT content, source_file, heading, chunk_index FROM chunks WHERE source_file = ?",
        params![&req.relative_path],
    ).map_err(|e| format!("Failed to rebuild FTS index: {}", e))?;
    
    Ok(NectarIndexFileResponse {
        success: true,
        chunks_indexed: chunks_response.chunks.len(),
    })
}

#[tauri::command]
async fn nectar_search(
    req: NectarSearchRequest,
) -> Result<NectarSearchResponse, String> {
    let db_path = get_db_path(&req.project_path);
    
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    
    init_db(&conn).map_err(|e| format!("Failed to initialize database: {}", e))?;
    
    let limit = req.limit.unwrap_or(10);
    let min_score = req.min_score.unwrap_or(0.0);
    let search_term = sanitize_fts5_query(&req.query);
    
    // AGENTS.md §4.2: hybrid retrieval — both signals, merged with RRF.
    // 1. Keyword signal via FTS5/BM25
    let keyword_results = fts5_keyword_search(&conn, &search_term, limit, min_score)
        .unwrap_or_default();
    
    // 2. Vector signal via char-n-gram embedding + cosine similarity
    let vector_results = vector_search(&conn, &search_term, limit, min_score)
        .unwrap_or_default();
    
    // 3. Merge with Reciprocal Rank Fusion
    let results = reciprocal_rank_fusion(vector_results, keyword_results, 60.0, limit);
    
    Ok(NectarSearchResponse { results })
}

// Simple token counter (approximate — 4 chars per token)
fn estimate_tokens(text: &str) -> usize {
    let len = text.len();
    if len == 0 { 0 } else { (len / 4) + 1 }
}

// Strip FTS5 metacharacters from user-supplied query text so we never crash on
// syntax errors.  FTS5 treats `"`, `(`, `)`, `*`, and leading `-` as operators
// — a git diff or a user prompt containing any of these will raise "unterminated
// string" or "syntax error" at the MATCH step if left raw.
fn sanitize_fts5_query(text: &str) -> String {
    let no_quotes = text.replace('"', " ");
    let no_parens = no_quotes.replace('(', " ").replace(')', " ");
    let no_star = no_parens.replace('*', " ");
    // Strip leading `-` from each token so FTS5 doesn't interpret them as NOT
    no_star
        .split_whitespace()
        .map(|w| w.trim_start_matches('-'))
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

// ── Vector embeddings (AGENTS.md §4.2 — hybrid retrieval) ──────────────

// Deterministic 384-dim character n-gram embedding. No external model, no
// network call — just a hash over (uni- bi- tri-)grams, L2-normalised.
// Combines with FTS5 via RRF for the hybrid search that AGENTS.md mandates.
const EMBED_DIMS: usize = 384;

fn embed_text(text: &str) -> Vec<f32> {
    let mut vec = vec![0.0f32; EMBED_DIMS];
    let chars: Vec<char> = text.chars().collect();

    // Trigram hits
    for w in chars.windows(3) {
        let idx = (w[0] as usize * 31 + w[1] as usize * 7 + w[2] as usize) % EMBED_DIMS;
        vec[idx] += 1.0;
    }
    // Bigram hits
    for w in chars.windows(2) {
        let idx = (w[0] as usize * 31 + w[1] as usize) % EMBED_DIMS;
        vec[idx] += 0.5;
    }
    // Unigram hits
    for &c in &chars {
        let idx = (c as usize) % EMBED_DIMS;
        vec[idx] += 0.25;
    }

    // L2-normalise so cosine similarity simplifies to dot product
    let norm: f32 = vec.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 0.0 {
        for v in &mut vec {
            *v /= norm;
        }
    }
    vec
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    // Both are L2-normalised → dot = cosine
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    dot.clamp(0.0, 1.0) as f64
}

fn embedding_to_blob(emb: &[f32]) -> Vec<u8> {
    emb.iter().flat_map(|f| f.to_le_bytes()).collect()
}

// ── Hybrid search (AGENTS.md §4.2) ─────────────────────────────────────

fn fts5_keyword_search(
    conn: &Connection,
    search_term: &str,
    limit: usize,
    min_score: f64,
) -> Result<Vec<SearchResult>, String> {
    if search_term.is_empty() {
        return Ok(Vec::new());
    }
    let query = format!(
        "SELECT content, source_file, heading, chunk_index, bm25(chunks_fts) as score \
         FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY score LIMIT ?"
    );
    let mut stmt = conn.prepare(&query)
        .map_err(|e| format!("Prepare FTS5: {}", e))?;
    let rows = stmt.query_map(params![&search_term, &(limit as i64)], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, i32>(3)?,
            row.get::<_, f64>(4)?,
        ))
    }).map_err(|e| format!("FTS5 query: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        let (content, source_file, heading, chunk_idx, raw_score) =
            row.map_err(|e| e.to_string())?;
        // BM25: 0 → 1.0 (perfect), 10 → 0.09 (poor)
        let normalized = 1.0 / (1.0 + raw_score);
        if normalized >= min_score {
            results.push(SearchResult {
                chunk: ChunkInfo {
                    text: content,
                    heading,
                    chunk_index: Some(chunk_idx as usize),
                },
                source_file,
                score: normalized,
            });
        }
    }
    Ok(results)
}

fn vector_search(
    conn: &Connection,
    query_text: &str,
    limit: usize,
    min_score: f64,
) -> Result<Vec<SearchResult>, String> {
    let query_emb = embed_text(query_text);

    let mut stmt = conn
        .prepare(
            "SELECT id, source_file, heading, chunk_index, content, embedding \
             FROM chunks WHERE embedding IS NOT NULL",
        )
        .map_err(|e| format!("Prepare vector search: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let blob: Vec<u8> = row.get(5)?;
            let emb: Vec<f32> = blob
                .chunks_exact(4)
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect();
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i32>(3)?,
                row.get::<_, String>(4)?,
                emb,
            ))
        })
        .map_err(|e| format!("Vector query: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        let (source_file, heading, chunk_idx, content, emb) =
            row.map_err(|e| e.to_string())?;
        let score = cosine_similarity(&query_emb, &emb);
        if score >= min_score {
            results.push(SearchResult {
                chunk: ChunkInfo {
                    text: content,
                    heading,
                    chunk_index: Some(chunk_idx as usize),
                },
                source_file,
                score,
            });
        }
    }

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
    results.truncate(limit);
    Ok(results)
}

/// Reciprocal Rank Fusion (RRF) — merge two ranked result lists using
/// k=60 (standard RRF constant).  Dedup by (source_file, chunk_index).
fn reciprocal_rank_fusion(
    mut vector_results: Vec<SearchResult>,
    mut keyword_results: Vec<SearchResult>,
    k: f64,
    limit: usize,
) -> Vec<SearchResult> {
    // Rank within each list (highest score → rank 1)
    vector_results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
    keyword_results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());

    let mut rrf_scores: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    let mut rrf_chunks: std::collections::HashMap<String, SearchResult> =
        std::collections::HashMap::new();

    let key_fn = |r: &SearchResult| -> String {
        format!(
            "{}:{}",
            r.source_file,
            r.chunk.chunk_index.unwrap_or(0)
        )
    };

    for (rank, result) in vector_results.iter().enumerate() {
        let key = key_fn(result);
        *rrf_scores.entry(key.clone()).or_insert(0.0) += 1.0 / (k + (rank + 1) as f64);
        rrf_chunks.entry(key).or_insert_with(|| result.clone());
    }
    for (rank, result) in keyword_results.iter().enumerate() {
        let key = key_fn(result);
        *rrf_scores.entry(key.clone()).or_insert(0.0) += 1.0 / (k + (rank + 1) as f64);
        rrf_chunks.entry(key).or_insert_with(|| result.clone());
    }

    let mut merged: Vec<SearchResult> = rrf_chunks
        .into_iter()
        .map(|(key, mut r)| {
            r.score = rrf_scores.remove(&key).unwrap_or(0.0);
            r
        })
        .collect();

    merged.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
    merged.truncate(limit);
    merged
}

#[tauri::command]
async fn nectar_inject(
    req: NectarInjectRequest,
) -> Result<NectarInjectResponse, String> {
    let max_tokens = req.max_tokens.unwrap_or(4000);
    let max_chunks = req.max_chunks.unwrap_or(20);
    let min_score = req.min_score.unwrap_or(0.0);
    
    // Build search query from task, open files, and git diff.
    // Sanitize each part for FTS5 so git-diff symbols (`@@`, `-`, `"`, etc.)
    // don't crash the query parser.
    let mut query_parts = vec![sanitize_fts5_query(&req.task)];
    for f in &req.open_files {
        query_parts.push(sanitize_fts5_query(f));
    }
    if let Some(diff) = &req.git_diff {
        query_parts.push(sanitize_fts5_query(diff));
    }
    let query = query_parts.join(" ");
    
    // Search for relevant chunks
    let search_req = NectarSearchRequest {
        project_path: req.project_path.clone(),
        query: query.clone(),
        limit: Some(max_chunks * 2), // Get more than needed, then filter by tokens
        min_score: Some(min_score),
    };
    
    let search_result = nectar_search(search_req).await?;
    
    // Filter chunks by token budget
    let mut selected_chunks = Vec::new();
    let mut total_tokens = 0;
    
    for result in search_result.results {
        let chunk_tokens = estimate_tokens(&result.chunk.text);
        if total_tokens + chunk_tokens <= max_tokens {
            selected_chunks.push(InjectedChunk {
                content: result.chunk.text,
                source_file: result.source_file,
                score: result.score,
            });
            total_tokens += chunk_tokens;
        }
        if selected_chunks.len() >= max_chunks {
            break;
        }
    }
    
    Ok(NectarInjectResponse {
        chunks: selected_chunks,
        query,
        total_tokens,
    })
}

#[tauri::command]
async fn nectar_format_context(
    req: NectarFormatContextRequest,
) -> Result<NectarFormatContextResponse, String> {
    if req.chunks.is_empty() {
        return Ok(NectarFormatContextResponse {
            formatted_text: String::new(),
        });
    }
    
    let formatted = match req.agent_type.as_str() {
        "claude" => {
            format!(
                "<context>\n{}\n</context>",
                req.chunks
                    .iter()
                    .enumerate()
                    .map(|(i, c)| format!(
                        "### Context {} (score: {:.3})\nSource: {}\n\n{}",
                        i + 1,
                        c.score,
                        c.source_file,
                        c.content
                    ))
                    .collect::<Vec<_>>()
                    .join("\n\n---\n\n")
            )
        }
        "codex" | "aider" | "agy" | "opencode" | "kimi" | "cline" | "cursor" | "kiro" | "kilo" => {
            format!(
                "Context:\n{}",
                req.chunks
                    .iter()
                    .enumerate()
                    .map(|(i, c)| format!(
                        "[{}] {} (score: {:.3})\n{}",
                        i + 1,
                        c.source_file,
                        c.score,
                        c.content
                    ))
                    .collect::<Vec<_>>()
                    .join("\n\n")
            )
        }
        _ => {
            // Default format
            format!(
                "{}",
                req.chunks
                    .iter()
                    .map(|c| format!("{}\n{}", c.source_file, c.content))
                    .collect::<Vec<_>>()
                    .join("\n\n---\n\n")
            )
        }
    };
    
    Ok(NectarFormatContextResponse {
        formatted_text: formatted,
    })
}

#[tauri::command]
async fn nectar_log_session(
    req: NectarLogSessionRequest,
) -> Result<NectarLogSessionResponse, String> {
    let log_content = format!(
        "# Session Started\n\nAgent: {}\nTask: {}\nQuery: {}\nInjection: {} chunks retrieved\nTotal tokens: {}\n\n## Retrieved Chunks\n\n{}\n",
        req.agent_type,
        req.task,
        req.query,
        req.chunks.len(),
        req.total_tokens,
        req.chunks
            .iter()
            .enumerate()
            .map(|(i, c)| format!(
                "{}. {} (score: {:.3})\n{}",
                i + 1,
                c.source_file,
                c.score,
                c.content
            ))
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    
    let now_millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let mut frontmatter = serde_json::json!({
        "agent": req.agent_type,
        "timestamp": now_millis,
    });
    // Store optional fields in frontmatter so nectar_list_sessions can read them
    // without parsing the full markdown body.
    if let Some(title) = &req.title {
        frontmatter["title"] = serde_json::json!(title);
    } else {
        frontmatter["title"] = serde_json::json!(&req.task);
    }
    if let Some(branch) = &req.branch {
        frontmatter["branch"] = serde_json::json!(branch);
    }
    if let Some(worktree_id) = &req.worktree_id {
        frontmatter["worktree_id"] = serde_json::json!(worktree_id);
    }
    if let Some(message_count) = req.message_count {
        frontmatter["message_count"] = serde_json::json!(message_count);
    }
    frontmatter["total_tokens"] = serde_json::json!(req.total_tokens);
    
    let write_req = NectarWriteMemoryFileRequest {
        project_path: req.project_path.clone(),
        relative_path: format!("agents/sessions/{}.md", req.session_id),
        content: log_content,
        frontmatter: Some(frontmatter),
    };
    
    nectar_write_memory_file(write_req).await?;
    
    Ok(NectarLogSessionResponse {
        success: true,
        log_path: format!("agents/sessions/{}.md", req.session_id),
    })
}

#[tauri::command]
async fn nectar_list_sessions(
    req: NectarListSessionsRequest,
) -> Result<NectarListSessionsResponse, String> {
    let sessions_dir = std::path::Path::new(&req.project_path)
        .join(".nectar")
        .join("agents")
        .join("sessions");

    let mut sessions = Vec::new();

    if !sessions_dir.exists() {
        return Ok(NectarListSessionsResponse { sessions });
    }

    let entries = fs::read_dir(&sessions_dir)
        .map_err(|e| format!("Failed to read sessions directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path.extension().unwrap_or_default().to_string_lossy().to_string();
        if ext != "md" {
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Parse frontmatter
        let (frontmatter, body) = if content.starts_with("---") {
            let parts: Vec<&str> = content.splitn(3, "---").collect();
            if parts.len() >= 3 {
                (serde_yaml::from_str::<serde_json::Value>(parts[1]).ok(), Some(parts[2]))
            } else {
                (None, None)
            }
        } else {
            (None, Some(content.as_str()))
        };

        let file_stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();

        let agent_type = frontmatter
            .as_ref()
            .and_then(|fm| fm.get("agent").and_then(|v| v.as_str()))
            .unwrap_or("unknown")
            .to_string();

        let title = frontmatter
            .as_ref()
            .and_then(|fm| fm.get("title").and_then(|v| v.as_str()))
            .unwrap_or(&file_stem)
            .to_string();

        let branch = frontmatter
            .as_ref()
            .and_then(|fm| fm.get("branch").and_then(|v| v.as_str()))
            .map(|s| s.to_string());

        let worktree_id = frontmatter
            .as_ref()
            .and_then(|fm| fm.get("worktree_id").and_then(|v| v.as_str()))
            .map(|s| s.to_string());

        let message_count = frontmatter
            .as_ref()
            .and_then(|fm| fm.get("message_count").and_then(|v| v.as_i64()));

        let total_tokens = frontmatter
            .as_ref()
            .and_then(|fm| fm.get("total_tokens").and_then(|v| v.as_i64()));

        let timestamp = frontmatter
            .as_ref()
            .and_then(|fm| fm.get("timestamp").and_then(|v| v.as_i64()));

        // Extract preview from body: first non-empty line after the heading
        let preview = body.and_then(|b| {
            b.lines()
                .skip(1)
                .find(|l| !l.trim().is_empty() && !l.starts_with('#'))
                .map(|l| l.trim().to_string())
        });

        let session_entry = NectarSessionEntry {
            id: file_stem,
            agent_type,
            title,
            branch,
            worktree_id,
            message_count,
            total_tokens,
            timestamp,
            preview,
        };

        sessions.push(session_entry);
    }

    // Sort by timestamp descending (newest first)
    sessions.sort_by(|a, b| b.timestamp.unwrap_or(0).cmp(&a.timestamp.unwrap_or(0)));

    // Apply scope filter
    if req.scope == "worktree" {
        if let Some(ref wt_id) = req.worktree_id {
            sessions.retain(|s| s.worktree_id.as_deref() == Some(wt_id.as_str()));
        } else {
            // If no worktree_id provided, filter to sessions without a worktree_id
            // (backward compatibility with old sessions)
            sessions.retain(|s| s.worktree_id.is_none());
        }
    }

    // Apply text filter
    if let Some(ref filter_text) = req.filter {
        if !filter_text.is_empty() {
            let lower = filter_text.to_lowercase();
            sessions.retain(|s| {
                s.title.to_lowercase().contains(&lower)
                    || s.agent_type.to_lowercase().contains(&lower)
                    || s.preview.as_deref().unwrap_or("").to_lowercase().contains(&lower)
            });
        }
    }

    Ok(NectarListSessionsResponse { sessions })
}

#[tauri::command]
async fn nectar_close(
    _req: NectarCloseRequest,
) -> Result<NectarCloseResponse, String> {
    // For now, this is a no-op since we open/close connections per command
    // In the future, we might want to maintain a connection pool
    Ok(NectarCloseResponse { success: true })
}

// ── CDP browser ─────────────────────────────────────────────────
// The Tauri webview can't be screenshotted, so the browser pane drives a real
// Chromium over the Chrome DevTools Protocol instead. We reuse an already
// installed browser (Edge ships with Windows) rather than bundling one.

struct BrowserState {
    child: Mutex<Option<std::process::Child>>,
    /// Profile dir of the running instance, removed on stop.
    profile: Mutex<Option<PathBuf>>,
}

/// Kill the whole browser process tree.
///
/// Chromium spawns helper processes and holds a `SingletonLock` in its profile.
/// Killing only the parent leaves those alive, so the next launch dies with
/// exit code 21 (PROFILE_IN_USE).
fn kill_tree(child: &mut std::process::Child) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .output();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn find_chromium() -> Option<String> {
    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &[
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ]
    } else if cfg!(target_os = "macos") {
        &[
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
    } else {
        &["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"]
    };
    candidates.iter().find(|p| Path::new(p).exists()).map(|p| p.to_string())
}

/// Launch a headless Chromium with CDP enabled. Returns the debugging port.
/// Idempotent: if one is already running, the existing port is reused.
#[tauri::command]
async fn launch_cdp_browser(port: u16, state: State<'_, BrowserState>) -> Result<u16, String> {
    {
        let mut guard = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(child) = guard.as_mut() {
            // Still alive? Reuse it.
            match child.try_wait() {
                Ok(None) => return Ok(port),
                _ => { *guard = None; }
            }
        }
    }

    // Something already serving CDP on this port (an orphan from a previous run,
    // or a browser we lost the handle to during a reload) — reuse it instead of
    // starting a second instance that would just fight over the port.
    if http_get_body(port, "/json/version").is_ok() {
        return Ok(port);
    }

    let exe = find_chromium()
        .ok_or_else(|| "No Chromium-based browser found (install Microsoft Edge or Google Chrome)".to_string())?;

    // Fresh profile per launch. A fixed dir means a stale SingletonLock from a
    // killed instance makes every future launch exit 21 (PROFILE_IN_USE).
    let profile = std::env::temp_dir().join(format!(
        "hiveory-cdp-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));

    let child = std::process::Command::new(&exe)
        .arg(format!("--remote-debugging-port={}", port))
        .arg(format!("--user-data-dir={}", profile.to_string_lossy()))
        .arg("--remote-allow-origins=*")
        .arg("--headless=new")
        .arg("--hide-scrollbars")
        .arg("--mute-audio")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-features=Translate,MediaRouter")
        .arg("--disable-backgrounding-occluded-windows")
        .arg("--disable-renderer-backgrounding")
        .arg("about:blank")
        .spawn()
        .map_err(|e| format!("Failed to launch browser: {e}"))?;

    *state.child.lock().map_err(|e| e.to_string())? = Some(child);
    *state.profile.lock().map_err(|e| e.to_string())? = Some(profile);
    Ok(port)
}

/// One-shot HTTP/1.1 GET over a raw socket, returning the response body.
///
/// Deliberately not done from the renderer with fetch(): Chromium's DevTools
/// HTTP endpoint sends no CORS headers, so the browser blocks that request. From
/// Rust there is no origin and no CORS. No HTTP crate needed for one GET.
fn http_get_body(port: u16, path: &str) -> Result<String, String> {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|e| e.to_string())?;
    let req = format!(
        "GET {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        path, port
    );
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;

    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&raw);
    // Split headers from body.
    match text.find("\r\n\r\n") {
        Some(i) => Ok(text[i + 4..].to_string()),
        None => Err("malformed HTTP response from browser".to_string()),
    }
}

/// Resolve the browser's CDP websocket endpoint, waiting while it boots.
/// Returns the `ws://` URL the renderer connects to (websockets ignore CORS).
#[tauri::command]
async fn cdp_ws_url(port: u16, state: State<'_, BrowserState>) -> Result<String, String> {
    let mut last_err = String::from("browser did not start");

    for _ in 0..50 {
        // Bail early with a useful reason if the process already died.
        {
            let mut guard = state.child.lock().map_err(|e| e.to_string())?;
            if let Some(child) = guard.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    *guard = None;
                    return Err(format!(
                        "browser exited early (status {status}). Close any running Edge/Chrome started with --remote-debugging-port, or try again."
                    ));
                }
            }
        }

        match http_get_body(port, "/json/version") {
            Ok(body) => match serde_json::from_str::<serde_json::Value>(&body) {
                Ok(json) => {
                    if let Some(url) = json.get("webSocketDebuggerUrl").and_then(|v| v.as_str()) {
                        return Ok(url.to_string());
                    }
                    last_err = "browser response had no webSocketDebuggerUrl".to_string();
                }
                Err(e) => last_err = format!("bad JSON from browser: {e}"),
            },
            Err(e) => last_err = e,
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    Err(format!("could not reach the browser on port {port}: {last_err}"))
}

#[tauri::command]
async fn stop_cdp_browser(state: State<'_, BrowserState>) -> Result<(), String> {
    if let Some(mut child) = state.child.lock().map_err(|e| e.to_string())?.take() {
        kill_tree(&mut child);
    }
    // Best-effort: drop the throwaway profile so temp doesn't fill up with them.
    if let Some(dir) = state.profile.lock().map_err(|e| e.to_string())?.take() {
        let _ = fs::remove_dir_all(dir);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_system = PtySystem {
        sessions: Mutex::new(HashMap::new()),
    };

    tauri::Builder::default()
        .manage(pty_system)
        .manage(BrowserState { child: Mutex::new(None), profile: Mutex::new(None) })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            spawn_terminal,
            write_to_terminal,
            read_from_terminal,
            resize_terminal,
            kill_terminal,
            is_process_alive,
            read_file,
            write_file,
            list_directory,
            get_project_path,
            get_home_dir,
            ensure_nectar_structure,
            nectar_ensure_structure,
            nectar_read_memory_file,
            nectar_write_memory_file,
            nectar_list_memory_files,
            nectar_parse_markdown_to_chunks,
            nectar_index_file,
            nectar_search,
            nectar_inject,
            nectar_format_context,
            nectar_log_session,
            nectar_list_sessions,
            nectar_close,
            git_status,
            detect_shells,
            create_worktree,
            merge_worktree,
            remove_worktree,
            get_nectar_mcp_path,
            ensure_dir,
            run_command,
            launch_cdp_browser,
            cdp_ws_url,
            stop_cdp_browser
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
