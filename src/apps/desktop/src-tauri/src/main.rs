#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    if hiveory_app_host::run_plugin_bridge_if_requested() {
        return;
    }
    if hiveory_app_host::run_terminal_host_if_requested() {
        return;
    }
    hiveory_app_host::run()
}
