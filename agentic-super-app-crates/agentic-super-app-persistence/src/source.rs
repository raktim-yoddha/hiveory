use super::{now_ms, AgenticSuperAppPersistence};
use agentic_super_app_protocol::CodeHostedTracking;
use sqlx::Row;

impl AgenticSuperAppPersistence {
    pub async fn hosted_tracking_cache(
        &self,
        workspace_id: &str,
    ) -> Result<Option<CodeHostedTracking>, sqlx::Error> {
        let Some(payload_json) = sqlx::query(
            "SELECT payload_json FROM agentic_super_app_code_hosted_tracking_cache WHERE workspace_id=?",
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
            "INSERT INTO agentic_super_app_code_hosted_tracking_cache (workspace_id, payload_json, refreshed_at_unix_ms, stale, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET payload_json=excluded.payload_json, refreshed_at_unix_ms=excluded.refreshed_at_unix_ms, stale=excluded.stale, updated_at_unix_ms=excluded.updated_at_unix_ms",
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
