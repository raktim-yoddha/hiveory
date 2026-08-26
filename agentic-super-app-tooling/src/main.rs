use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("tooling lives at workspace root")
        .to_path_buf();
    let output =
        workspace_root.join("agentic-super-app-renderer/src/generated/agentic-super-app-protocol");
    agentic_super_app_protocol::export_typescript_bindings(&output)?;
    println!("wrote {}", output.display());
    Ok(())
}
