use hiveory_protocol::{
    JobState, JobSummary, NotificationSummary, ProviderAccountSummary, ProviderKind,
};
use sha2::{Digest, Sha384};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::{
    path::Path,
    str::FromStr,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub mod agent;
pub mod chat;
pub mod code;
pub mod gates;
pub mod mailbox;
pub mod orchestration;
pub mod pane_prompts;
pub mod plugin;
pub mod routine;
pub mod source;

pub use source::TaskSourceSaveRequest;

pub const HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID: &str = "hiveory-openai";
static HIVEORY_MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

const HIVEORY_MIGRATION_RECEIPT_RANGE: std::ops::RangeInclusive<i64> = 7..=24;
const LEGACY_HIVEORY_MIGRATION_RECEIPTS: &[(i64, &str)] = &[
    // Migration 7 changed only the default agent avatar color so the
    // graphite palette is used for new records. Existing databases may still
    // carry the checksum from the pre-neutralized migration.
    (7, "8c09933d6f3e8c2b1fd271473d1b90a2a21f6e9a8ee882e57c8aa953a7915c991a6942fe5dc986fc4f1b5ba7c7e21220"),
    (16, "78e736c0ddfbb69e3f46168f3c394eb6fd33fc8080e6578f169c61187c94a22435ddd0dd2a523050be0828cadf5b307d"),
    (17, "4bacc140916075eb1a72bbb2ed75b74819199822f4c0c06e7bf993aca2fae89052389704b2569fbd68a28528f895e293"),
    (18, "7deaa98f90a6cea8a090550cf86ed307166f448f204e0b9d7f2961d5ccd08c051dc1ee911b364d4ee2a5825f409668ee"),
    (19, "b59d7bda55f79553d2b2582ffa2591c6539303223e91819a7371e7308c853b9727075586a204c7d156faac1116bb0697"),
    (20, "fa478f1fe8a72b0dd94b1a2f0bc196fc07334f8df82f5a4a03b3c80d722a2ded110eb680b269d9a4c328bedcf4e23815"),
    (21, "ee1b6abc12eacdb185fb862dd97aab9b4d2f58490a5fbb940b43f2c096380b728e223e8b072ffd6b6d97eabc11fd4d0a"),
    (22, "461259b1da6d2c13b11b80953954d7c84e71dbebf4ea5027b1f3b32b8e454a69cb5b822b955b46f8bc79d76372b3168a"),
    (23, "c285f997d84bf59aee40597a98f322af45a88e49bd304cf185e6bd141116e99f7db86c3a1db22f0b5e9746236d971a74"),
    (24, "01a53e25aa42a7fda152c50716aa64be692df208c3f63bd4566f68321950e22cb3f11b5d6daac189a94e72fef27b02f4"),
];

#[derive(Clone)]
pub struct HiveoryPersistence {
    pool: SqlitePool,
}

impl HiveoryPersistence {
    pub(crate) fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn open(path: &Path) -> Result<Self, sqlx::Error> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(sqlx::Error::Io)?;
        }
        let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))?
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(std::time::Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;
        reconcile_hiveory_migration_receipts(&pool).await?;
        HIVEORY_MIGRATOR.run(&pool).await?;
        sqlx::query("UPDATE hiveory_code_pane_prompts SET state = 'uncertain', error = 'Delivery was interrupted; inspect the target before retrying.' WHERE state = 'delivering'")
            .execute(&pool).await?;
        sqlx::query("INSERT OR IGNORE INTO hiveory_provider_accounts (id, provider_kind, display_name, enabled, created_at_unix_ms, updated_at_unix_ms) VALUES (?, 'open_ai_responses', 'OpenAI Responses', 1, ?, ?)")
            .bind(HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID).bind(now_ms()).bind(now_ms()).execute(&pool).await?;
        Ok(Self { pool })
    }

    /// Close all connections before a database is moved or replaced.
    pub async fn close(self) {
        self.pool.close().await;
    }

    pub async fn set_setting(&self, key: &str, value_json: &str) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO hiveory_settings (key, value_json, updated_at_unix_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at_unix_ms=excluded.updated_at_unix_ms")
            .bind(key).bind(value_json).bind(now_ms()).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn get_setting(&self, key: &str) -> Result<Option<String>, sqlx::Error> {
        Ok(
            sqlx::query("SELECT value_json FROM hiveory_settings WHERE key = ?")
                .bind(key)
                .fetch_optional(&self.pool)
                .await?
                .map(|row| row.get(0)),
        )
    }

    /// Create a consistent SQLite snapshot without copying an active WAL file.
    /// The caller owns the destination path and is responsible for packaging it.
    pub async fn backup_sqlite(&self, destination: &Path) -> Result<(), sqlx::Error> {
        if destination.exists() {
            return Err(sqlx::Error::Protocol(
                "backup destination already exists".to_owned(),
            ));
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(sqlx::Error::Io)?;
        }
        let destination = destination.to_string_lossy().into_owned();
        sqlx::query("VACUUM INTO ?")
            .bind(destination)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn record_startup(
        &self,
        product_version: &str,
        protocol_major: u16,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO hiveory_release_metadata (id, product_version, protocol_major, last_started_at_unix_ms, last_clean_shutdown_at_unix_ms, last_backup_at_unix_ms) VALUES (1, ?, ?, ?, NULL, NULL) ON CONFLICT(id) DO UPDATE SET product_version=excluded.product_version, protocol_major=excluded.protocol_major, last_started_at_unix_ms=excluded.last_started_at_unix_ms, last_clean_shutdown_at_unix_ms=NULL",
        )
        .bind(product_version)
        .bind(i64::from(protocol_major))
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn previous_shutdown_was_clean(&self) -> Result<Option<bool>, sqlx::Error> {
        Ok(sqlx::query(
            "SELECT last_clean_shutdown_at_unix_ms FROM hiveory_release_metadata WHERE id=1",
        )
        .fetch_optional(&self.pool)
        .await?
        .map(|row| row.get::<Option<i64>, _>(0).is_some()))
    }

    pub async fn record_clean_shutdown(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE hiveory_release_metadata SET last_clean_shutdown_at_unix_ms=? WHERE id=1",
        )
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn record_backup(&self) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE hiveory_release_metadata SET last_backup_at_unix_ms=? WHERE id=1")
            .bind(now_ms())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn provider_accounts(&self) -> Result<Vec<ProviderAccountSummary>, sqlx::Error> {
        let rows = sqlx::query("SELECT id, display_name, default_model, secret_ref, enabled FROM hiveory_provider_accounts ORDER BY created_at_unix_ms").fetch_all(&self.pool).await?;
        Ok(rows
            .into_iter()
            .map(|row| ProviderAccountSummary {
                id: row.get(0),
                kind: ProviderKind::OpenAiResponses,
                display_name: row.get(1),
                default_model: row.get(2),
                secret_configured: row.get::<Option<String>, _>(3).is_some(),
                enabled: row.get::<i64, _>(4) != 0,
            })
            .collect())
    }
    pub async fn configure_provider(
        &self,
        model: Option<&str>,
        secret_ref: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE hiveory_provider_accounts SET default_model=?, secret_ref=?, updated_at_unix_ms=? WHERE id=?").bind(model).bind(secret_ref).bind(now_ms()).bind(HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn provider_secret_ref(&self) -> Result<Option<String>, sqlx::Error> {
        Ok(
            sqlx::query("SELECT secret_ref FROM hiveory_provider_accounts WHERE id=?")
                .bind(HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID)
                .fetch_one(&self.pool)
                .await?
                .get(0),
        )
    }
    pub async fn create_job(&self, kind: &str) -> Result<JobSummary, sqlx::Error> {
        let job = JobSummary {
            id: Uuid::now_v7().to_string(),
            kind: kind.to_owned(),
            state: JobState::Queued,
            created_at_unix_ms: now_ms(),
            updated_at_unix_ms: now_ms(),
            error_code: None,
        };
        sqlx::query("INSERT INTO hiveory_jobs (id, kind, state, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, 'queued', ?, ?)").bind(&job.id).bind(&job.kind).bind(job.created_at_unix_ms).bind(job.updated_at_unix_ms).execute(&self.pool).await?;
        Ok(job)
    }
    pub async fn update_job(
        &self,
        id: &str,
        state: JobState,
        error_code: Option<&str>,
    ) -> Result<JobSummary, sqlx::Error> {
        let updated_at_unix_ms = now_ms();
        let state_value = job_state_value(&state);
        sqlx::query(
            "UPDATE hiveory_jobs SET state=?, updated_at_unix_ms=?, error_code=? WHERE id=?",
        )
        .bind(state_value)
        .bind(updated_at_unix_ms)
        .bind(error_code)
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(self.job(id).await?.expect("job exists after update"))
    }
    pub async fn job(&self, id: &str) -> Result<Option<JobSummary>, sqlx::Error> {
        Ok(sqlx::query("SELECT id, kind, state, created_at_unix_ms, updated_at_unix_ms, error_code FROM hiveory_jobs WHERE id=?").bind(id).fetch_optional(&self.pool).await?.map(job_from_row))
    }
    pub async fn recent_jobs(&self) -> Result<Vec<JobSummary>, sqlx::Error> {
        Ok(sqlx::query("SELECT id, kind, state, created_at_unix_ms, updated_at_unix_ms, error_code FROM hiveory_jobs ORDER BY updated_at_unix_ms DESC LIMIT 20").fetch_all(&self.pool).await?.into_iter().map(job_from_row).collect())
    }
    pub async fn interrupt_active_jobs(&self) -> Result<usize, sqlx::Error> {
        Ok(sqlx::query("UPDATE hiveory_jobs SET state='interrupted', updated_at_unix_ms=? WHERE state IN ('queued','running')").bind(now_ms()).execute(&self.pool).await?.rows_affected() as usize)
    }
    pub async fn checkpoint(
        &self,
        job_id: &str,
        sequence: i64,
        summary: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO hiveory_job_checkpoints (id, job_id, sequence, summary, created_at_unix_ms) VALUES (?, ?, ?, ?, ?)").bind(Uuid::now_v7().to_string()).bind(job_id).bind(sequence).bind(summary).bind(now_ms()).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn audit(
        &self,
        action: &str,
        outcome: &str,
        severity: &str,
        target: Option<&str>,
        context: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO hiveory_audit_entries (id, action_code, outcome, severity, target, redacted_context, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(Uuid::now_v7().to_string()).bind(action).bind(outcome).bind(severity).bind(target).bind(context).bind(now_ms()).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn notification(
        &self,
        title: &str,
        body: &str,
        severity: &str,
    ) -> Result<NotificationSummary, sqlx::Error> {
        let item = NotificationSummary {
            id: Uuid::now_v7().to_string(),
            title: title.to_owned(),
            body: body.to_owned(),
            severity: severity.to_owned(),
            read: false,
            created_at_unix_ms: now_ms(),
        };
        sqlx::query("INSERT INTO hiveory_notifications (id, title, body, severity, created_at_unix_ms) VALUES (?, ?, ?, ?, ?)").bind(&item.id).bind(&item.title).bind(&item.body).bind(&item.severity).bind(item.created_at_unix_ms).execute(&self.pool).await?;
        Ok(item)
    }
    pub async fn notifications(&self) -> Result<Vec<NotificationSummary>, sqlx::Error> {
        let rows = sqlx::query("SELECT id, title, body, severity, read_at_unix_ms, created_at_unix_ms FROM hiveory_notifications ORDER BY created_at_unix_ms DESC LIMIT 20").fetch_all(&self.pool).await?;
        Ok(rows
            .into_iter()
            .map(|row| NotificationSummary {
                id: row.get(0),
                title: row.get(1),
                body: row.get(2),
                severity: row.get(3),
                read: row.get::<Option<i64>, _>(4).is_some(),
                created_at_unix_ms: row.get(5),
            })
            .collect())
    }

    pub async fn mark_notification_read(&self, id: &str) -> Result<bool, sqlx::Error> {
        Ok(sqlx::query(
            "UPDATE hiveory_notifications SET read_at_unix_ms=? WHERE id=? AND read_at_unix_ms IS NULL",
        )
        .bind(now_ms())
        .bind(id)
        .execute(&self.pool)
        .await?
        .rows_affected()
            > 0)
    }

    pub async fn mark_all_notifications_read(&self) -> Result<u64, sqlx::Error> {
        Ok(sqlx::query(
            "UPDATE hiveory_notifications SET read_at_unix_ms=? WHERE read_at_unix_ms IS NULL",
        )
        .bind(now_ms())
        .execute(&self.pool)
        .await?
        .rows_affected())
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn job_state_value(state: &JobState) -> &'static str {
    match state {
        JobState::Queued => "queued",
        JobState::Running => "running",
        JobState::Completed => "completed",
        JobState::Failed => "failed",
        JobState::Cancelled => "cancelled",
        JobState::Interrupted => "interrupted",
    }
}
fn job_from_row(row: sqlx::sqlite::SqliteRow) -> JobSummary {
    let state: String = row.get(2);
    JobSummary {
        id: row.get(0),
        kind: row.get(1),
        state: match state.as_str() {
            "queued" => JobState::Queued,
            "running" => JobState::Running,
            "completed" => JobState::Completed,
            "cancelled" => JobState::Cancelled,
            "interrupted" => JobState::Interrupted,
            _ => JobState::Failed,
        },
        created_at_unix_ms: row.get(3),
        updated_at_unix_ms: row.get(4),
        error_code: row.get(5),
    }
}

fn hiveory_migration_checksum(version: i64) -> Option<Vec<u8>> {
    let migration: &[u8] = match version {
        7 => include_bytes!("../migrations/0007_agent_vertical_slice.sql"),
        16 => include_bytes!("../migrations/0016_hiveory_namespace.sql"),
        17 => include_bytes!("../migrations/0017_code_workspace_parent.sql"),
        18 => include_bytes!("../migrations/0018_chat_folders.sql"),
        19 => include_bytes!("../migrations/0019_code_terminal_host_history.sql"),
        20 => include_bytes!("../migrations/0020_task_sources.sql"),
        21 => include_bytes!("../migrations/0021_code_terminal_launch_mode.sql"),
        22 => include_bytes!("../migrations/0022_code_layout_presets.sql"),
        23 => include_bytes!("../migrations/0023_code_launch_presets.sql"),
        24 => include_bytes!("../migrations/0024_chat_profiles.sql"),
        _ => return None,
    };
    Some(Sha384::digest(migration).to_vec())
}

fn legacy_hiveory_migration_checksum(version: i64) -> Option<Vec<u8>> {
    let (_, encoded) = LEGACY_HIVEORY_MIGRATION_RECEIPTS
        .iter()
        .find(|(legacy_version, _)| *legacy_version == version)?;
    Some(
        (0..encoded.len())
            .step_by(2)
            .map(|offset| {
                u8::from_str_radix(&encoded[offset..offset + 2], 16).expect("valid checksum")
            })
            .collect(),
    )
}

/// Repairs receipts from pre-release builds that had the completed schema but
/// stale migration content. Unknown mismatches are intentionally left for
/// SQLx to reject.
async fn reconcile_hiveory_migration_receipts(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let migrations_table_exists: i64 = sqlx::query(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations')",
    )
    .fetch_one(pool)
    .await?
    .get(0);
    if migrations_table_exists == 0 {
        return Ok(());
    }

    let receipts = sqlx::query(
        "SELECT version, checksum FROM _sqlx_migrations WHERE version BETWEEN ? AND ? AND success=1",
    )
    .bind(*HIVEORY_MIGRATION_RECEIPT_RANGE.start())
    .bind(*HIVEORY_MIGRATION_RECEIPT_RANGE.end())
    .fetch_all(pool)
    .await?;
    let repairs = receipts
        .into_iter()
        .filter_map(|receipt| {
            let version: i64 = receipt.get(0);
            let checksum: Vec<u8> = receipt.get(1);
            let legacy_checksum = legacy_hiveory_migration_checksum(version)?;
            if checksum == legacy_checksum {
                hiveory_migration_checksum(version)
                    .map(|current_checksum| (version, legacy_checksum, current_checksum))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    if repairs.is_empty() {
        return Ok(());
    }

    let schema_is_complete: i64 = sqlx::query(
        "SELECT
            EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='hiveory_settings')
            AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='hiveory_agents')
            AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='hiveory_release_metadata')
            AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='hiveory_chat_folders')
            AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='hiveory_code_terminal_history')
            AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='hiveory_task_sources')
            AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='hiveory_code_layout_presets')
            AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='hiveory_code_launch_presets')
            AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='agentic_super_app_settings')
            AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='agentic_super_app_agents')
            AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='agentic_super_app_release_metadata')
            AND EXISTS(SELECT 1 FROM pragma_table_info('hiveory_code_workspaces') WHERE name='parent_workspace_id')
            AND EXISTS(SELECT 1 FROM pragma_table_info('hiveory_chat_conversations') WHERE name='folder_id')
            AND EXISTS(SELECT 1 FROM pragma_table_info('hiveory_code_terminals') WHERE name='root_path')
            AND EXISTS(SELECT 1 FROM pragma_table_info('hiveory_code_terminals') WHERE name='agent_launch_mode')
            AND EXISTS(SELECT 1 FROM pragma_table_info('hiveory_chat_turns') WHERE name='profile_json')",
    )
    .fetch_one(pool)
    .await?
    .get(0);
    if schema_is_complete == 0 {
        return Ok(());
    }

    let mut transaction = pool.begin().await?;
    for (version, legacy_checksum, current_checksum) in repairs {
        sqlx::query(
            "UPDATE _sqlx_migrations SET checksum=? WHERE version=? AND success=1 AND checksum=?",
        )
        .bind(current_checksum)
        .bind(version)
        .bind(legacy_checksum)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn open_repairs_the_known_hiveory_migration_receipts() {
        let path = std::env::temp_dir().join(format!(
            "hiveory-migration-receipt-{}.sqlite3",
            Uuid::now_v7()
        ));
        let persistence = HiveoryPersistence::open(&path)
            .await
            .expect("create database");
        for (version, _) in LEGACY_HIVEORY_MIGRATION_RECEIPTS {
            sqlx::query("UPDATE _sqlx_migrations SET checksum=? WHERE version=?")
                .bind(legacy_hiveory_migration_checksum(*version).expect("legacy checksum"))
                .bind(version)
                .execute(persistence.pool())
                .await
                .expect("seed legacy migration receipt");
        }
        persistence.close().await;

        let reopened = HiveoryPersistence::open(&path)
            .await
            .expect("repair migration receipt");
        for (version, _) in LEGACY_HIVEORY_MIGRATION_RECEIPTS {
            let checksum: Vec<u8> =
                sqlx::query("SELECT checksum FROM _sqlx_migrations WHERE version=?")
                    .bind(version)
                    .fetch_one(reopened.pool())
                    .await
                    .expect("migration receipt")
                    .get(0);
            assert_eq!(
                checksum,
                hiveory_migration_checksum(*version).expect("current checksum")
            );
        }
        reopened.close().await;
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn open_rejects_an_unknown_hiveory_namespace_migration_receipt() {
        let path = std::env::temp_dir().join(format!(
            "hiveory-migration-receipt-{}.sqlite3",
            Uuid::now_v7()
        ));
        let persistence = HiveoryPersistence::open(&path)
            .await
            .expect("create database");
        sqlx::query("UPDATE _sqlx_migrations SET checksum=? WHERE version=16")
            .bind(vec![0_u8; 48])
            .execute(persistence.pool())
            .await
            .expect("seed unknown migration receipt");
        persistence.close().await;

        assert!(HiveoryPersistence::open(&path).await.is_err());
        let _ = std::fs::remove_file(path);
    }
}
