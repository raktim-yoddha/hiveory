use super::{now_ms, HiveoryPersistence};
use hiveory_protocol::{CodeHostedTracking, TaskSourceProvider, TaskSourceSummary};
use sqlx::Row;
use uuid::Uuid;

pub struct TaskSourceSaveRequest<'a> {
    pub workspace_id: &'a str,
    pub provider: TaskSourceProvider,
    pub label: &'a str,
    pub endpoint: Option<&'a str>,
    pub account_label: Option<&'a str>,
    pub secret_ref: Option<&'a str>,
    pub validated_at_unix_ms: Option<i64>,
    pub last_error: Option<&'a str>,
}

impl HiveoryPersistence {
    pub async fn hosted_tracking_cache(
        &self,
        workspace_id: &str,
    ) -> Result<Option<CodeHostedTracking>, sqlx::Error> {
        let Some(payload_json) = sqlx::query(
            "SELECT payload_json FROM hiveory_code_hosted_tracking_cache WHERE workspace_id=?",
        )
        .bind(workspace_id)
        .fetch_optional(&self.pool)
        .await?
        .map(|row| row.get::<String, _>(0)) else {
            return Ok(None);
        };
        serde_json::from_str(&payload_json)
            .map(Some)
            .map_err(|error| {
                sqlx::Error::Protocol(format!("invalid hosted tracking cache: {error}"))
            })
    }

    pub async fn save_hosted_tracking(
        &self,
        tracking: &CodeHostedTracking,
    ) -> Result<(), sqlx::Error> {
        let payload_json = serde_json::to_string(tracking).map_err(|error| {
            sqlx::Error::Protocol(format!("hosted tracking serialization failed: {error}"))
        })?;
        sqlx::query(
            "INSERT INTO hiveory_code_hosted_tracking_cache (workspace_id, payload_json, refreshed_at_unix_ms, stale, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET payload_json=excluded.payload_json, refreshed_at_unix_ms=excluded.refreshed_at_unix_ms, stale=excluded.stale, updated_at_unix_ms=excluded.updated_at_unix_ms",
        )
        .bind(&tracking.workspace_id)
        .bind(payload_json)
        .bind(tracking.refreshed_at_unix_ms)
        .bind(if tracking.stale { 1 } else { 0 })
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

impl HiveoryPersistence {
    pub async fn task_sources(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<TaskSourceSummary>, sqlx::Error> {
        let rows = sqlx::query("SELECT id, workspace_id, provider, label, endpoint, account_label, enabled, validated_at_unix_ms, last_error, updated_at_unix_ms FROM hiveory_task_sources WHERE workspace_id=? ORDER BY provider")
            .bind(workspace_id).fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(task_source_from_row).collect())
    }

    pub async fn task_source_secret_ref(
        &self,
        source_id: &str,
    ) -> Result<Option<String>, sqlx::Error> {
        Ok(
            sqlx::query("SELECT secret_ref FROM hiveory_task_sources WHERE id=?")
                .bind(source_id)
                .fetch_optional(&self.pool)
                .await?
                .and_then(|row| row.get::<Option<String>, _>(0)),
        )
    }

    pub async fn save_task_source(
        &self,
        request: TaskSourceSaveRequest<'_>,
    ) -> Result<TaskSourceSummary, sqlx::Error> {
        let provider_value = task_source_provider_value(request.provider);
        let id = Uuid::now_v7().to_string();
        let now = now_ms();
        sqlx::query("INSERT INTO hiveory_task_sources (id, workspace_id, provider, label, endpoint, account_label, secret_ref, enabled, validated_at_unix_ms, last_error, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT(workspace_id, provider) DO UPDATE SET label=excluded.label, endpoint=excluded.endpoint, account_label=excluded.account_label, secret_ref=COALESCE(excluded.secret_ref, hiveory_task_sources.secret_ref), enabled=1, validated_at_unix_ms=excluded.validated_at_unix_ms, last_error=excluded.last_error, updated_at_unix_ms=excluded.updated_at_unix_ms")
            .bind(id).bind(request.workspace_id).bind(provider_value).bind(request.label).bind(request.endpoint).bind(request.account_label).bind(request.secret_ref).bind(request.validated_at_unix_ms).bind(request.last_error).bind(now).bind(now).execute(&self.pool).await?;
        let row = sqlx::query("SELECT id, workspace_id, provider, label, endpoint, account_label, enabled, validated_at_unix_ms, last_error, updated_at_unix_ms FROM hiveory_task_sources WHERE workspace_id=? AND provider=?")
            .bind(request.workspace_id).bind(provider_value).fetch_one(&self.pool).await?;
        Ok(task_source_from_row(row))
    }

    pub async fn remove_task_source(&self, source_id: &str) -> Result<Option<String>, sqlx::Error> {
        let secret_ref = self.task_source_secret_ref(source_id).await?;
        sqlx::query("DELETE FROM hiveory_task_sources WHERE id=?")
            .bind(source_id)
            .execute(&self.pool)
            .await?;
        Ok(secret_ref)
    }
}

fn task_source_from_row(row: sqlx::sqlite::SqliteRow) -> TaskSourceSummary {
    let provider: String = row.get(2);
    TaskSourceSummary {
        id: row.get(0),
        workspace_id: row.get(1),
        provider: match provider.as_str() {
            "jira" => TaskSourceProvider::Jira,
            "linear" => TaskSourceProvider::Linear,
            _ => TaskSourceProvider::Github,
        },
        label: row.get(3),
        endpoint: row.get(4),
        account_label: row.get(5),
        enabled: row.get::<i64, _>(6) != 0,
        validated_at_unix_ms: row.get(7),
        last_error: row.get(8),
        updated_at_unix_ms: row.get(9),
    }
}

fn task_source_provider_value(provider: TaskSourceProvider) -> &'static str {
    match provider {
        TaskSourceProvider::Github => "github",
        TaskSourceProvider::Jira => "jira",
        TaskSourceProvider::Linear => "linear",
    }
}
