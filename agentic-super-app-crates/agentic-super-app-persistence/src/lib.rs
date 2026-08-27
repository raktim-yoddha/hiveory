use agentic_super_app_protocol::{
    JobState, JobSummary, NotificationSummary, ProviderAccountSummary, ProviderKind,
};
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
pub mod orchestration;

pub const AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID: &str = "agentic-super-app-openai";
static AGENTIC_SUPER_APP_MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

#[derive(Clone)]
pub struct AgenticSuperAppPersistence {
    pool: SqlitePool,
}

impl AgenticSuperAppPersistence {
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
        AGENTIC_SUPER_APP_MIGRATOR.run(&pool).await?;
        sqlx::query("INSERT OR IGNORE INTO agentic_super_app_provider_accounts (id, provider_kind, display_name, enabled, created_at_unix_ms, updated_at_unix_ms) VALUES (?, 'open_ai_responses', 'OpenAI Responses', 1, ?, ?)")
            .bind(AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID).bind(now_ms()).bind(now_ms()).execute(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn set_setting(&self, key: &str, value_json: &str) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO agentic_super_app_settings (key, value_json, updated_at_unix_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at_unix_ms=excluded.updated_at_unix_ms")
            .bind(key).bind(value_json).bind(now_ms()).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn get_setting(&self, key: &str) -> Result<Option<String>, sqlx::Error> {
        Ok(
            sqlx::query("SELECT value_json FROM agentic_super_app_settings WHERE key = ?")
                .bind(key)
                .fetch_optional(&self.pool)
                .await?
                .map(|row| row.get(0)),
        )
    }
    pub async fn provider_accounts(&self) -> Result<Vec<ProviderAccountSummary>, sqlx::Error> {
        let rows = sqlx::query("SELECT id, display_name, default_model, secret_ref, enabled FROM agentic_super_app_provider_accounts ORDER BY created_at_unix_ms").fetch_all(&self.pool).await?;
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
        sqlx::query("UPDATE agentic_super_app_provider_accounts SET default_model=?, secret_ref=?, updated_at_unix_ms=? WHERE id=?").bind(model).bind(secret_ref).bind(now_ms()).bind(AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn provider_secret_ref(&self) -> Result<Option<String>, sqlx::Error> {
        Ok(
            sqlx::query("SELECT secret_ref FROM agentic_super_app_provider_accounts WHERE id=?")
                .bind(AGENTIC_SUPER_APP_DEFAULT_PROVIDER_ACCOUNT_ID)
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
        sqlx::query("INSERT INTO agentic_super_app_jobs (id, kind, state, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, 'queued', ?, ?)").bind(&job.id).bind(&job.kind).bind(job.created_at_unix_ms).bind(job.updated_at_unix_ms).execute(&self.pool).await?;
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
        sqlx::query("UPDATE agentic_super_app_jobs SET state=?, updated_at_unix_ms=?, error_code=? WHERE id=?").bind(state_value).bind(updated_at_unix_ms).bind(error_code).bind(id).execute(&self.pool).await?;
        Ok(self.job(id).await?.expect("job exists after update"))
    }
    pub async fn job(&self, id: &str) -> Result<Option<JobSummary>, sqlx::Error> {
        Ok(sqlx::query("SELECT id, kind, state, created_at_unix_ms, updated_at_unix_ms, error_code FROM agentic_super_app_jobs WHERE id=?").bind(id).fetch_optional(&self.pool).await?.map(job_from_row))
    }
    pub async fn recent_jobs(&self) -> Result<Vec<JobSummary>, sqlx::Error> {
        Ok(sqlx::query("SELECT id, kind, state, created_at_unix_ms, updated_at_unix_ms, error_code FROM agentic_super_app_jobs ORDER BY updated_at_unix_ms DESC LIMIT 20").fetch_all(&self.pool).await?.into_iter().map(job_from_row).collect())
    }
    pub async fn interrupt_active_jobs(&self) -> Result<usize, sqlx::Error> {
        Ok(sqlx::query("UPDATE agentic_super_app_jobs SET state='interrupted', updated_at_unix_ms=? WHERE state IN ('queued','running')").bind(now_ms()).execute(&self.pool).await?.rows_affected() as usize)
    }
    pub async fn checkpoint(
        &self,
        job_id: &str,
        sequence: i64,
        summary: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO agentic_super_app_job_checkpoints (id, job_id, sequence, summary, created_at_unix_ms) VALUES (?, ?, ?, ?, ?)").bind(Uuid::now_v7().to_string()).bind(job_id).bind(sequence).bind(summary).bind(now_ms()).execute(&self.pool).await?;
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
        sqlx::query("INSERT INTO agentic_super_app_audit_entries (id, action_code, outcome, severity, target, redacted_context, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(Uuid::now_v7().to_string()).bind(action).bind(outcome).bind(severity).bind(target).bind(context).bind(now_ms()).execute(&self.pool).await?;
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
        sqlx::query("INSERT INTO agentic_super_app_notifications (id, title, body, severity, created_at_unix_ms) VALUES (?, ?, ?, ?, ?)").bind(&item.id).bind(&item.title).bind(&item.body).bind(&item.severity).bind(item.created_at_unix_ms).execute(&self.pool).await?;
        Ok(item)
    }
    pub async fn notifications(&self) -> Result<Vec<NotificationSummary>, sqlx::Error> {
        let rows = sqlx::query("SELECT id, title, body, severity, read_at_unix_ms, created_at_unix_ms FROM agentic_super_app_notifications ORDER BY created_at_unix_ms DESC LIMIT 20").fetch_all(&self.pool).await?;
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
