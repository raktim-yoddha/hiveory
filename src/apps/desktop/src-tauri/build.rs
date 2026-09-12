fn main() {
    println!("cargo:rerun-if-env-changed=HIVEORY_EDITION");
    tauri_build::build()
}
