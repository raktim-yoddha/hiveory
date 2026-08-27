use agentic_super_app_artifact_store::AgenticSuperAppArtifactStore;
use agentic_super_app_persistence::AgenticSuperAppPersistence;
use agentic_super_app_protocol::BackupSummary;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use uuid::Uuid;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const BACKUP_FORMAT_VERSION: u16 = 1;
const DATABASE_ENTRY: &str = "database.sqlite3";
const ARTIFACTS_PREFIX: &str = "artifacts/";
const PENDING_RESTORE_NAME: &str = "agentic-super-app-pending-restore.zip";
const MAX_BACKUP_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_BACKUP_ENTRIES: usize = 100_000;

#[derive(Debug, Error)]
pub enum AgenticSuperAppReleaseError {
    #[error("release file operation failed: {0}")]
    Io(#[from] io::Error),
    #[error("release archive operation failed: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("release metadata is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("backup is invalid: {0}")]
    InvalidBackup(String),
    #[error("backup exceeds the local safety limit")]
    TooLarge,
    #[error("database backup failed: {0}")]
    Database(#[from] sqlx::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgenticSuperAppBackupManifest {
    format_version: u16,
    product_version: String,
    protocol_major: u16,
    created_at_unix_ms: i64,
    includes_database: bool,
    artifact_count: u64,
}

pub async fn create_backup(
    persistence: &AgenticSuperAppPersistence,
    artifacts: &AgenticSuperAppArtifactStore,
    destination: &Path,
    product_version: &str,
    protocol_major: u16,
) -> Result<BackupSummary, AgenticSuperAppReleaseError> {
    if destination.as_os_str().is_empty() || destination.exists() {
        return Err(AgenticSuperAppReleaseError::InvalidBackup(
            "choose a new backup destination".to_owned(),
        ));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let artifact_files = collect_artifacts(artifacts.root())?;
    let artifact_count = artifact_files.len() as u64;
    let temporary_database = destination.with_file_name(format!(
        ".agentic-super-app-backup-{}.sqlite3",
        Uuid::now_v7()
    ));
    if let Err(error) = persistence.backup_sqlite(&temporary_database).await {
        let _ = fs::remove_file(&temporary_database);
        return Err(error.into());
    }
    if fs::metadata(&temporary_database)?.len() > MAX_BACKUP_BYTES {
        let _ = fs::remove_file(&temporary_database);
        return Err(AgenticSuperAppReleaseError::TooLarge);
    }
    let created_at_unix_ms = now_ms();
    let manifest = AgenticSuperAppBackupManifest {
        format_version: BACKUP_FORMAT_VERSION,
        product_version: product_version.to_owned(),
        protocol_major,
        created_at_unix_ms,
        includes_database: true,
        artifact_count,
    };
    let temporary_archive =
        destination.with_file_name(format!(".agentic-super-app-backup-{}.part", Uuid::now_v7()));
    let result = write_archive(
        &temporary_archive,
        &temporary_database,
        artifacts.root(),
        &artifact_files,
        &manifest,
    );
    let _ = fs::remove_file(&temporary_database);
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary_archive);
        return Err(error);
    }
    if let Err(error) = fs::rename(&temporary_archive, destination) {
        let _ = fs::remove_file(&temporary_archive);
        return Err(error.into());
    }
    persistence.record_backup().await?;
    let bytes = fs::metadata(destination)?.len();
    Ok(BackupSummary {
        path: destination.to_string_lossy().into_owned(),
        bytes,
        created_at_unix_ms,
        includes_database: true,
        artifact_count,
    })
}

pub fn prepare_restore(
    source: &Path,
    app_data_dir: &Path,
) -> Result<PathBuf, AgenticSuperAppReleaseError> {
    validate_source(source)?;
    let manifest = read_manifest(source)?;
    validate_manifest(&manifest)?;
    let pending = app_data_dir.join(PENDING_RESTORE_NAME);
    if source != pending {
        fs::create_dir_all(app_data_dir)?;
        let temporary = pending.with_file_name(format!(
            ".agentic-super-app-restore-{}.part",
            Uuid::now_v7()
        ));
        fs::copy(source, &temporary)?;
        fs::rename(&temporary, &pending)?;
    }
    Ok(pending)
}

pub fn apply_pending_restore(
    app_data_dir: &Path,
    database_path: &Path,
    artifact_root: &Path,
) -> Result<bool, AgenticSuperAppReleaseError> {
    let pending = app_data_dir.join(PENDING_RESTORE_NAME);
    if !pending.exists() {
        return Ok(false);
    }
    validate_source(&pending)?;
    let manifest = read_manifest(&pending)?;
    validate_manifest(&manifest)?;
    let staging = app_data_dir.join(format!(".agentic-super-app-restore-{}", Uuid::now_v7()));
    fs::create_dir_all(&staging)?;
    let result = extract_archive(&pending, &staging);
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let staged_database = staging.join(DATABASE_ENTRY);
    if !staged_database.is_file() {
        let _ = fs::remove_dir_all(&staging);
        return Err(AgenticSuperAppReleaseError::InvalidBackup(
            "archive does not contain a database snapshot".to_owned(),
        ));
    }
    let previous_database = database_path.with_file_name(format!(
        "{}.pre-restore-{}",
        database_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("database.sqlite3"),
        Uuid::now_v7()
    ));
    let moved_database_files = move_database_family(database_path, &previous_database)?;
    if let Err(error) = fs::rename(&staged_database, database_path) {
        restore_database_family(database_path, &previous_database, &moved_database_files);
        let _ = fs::remove_dir_all(&staging);
        return Err(error.into());
    }

    let staged_artifacts = staging.join(ARTIFACTS_PREFIX.trim_end_matches('/'));
    if staged_artifacts.exists() {
        let previous_artifacts = artifact_root.with_file_name(format!(
            "{}.pre-restore-{}",
            artifact_root
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("artifacts"),
            Uuid::now_v7()
        ));
        if artifact_root.exists() {
            if let Err(error) = fs::rename(artifact_root, &previous_artifacts) {
                rollback_database_restore(database_path, &previous_database, &moved_database_files);
                let _ = fs::remove_dir_all(&staging);
                return Err(error.into());
            }
        }
        if let Err(error) = fs::rename(&staged_artifacts, artifact_root) {
            if artifact_root.exists() {
                let _ = fs::remove_dir_all(artifact_root);
            }
            let _ = fs::rename(&previous_artifacts, artifact_root);
            rollback_database_restore(database_path, &previous_database, &moved_database_files);
            let _ = fs::remove_dir_all(&staging);
            return Err(error.into());
        }
    }
    fs::remove_file(&pending)?;
    fs::remove_dir_all(&staging)?;
    Ok(true)
}

fn validate_source(source: &Path) -> Result<(), AgenticSuperAppReleaseError> {
    let metadata = fs::symlink_metadata(source)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(AgenticSuperAppReleaseError::InvalidBackup(
            "backup must be a regular file".to_owned(),
        ));
    }
    if metadata.len() > MAX_BACKUP_BYTES {
        return Err(AgenticSuperAppReleaseError::TooLarge);
    }
    Ok(())
}

fn read_manifest(
    source: &Path,
) -> Result<AgenticSuperAppBackupManifest, AgenticSuperAppReleaseError> {
    let file = File::open(source)?;
    let mut archive = ZipArchive::new(file)?;
    let mut manifest_file = archive.by_name("manifest.json").map_err(|_| {
        AgenticSuperAppReleaseError::InvalidBackup("manifest is missing".to_owned())
    })?;
    if manifest_file.size() > 64 * 1024 {
        return Err(AgenticSuperAppReleaseError::TooLarge);
    }
    let mut manifest_json = String::new();
    manifest_file.read_to_string(&mut manifest_json)?;
    Ok(serde_json::from_str(&manifest_json)?)
}

fn validate_manifest(
    manifest: &AgenticSuperAppBackupManifest,
) -> Result<(), AgenticSuperAppReleaseError> {
    if manifest.format_version != BACKUP_FORMAT_VERSION || !manifest.includes_database {
        return Err(AgenticSuperAppReleaseError::InvalidBackup(
            "backup format is not supported".to_owned(),
        ));
    }
    if manifest.artifact_count as usize > MAX_BACKUP_ENTRIES {
        return Err(AgenticSuperAppReleaseError::TooLarge);
    }
    Ok(())
}

fn extract_archive(source: &Path, staging: &Path) -> Result<(), AgenticSuperAppReleaseError> {
    let file = File::open(source)?;
    let mut archive = ZipArchive::new(file)?;
    if archive.len() > MAX_BACKUP_ENTRIES {
        return Err(AgenticSuperAppReleaseError::TooLarge);
    }
    let mut total = 0u64;
    let mut found_database = false;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let name = entry.name().replace('\\', "/");
        if name == "manifest.json" {
            continue;
        }
        if name == DATABASE_ENTRY {
            found_database = true;
        } else if !name.starts_with(ARTIFACTS_PREFIX) {
            return Err(AgenticSuperAppReleaseError::InvalidBackup(
                "archive contains an unexpected entry".to_owned(),
            ));
        }
        let relative = safe_relative_path(&name)?;
        let destination = staging.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&destination)?;
            continue;
        }
        total = total
            .checked_add(entry.size())
            .ok_or(AgenticSuperAppReleaseError::TooLarge)?;
        if total > MAX_BACKUP_BYTES {
            return Err(AgenticSuperAppReleaseError::TooLarge);
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut output = File::create(destination)?;
        io::copy(&mut entry, &mut output)?;
    }
    if !found_database {
        return Err(AgenticSuperAppReleaseError::InvalidBackup(
            "archive does not contain a database snapshot".to_owned(),
        ));
    }
    fs::create_dir_all(staging.join(ARTIFACTS_PREFIX.trim_end_matches('/')))?;
    Ok(())
}

fn write_archive(
    destination: &Path,
    database: &Path,
    artifact_root: &Path,
    artifact_files: &[(PathBuf, u64)],
    manifest: &AgenticSuperAppBackupManifest,
) -> Result<(), AgenticSuperAppReleaseError> {
    let file = File::create(destination)?;
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default();
    archive.start_file("manifest.json", options)?;
    archive.write_all(serde_json::to_string_pretty(manifest)?.as_bytes())?;
    add_file(&mut archive, database, DATABASE_ENTRY, options)?;
    let mut total = fs::metadata(database)?.len();
    for (path, size) in artifact_files {
        total = total
            .checked_add(*size)
            .ok_or(AgenticSuperAppReleaseError::TooLarge)?;
        if total > MAX_BACKUP_BYTES {
            return Err(AgenticSuperAppReleaseError::TooLarge);
        }
        let relative = path.strip_prefix(artifact_root).map_err(|_| {
            AgenticSuperAppReleaseError::InvalidBackup("artifact path escaped root".to_owned())
        })?;
        let name = format!(
            "{ARTIFACTS_PREFIX}{}",
            relative.to_string_lossy().replace('\\', "/")
        );
        add_file(&mut archive, path, &name, options)?;
    }
    archive.finish()?;
    Ok(())
}

fn add_file(
    archive: &mut ZipWriter<File>,
    source: &Path,
    name: &str,
    options: SimpleFileOptions,
) -> Result<(), AgenticSuperAppReleaseError> {
    archive.start_file(name, options)?;
    let mut input = File::open(source)?;
    io::copy(&mut input, archive)?;
    Ok(())
}

fn collect_artifacts(root: &Path) -> Result<Vec<(PathBuf, u64)>, AgenticSuperAppReleaseError> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    collect_artifacts_inner(root, &mut files)?;
    if files.len() > MAX_BACKUP_ENTRIES {
        return Err(AgenticSuperAppReleaseError::TooLarge);
    }
    Ok(files)
}

fn collect_artifacts_inner(
    root: &Path,
    files: &mut Vec<(PathBuf, u64)>,
) -> Result<(), AgenticSuperAppReleaseError> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            collect_artifacts_inner(&entry.path(), files)?;
        } else if metadata.is_file() {
            files.push((entry.path(), metadata.len()));
        }
    }
    Ok(())
}

fn move_database_family(
    database_path: &Path,
    previous_database: &Path,
) -> Result<Vec<(PathBuf, PathBuf)>, AgenticSuperAppReleaseError> {
    let mut moved = Vec::new();
    for suffix in ["", "-wal", "-shm"] {
        let source = path_with_suffix(database_path, suffix);
        if !source.exists() {
            continue;
        }
        let destination = path_with_suffix(previous_database, suffix);
        if let Err(error) = fs::rename(&source, &destination) {
            restore_database_family(database_path, previous_database, &moved);
            return Err(error.into());
        }
        moved.push((source, destination));
    }
    Ok(moved)
}

fn restore_database_family(
    database_path: &Path,
    previous_database: &Path,
    moved: &[(PathBuf, PathBuf)],
) {
    for (source, destination) in moved.iter().rev() {
        if destination.exists() {
            let _ = fs::rename(destination, source);
        }
    }
    if !database_path.exists() {
        let previous_main = path_with_suffix(previous_database, "");
        if previous_main.exists() {
            let _ = fs::rename(previous_main, database_path);
        }
    }
}

fn rollback_database_restore(
    database_path: &Path,
    previous_database: &Path,
    moved: &[(PathBuf, PathBuf)],
) {
    for suffix in ["", "-wal", "-shm"] {
        let current = path_with_suffix(database_path, suffix);
        if current.exists() {
            let _ = fs::remove_file(current);
        }
    }
    restore_database_family(database_path, previous_database, moved);
}

fn path_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn safe_relative_path(value: &str) -> Result<PathBuf, AgenticSuperAppReleaseError> {
    let path = Path::new(value);
    if path.as_os_str().is_empty()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir
            )
        })
    {
        return Err(AgenticSuperAppReleaseError::InvalidBackup(
            "archive contains an unsafe path".to_owned(),
        ));
    }
    Ok(path.to_path_buf())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use agentic_super_app_persistence::AgenticSuperAppPersistence;

    #[test]
    fn archive_paths_cannot_escape_staging_directory() {
        assert!(safe_relative_path("artifacts/run/output.md").is_ok());
        assert!(safe_relative_path("../outside.txt").is_err());
        assert!(safe_relative_path("/outside.txt").is_err());
        assert!(safe_relative_path("C:/outside.txt").is_err());
    }

    #[test]
    fn manifest_requires_supported_database_snapshot() {
        let manifest = AgenticSuperAppBackupManifest {
            format_version: BACKUP_FORMAT_VERSION,
            product_version: "1.0.0".to_owned(),
            protocol_major: 2,
            created_at_unix_ms: 1,
            includes_database: true,
            artifact_count: 0,
        };
        assert!(validate_manifest(&manifest).is_ok());
        assert!(validate_manifest(&AgenticSuperAppBackupManifest {
            includes_database: false,
            ..manifest
        })
        .is_err());
    }

    #[tokio::test]
    async fn backup_contains_database_and_managed_artifacts() {
        let root =
            std::env::temp_dir().join(format!("agentic-super-app-release-test-{}", Uuid::now_v7()));
        let database = root.join("database.sqlite3");
        let artifact_root = root.join("artifacts");
        fs::create_dir_all(artifact_root.join("agent-artifacts"))
            .expect("create artifact test directory");
        fs::write(artifact_root.join("agent-artifacts/report.md"), b"report")
            .expect("write artifact test file");
        let destination = root.join("backup.zip");
        {
            let persistence = AgenticSuperAppPersistence::open(&database)
                .await
                .expect("open test database");
            persistence
                .set_setting("release.test", "true")
                .await
                .expect("write test setting");
            let summary = create_backup(
                &persistence,
                &AgenticSuperAppArtifactStore::new(artifact_root.clone()),
                &destination,
                "1.0.0",
                2,
            )
            .await
            .expect("create backup");
            assert_eq!(summary.artifact_count, 1);
            assert!(summary.bytes > 0);
            validate_manifest(&read_manifest(&destination).expect("read manifest"))
                .expect("manifest");
            persistence.close().await;
        }
        fs::remove_dir_all(root).expect("remove test files");
    }

    #[tokio::test]
    async fn restore_replaces_database_and_managed_artifacts() {
        let root =
            std::env::temp_dir().join(format!("agentic-super-app-restore-test-{}", Uuid::now_v7()));
        let app_data = root.join("app-data");
        let database = app_data.join("database.sqlite3");
        let artifact_root = app_data.join("artifacts");
        let source = root.join("backup.zip");
        fs::create_dir_all(&artifact_root).expect("create artifact directory");
        fs::write(artifact_root.join("report.md"), b"original").expect("write original artifact");
        {
            let persistence = AgenticSuperAppPersistence::open(&database)
                .await
                .expect("open original database");
            persistence
                .set_setting("restore.value", "original")
                .await
                .expect("write original setting");
            create_backup(
                &persistence,
                &AgenticSuperAppArtifactStore::new(artifact_root.clone()),
                &source,
                "1.0.0",
                2,
            )
            .await
            .expect("create restore fixture");
            persistence.close().await;
        }
        fs::write(artifact_root.join("report.md"), b"current").expect("write current artifact");
        {
            let persistence = AgenticSuperAppPersistence::open(&database)
                .await
                .expect("reopen current database");
            persistence
                .set_setting("restore.value", "current")
                .await
                .expect("write current setting");
            persistence.close().await;
        }

        prepare_restore(&source, &app_data).expect("stage restore");
        assert!(apply_pending_restore(&app_data, &database, &artifact_root).expect("apply restore"));

        let persistence = AgenticSuperAppPersistence::open(&database)
            .await
            .expect("open restored database");
        assert_eq!(
            persistence
                .get_setting("restore.value")
                .await
                .expect("read restored setting")
                .as_deref(),
            Some("original")
        );
        persistence.close().await;
        assert_eq!(
            fs::read_to_string(artifact_root.join("report.md")).expect("read restored artifact"),
            "original"
        );
        assert!(!app_data.join(PENDING_RESTORE_NAME).exists());
        fs::remove_dir_all(root).expect("remove restore test files");
    }
}
