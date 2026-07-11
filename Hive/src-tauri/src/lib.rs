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

#[derive(Debug, Serialize, Deserialize)]
pub struct ChunkInfo {
    pub text: String,
    pub heading: Option<String>,
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

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Serialize, Deserialize)]
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

    // 2. agents/handoffs.md — always include if it exists (carries what the last agent left)
    let handoffs_path = nectar_base.join("agents").join("handoffs.md");
    if handoffs_path.exists() {
        files.push("agents/handoffs.md".to_string());
    }

    // 3. The 5 most-recent session files so new agents know what just happened
    let sessions_path = nectar_base.join("agents").join("sessions");
    if sessions_path.exists() {
        let mut session_entries: Vec<_> = fs::read_dir(&sessions_path)
            .map_err(|e| format!("Failed to read sessions dir: {}", e))?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map_or(false, |ext| ext == "md"))
            .collect();

        // Sort by modification time, newest first
        session_entries.sort_by_key(|e| {
            e.metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        });
        session_entries.reverse();

        for entry in session_entries.iter().take(5) {
            if let Some(name_str) = entry.path().file_name().and_then(|n| n.to_str()) {
                files.push(format!("agents/sessions/{}", name_str));
            }
        }
    }

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
        });
    }
    
    Ok(NectarParseMarkdownToChunksResponse { chunks })
}

fn get_db_path(project_path: &str) -> PathBuf {
    Path::new(project_path).join(".nectar").join("nectar.db")
}

fn init_db(conn: &Connection) -> Result<(), rusqlite::Error> {
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
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (source_file) REFERENCES memory_files(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Create FTS5 table for keyword search
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            content,
            source_file,
            heading,
            content_rowid
        )",
        [],
    )?;

    Ok(())
}

#[tauri::command]
async fn nectar_index_file(
    req: NectarIndexFileRequest,
) -> Result<NectarIndexFileResponse, String> {
    let db_path = get_db_path(&req.project_path);
    
    // Create database if it doesn't exist
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    
    init_db(&conn).map_err(|e| format!("Failed to initialize database: {}", e))?;
    
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

    // Insert new chunks
    for (i, chunk) in chunks_response.chunks.iter().enumerate() {
        let chunk_id = format!("{}:{}:{}", req.relative_path, i, now);

        conn.execute(
            "INSERT INTO chunks (id, source_file, chunk_index, content, heading, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                &chunk_id,
                &req.relative_path,
                i as i32,
                &chunk.text,
                &chunk.heading,
                now,
                now,
            ],
        ).map_err(|e| format!("Failed to insert chunk: {}", e))?;
    }
    
    // Refresh the FTS rows for just this file. Rebuilding from the WHOLE
    // `chunks` table (the previous behavior) without clearing first means
    // every later call re-inserts rowids already indexed by an earlier
    // call for a DIFFERENT file, which SQLite rejects as a duplicate rowid
    // — this started surfacing once every WorkerBee spawn began indexing
    // all memory files, since the second WorkerBee's pass would collide
    // with rows the first pass already added.
    conn.execute(
        "DELETE FROM chunks_fts WHERE source_file = ?",
        params![&req.relative_path],
    ).map_err(|e| format!("Failed to clear old FTS rows: {}", e))?;
    conn.execute(
        "INSERT INTO chunks_fts (content, source_file, heading)
         SELECT content, source_file, heading FROM chunks WHERE source_file = ?",
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
    
    // Simple keyword search using FTS5
    let query = format!("SELECT content, source_file, heading, bm25(chunks_fts) as score FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY score LIMIT {}", limit);
    
    let mut stmt = conn.prepare(&query)
        .map_err(|e| format!("Failed to prepare search: {}", e))?;
    
    let search_term = req.query.replace('"', "\"\""); // Escape quotes
    let mut results = Vec::new();
    
    let rows = stmt.query_map([&search_term], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, f64>(3)?,
        ))
    }).map_err(|e| format!("Failed to execute search: {}", e))?;
    
    for row in rows {
        let (content, source_file, heading, score) = row.map_err(|e| e.to_string())?;
        
        // Convert BM25 score to a 0-1 range (BM25 is typically 0-10, lower is better)
        let normalized_score = 1.0 - (1.0 / (1.0 + score.abs()));
        
        if normalized_score >= min_score {
            results.push(SearchResult {
                chunk: ChunkInfo {
                    text: content,
                    heading,
                },
                source_file,
                score: normalized_score,
            });
        }
    }
    
    Ok(NectarSearchResponse { results })
}

// Simple token counter (approximate - 4 chars per token)
fn estimate_tokens(text: &str) -> usize {
    (text.len() / 4) + 1
}

#[tauri::command]
async fn nectar_inject(
    req: NectarInjectRequest,
) -> Result<NectarInjectResponse, String> {
    let max_tokens = req.max_tokens.unwrap_or(4000);
    let max_chunks = req.max_chunks.unwrap_or(20);
    let min_score = req.min_score.unwrap_or(0.0);
    
    // Build search query from task, open files, and git diff
    let mut query_parts = vec![req.task.clone()];
    query_parts.extend(req.open_files.clone());
    if let Some(diff) = &req.git_diff {
        query_parts.push(diff.clone());
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
    
    let write_req = NectarWriteMemoryFileRequest {
        project_path: req.project_path.clone(),
        relative_path: format!("agents/sessions/{}.md", req.session_id),
        content: log_content,
        frontmatter: Some(serde_json::json!({
            "agent": req.agent_type,
            "timestamp": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64
        })),
    };
    
    nectar_write_memory_file(write_req).await?;
    
    Ok(NectarLogSessionResponse {
        success: true,
        log_path: format!("agents/sessions/{}.md", req.session_id),
    })
}

#[tauri::command]
async fn nectar_close(
    _req: NectarCloseRequest,
) -> Result<NectarCloseResponse, String> {
    // For now, this is a no-op since we open/close connections per command
    // In the future, we might want to maintain a connection pool
    Ok(NectarCloseResponse { success: true })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_system = PtySystem {
        sessions: Mutex::new(HashMap::new()),
    };

    tauri::Builder::default()
        .manage(pty_system)
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
            nectar_close,
            git_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
