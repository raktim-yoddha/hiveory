use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
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
    state: State<'_, PtySystem>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    
    // Clean the command string - remove any null bytes
    let command = command.trim().replace('\0', "");
    
    // Check if this is a CLI agent (not a shell). v1 supports Claude Code,
    // Codex CLI, Aider, and Gemini CLI (AGENTS.md §5) — matched against the
    // actual executable names, not marketing/product names.
    let is_shell = matches!(
        command.as_str(),
        "cmd.exe" | "powershell.exe" | "bash.exe" | "wsl.exe"
    );
    let is_cli_agent = !is_shell;
    
    let mut cmd = if is_cli_agent {
        // For CLI agents on Windows, use cmd.exe to invoke them
        // Use /K to keep the command prompt open after execution
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.arg("/K");
        cmd.arg(&command);
        cmd
    } else {
        // For shells, use the command directly
        CommandBuilder::new(&command)
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

    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // Spawn the child, then drop the slave so the master sees EOF when the child exits.
    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;
    drop(pty_pair.slave);

    let writer = pty_pair.master.take_writer().map_err(|e| e.to_string())?;
    let reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;

    // Background thread drains the pty into a shared buffer so reads never block
    // the async command handler (portable-pty readers are blocking).
    let output = Arc::new(Mutex::new(String::new()));
    let output_writer = output.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    if let Ok(mut buf) = output_writer.lock() {
                        buf.push_str(&String::from_utf8_lossy(&buffer[..n]));
                    }
                }
                Err(_) => break,
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
async fn ensure_nectar_structure(project_path: String) -> Result<(), String> {
    let nectar_path = std::path::Path::new(&project_path).join(".nectar");
    let dirs = [
        nectar_path.join("memory"),
        nectar_path.join("agents").join("sessions"),
        nectar_path.join("agents").join("summaries"),
        nectar_path.join("tasks"),
        nectar_path.join("index"),
    ];

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
        }
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            spawn_terminal,
            write_to_terminal,
            read_from_terminal,
            resize_terminal,
            kill_terminal,
            read_file,
            write_file,
            list_directory,
            get_project_path,
            get_home_dir,
            ensure_nectar_structure,
            git_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
