use agentic_super_app_protocol::{
    current_protocol_version, ApplicationMode, BootstrapSnapshot, BuildInformation,
    SetActiveModeCommand,
};
use std::sync::RwLock;
use tauri::State;

struct AgenticSuperAppShellState {
    active_mode: RwLock<ApplicationMode>,
}

impl Default for AgenticSuperAppShellState {
    fn default() -> Self {
        Self {
            active_mode: RwLock::new(ApplicationMode::Agent),
        }
    }
}

#[tauri::command]
fn agentic_super_app_query_bootstrap(
    state: State<'_, AgenticSuperAppShellState>,
) -> Result<BootstrapSnapshot, String> {
    let active_mode = *state
        .active_mode
        .read()
        .map_err(|_| "shell state is unavailable")?;
    Ok(BootstrapSnapshot {
        protocol: current_protocol_version(),
        active_mode,
        product_name: "Agentic Super App".to_owned(),
    })
}

#[tauri::command]
fn agentic_super_app_command_set_active_mode(
    command: SetActiveModeCommand,
    state: State<'_, AgenticSuperAppShellState>,
) -> Result<BootstrapSnapshot, String> {
    let mut active_mode = state
        .active_mode
        .write()
        .map_err(|_| "shell state is unavailable")?;
    *active_mode = command.mode;
    Ok(BootstrapSnapshot {
        protocol: current_protocol_version(),
        active_mode: *active_mode,
        product_name: "Agentic Super App".to_owned(),
    })
}

#[tauri::command]
fn agentic_super_app_query_build_information() -> BuildInformation {
    BuildInformation {
        product_name: "Agentic Super App".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        protocol: current_protocol_version(),
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(AgenticSuperAppShellState::default())
        .invoke_handler(tauri::generate_handler![
            agentic_super_app_query_bootstrap,
            agentic_super_app_command_set_active_mode,
            agentic_super_app_query_build_information
        ])
        .run(tauri::generate_context!())
        .expect("error while running Agentic Super App");
}
