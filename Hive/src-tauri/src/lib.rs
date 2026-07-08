use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct TerminalOutput {
    pub pane_id: String,
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TerminalInput {
    pub pane_id: String,
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_file: bool,
    pub is_dir: bool,
}

struct PtySystem {
    ptys: Mutex<HashMap<String, Arc<Mutex<portable_pty::PtyPair>>>>,
}

#[tauri::command]
async fn spawn_terminal(
    pane_id: String,
    command: String,
    args: Vec<String>,
    working_dir: Option<String>,
    state: State<'_, PtySystem>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    
    // Check command type before moving it
    let is_cmd = command.contains("cmd.exe");
    let is_powershell = command.contains("powershell.exe");
    let is_bash_or_wsl = command.contains("bash.exe") || command.contains("wsl.exe");
    
    let mut cmd = CommandBuilder::new(command);
    
    // Set working directory by prepending cd command for shell
    if let Some(dir) = working_dir {
        if let Ok(path) = PathBuf::from(&dir).canonicalize() {
            if path.exists() {
                let path_str = path.to_string_lossy().to_string();
                // For Windows shells, we need to change directory differently
                if is_cmd {
                    cmd.arg("/k");
                    cmd.arg(&format!("cd /d \"{}\"", path_str));
                } else if is_powershell {
                    cmd.arg("-NoExit");
                    cmd.arg("-Command");
                    cmd.arg(&format!("Set-Location '{}';", path_str));
                } else if is_bash_or_wsl {
                    cmd.arg("-c");
                    cmd.arg(&format!("cd \"{}\" && exec $SHELL", path_str));
                }
            }
        }
    }
    
    for arg in args {
        cmd.arg(&arg);
    }
    
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    
    let _child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;
    
    let mut ptys = state.ptys.lock().unwrap();
    ptys.insert(pane_id.clone(), Arc::new(Mutex::new(pty_pair)));
    
    Ok(pane_id)
}

#[tauri::command]
async fn write_to_terminal(
    input: TerminalInput,
    state: State<'_, PtySystem>,
) -> Result<(), String> {
    let ptys = state.ptys.lock().unwrap();
    if let Some(pty_pair) = ptys.get(&input.pane_id) {
        let pty = pty_pair.lock().unwrap();
        let mut writer = pty.master.take_writer().map_err(|e| e.to_string())?;
        writer
            .write_all(input.data.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn read_from_terminal(
    pane_id: String,
    state: State<'_, PtySystem>,
) -> Result<String, String> {
    let ptys = state.ptys.lock().unwrap();
    if let Some(pty_pair) = ptys.get(&pane_id) {
        let pty = pty_pair.lock().unwrap();
        let mut reader = pty.master.try_clone_reader().map_err(|e| e.to_string())?;
        let mut output = String::new();
        let mut buffer = [0u8; 4096];
        
        // Non-blocking read with timeout
        let start = std::time::Instant::now();
        while start.elapsed() < std::time::Duration::from_millis(100) {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    output.push_str(&String::from_utf8_lossy(&buffer[..n]));
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                    continue;
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(output)
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
    let ptys = state.ptys.lock().unwrap();
    if let Some(pty_pair) = ptys.get(&pane_id) {
        let pty = pty_pair.lock().unwrap();
        pty.master
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
        ptys: Mutex::new(HashMap::new()),
    };

    tauri::Builder::default()
        .manage(pty_system)
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            spawn_terminal,
            write_to_terminal,
            read_from_terminal,
            resize_terminal,
            read_file,
            write_file,
            list_directory,
            get_project_path,
            get_home_dir,
            ensure_nectar_structure
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
