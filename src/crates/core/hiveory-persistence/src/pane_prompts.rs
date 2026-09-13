use crate::HiveoryPersistence;
use serde::Serialize;
use sqlx::Row;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
pub struct PanePrompt {
    pub id: String,
    pub workspace_id: String,
    pub pane_id: String,
    pub terminal_id: String,
    pub session_id: Option<String>,
    #[serde(skip_serializing)]
    pub prompt: String,
    pub client_request_id: String,
    pub state: String,
    pub ready_sequence: Option<i64>,
    pub error: Option<String>,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

impl HiveoryPersistence {
    pub async fn enqueue_pane_prompt(
        &self,
        workspace_id: &str,
        pane_id: &str,
        terminal_id: &str,
        session_id: Option<&str>,
        prompt: &str,
        client_request_id: &str,
    ) -> Result<PanePrompt, sqlx::Error> {
        let now = super::now_ms();
        sqlx::query("INSERT OR IGNORE INTO hiveory_code_pane_prompts (id, workspace_id, pane_id, terminal_id, session_id, prompt, client_request_id, state, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)")
            .bind(Uuid::now_v7().to_string())
            .bind(workspace_id)
            .bind(pane_id)
            .bind(terminal_id)
            .bind(session_id)
            .bind(prompt)
            .bind(client_request_id)
            .bind(now)
            .bind(now)
            .execute(self.pool())
            .await?;
        let record = sqlx::query("SELECT * FROM hiveory_code_pane_prompts WHERE workspace_id = ? AND client_request_id = ?")
            .bind(workspace_id)
            .bind(client_request_id)
            .fetch_one(self.pool())
            .await?;
        Ok(pane_prompt_from_row(&record))
    }

    pub async fn pane_prompt(&self, id: &str) -> Result<Option<PanePrompt>, sqlx::Error> {
        Ok(
            sqlx::query("SELECT * FROM hiveory_code_pane_prompts WHERE id = ?")
                .bind(id)
                .fetch_optional(self.pool())
                .await?
                .map(|row| pane_prompt_from_row(&row)),
        )
    }

    pub async fn pending_pane_prompts(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<PanePrompt>, sqlx::Error> {
        let rows = sqlx::query("SELECT * FROM hiveory_code_pane_prompts WHERE workspace_id = ? AND state = 'queued' ORDER BY created_at_unix_ms, id LIMIT 100")
            .bind(workspace_id)
            .fetch_all(self.pool())
            .await?;
        Ok(rows.iter().map(pane_prompt_from_row).collect())
    }

    pub async fn first_unresolved_pane_prompt(
        &self,
        workspace_id: &str,
        pane_id: &str,
    ) -> Result<Option<PanePrompt>, sqlx::Error> {
        Ok(sqlx::query("SELECT * FROM hiveory_code_pane_prompts WHERE workspace_id = ? AND pane_id = ? AND state IN ('queued', 'delivering', 'uncertain') ORDER BY created_at_unix_ms, id LIMIT 1")
            .bind(workspace_id)
            .bind(pane_id)
            .fetch_optional(self.pool())
            .await?
            .map(|row| pane_prompt_from_row(&row)))
    }

    /// Return the oldest unresolved prompt for the currently bound terminal.
    /// A pane can be deliberately rebound to a fresh terminal after a crash;
    /// an uncertain write for the previous terminal must remain inspectable
    /// without blocking safe delivery to the new session.
    pub async fn first_unresolved_pane_prompt_for_terminal(
        &self,
        workspace_id: &str,
        pane_id: &str,
        terminal_id: &str,
    ) -> Result<Option<PanePrompt>, sqlx::Error> {
        Ok(sqlx::query("SELECT * FROM hiveory_code_pane_prompts WHERE workspace_id = ? AND pane_id = ? AND terminal_id = ? AND state IN ('queued', 'delivering', 'uncertain') ORDER BY created_at_unix_ms, id LIMIT 1")
            .bind(workspace_id)
            .bind(pane_id)
            .bind(terminal_id)
            .fetch_optional(self.pool())
            .await?
            .map(|row| pane_prompt_from_row(&row)))
    }

    pub async fn claim_pane_prompt(&self, id: &str) -> Result<bool, sqlx::Error> {
        Ok(sqlx::query("UPDATE hiveory_code_pane_prompts SET state = 'delivering', updated_at_unix_ms = ? WHERE id = ? AND state = 'queued'")
            .bind(super::now_ms())
            .bind(id)
            .execute(self.pool())
            .await?
            .rows_affected() == 1)
    }

    /// Fail prompts that still target a pane session which is being replaced.
    /// A replacement must never inherit input intended for the old CLI: the
    /// caller can submit a fresh request to the new durable session instead.
    pub async fn fail_queued_pane_prompts_for_terminal(
        &self,
        workspace_id: &str,
        pane_id: &str,
        terminal_id: &str,
        error: &str,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("UPDATE hiveory_code_pane_prompts SET state = 'failed', error = ?, updated_at_unix_ms = ? WHERE workspace_id = ? AND pane_id = ? AND terminal_id = ? AND state = 'queued'")
            .bind(error)
            .bind(super::now_ms())
            .bind(workspace_id)
            .bind(pane_id)
            .bind(terminal_id)
            .execute(self.pool())
            .await?;
        Ok(result.rows_affected())
    }

    /// Invalidate input when a pane is being rebound to a new terminal. A
    /// prompt that was only queued is known not to have reached the old
    /// process; a prompt already claimed for delivery has an ambiguous
    /// outcome and must remain visible as `uncertain` so it is never replayed.
    pub async fn invalidate_pane_prompts_for_terminal(
        &self,
        workspace_id: &str,
        pane_id: &str,
        terminal_id: &str,
        error: &str,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("UPDATE hiveory_code_pane_prompts SET state = CASE WHEN state = 'delivering' THEN 'uncertain' ELSE 'failed' END, error = ?, updated_at_unix_ms = ? WHERE workspace_id = ? AND pane_id = ? AND terminal_id = ? AND state IN ('queued', 'delivering')")
            .bind(error)
            .bind(super::now_ms())
            .bind(workspace_id)
            .bind(pane_id)
            .bind(terminal_id)
            .execute(self.pool())
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn settle_pane_prompt(
        &self,
        id: &str,
        state: &str,
        error: Option<&str>,
        ready_sequence: Option<u64>,
    ) -> Result<(), sqlx::Error> {
        if !matches!(state, "delivered" | "failed" | "uncertain") {
            return Err(sqlx::Error::Protocol(format!(
                "invalid pane prompt terminal state: {state}"
            )));
        }
        sqlx::query("UPDATE hiveory_code_pane_prompts SET state = ?, error = ?, ready_sequence = ?, updated_at_unix_ms = ? WHERE id = ? AND state = 'delivering'")
            .bind(state)
            .bind(error)
            .bind(ready_sequence.map(|sequence| sequence as i64))
            .bind(super::now_ms())
            .bind(id)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    pub async fn last_delivered_pane_sequence(
        &self,
        workspace_id: &str,
        pane_id: &str,
    ) -> Result<Option<u64>, sqlx::Error> {
        Ok(sqlx::query_scalar::<_, Option<i64>>("SELECT MAX(ready_sequence) FROM hiveory_code_pane_prompts WHERE workspace_id = ? AND pane_id = ? AND state = 'delivered'")
            .bind(workspace_id)
            .bind(pane_id)
            .fetch_one(self.pool())
            .await?
            .map(|sequence| sequence as u64))
    }

    pub async fn last_delivered_pane_sequence_for_terminal(
        &self,
        workspace_id: &str,
        pane_id: &str,
        terminal_id: &str,
    ) -> Result<Option<u64>, sqlx::Error> {
        Ok(sqlx::query_scalar::<_, Option<i64>>("SELECT MAX(ready_sequence) FROM hiveory_code_pane_prompts WHERE workspace_id = ? AND pane_id = ? AND terminal_id = ? AND state = 'delivered'")
            .bind(workspace_id)
            .bind(pane_id)
            .bind(terminal_id)
            .fetch_one(self.pool())
            .await?
            .map(|sequence| sequence as u64))
    }

    pub async fn recover_pane_prompts(&self) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE hiveory_code_pane_prompts SET state = 'uncertain', error = 'Delivery was interrupted; inspect the target before retrying.', updated_at_unix_ms = ? WHERE state = 'delivering'")
            .bind(super::now_ms())
            .execute(self.pool())
            .await?;
        Ok(())
    }
}

fn pane_prompt_from_row(row: &sqlx::sqlite::SqliteRow) -> PanePrompt {
    PanePrompt {
        id: row.get("id"),
        workspace_id: row.get("workspace_id"),
        pane_id: row.get("pane_id"),
        terminal_id: row.get("terminal_id"),
        session_id: row.get("session_id"),
        prompt: row.get("prompt"),
        client_request_id: row.get("client_request_id"),
        state: row.get("state"),
        ready_sequence: row.get("ready_sequence"),
        error: row.get("error"),
        created_at_unix_ms: row.get("created_at_unix_ms"),
        updated_at_unix_ms: row.get("updated_at_unix_ms"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn direct_prompts_deduplicate_and_uncertain_delivery_is_not_replayed() {
        let path =
            std::env::temp_dir().join(format!("hiveory-pane-prompts-{}.sqlite3", Uuid::now_v7()));
        let persistence = HiveoryPersistence::open(&path).await.unwrap();
        let first = persistence
            .enqueue_pane_prompt(
                "workspace",
                "pane",
                "terminal",
                Some("session"),
                "continue",
                "same-request",
            )
            .await
            .unwrap();
        let duplicate = persistence
            .enqueue_pane_prompt(
                "workspace",
                "pane",
                "terminal",
                Some("session"),
                "continue",
                "same-request",
            )
            .await
            .unwrap();
        assert_eq!(first.id, duplicate.id);
        assert_eq!(
            persistence
                .pending_pane_prompts("workspace")
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(persistence.claim_pane_prompt(&first.id).await.unwrap());
        assert!(!persistence.claim_pane_prompt(&first.id).await.unwrap());
        assert!(persistence
            .settle_pane_prompt(&first.id, "unknown", None, None)
            .await
            .is_err());
        persistence.close().await;

        let reopened = HiveoryPersistence::open(&path).await.unwrap();
        let recovered = reopened.pane_prompt(&first.id).await.unwrap().unwrap();
        assert_eq!(recovered.state, "uncertain");
        let second = reopened
            .enqueue_pane_prompt(
                "workspace",
                "pane",
                "terminal",
                Some("session"),
                "more work",
                "next-request",
            )
            .await
            .unwrap();
        assert_eq!(second.state, "queued");
        assert_eq!(
            reopened
                .first_unresolved_pane_prompt("workspace", "pane")
                .await
                .unwrap()
                .unwrap()
                .id,
            first.id
        );
        assert!(reopened
            .pending_pane_prompts("workspace")
            .await
            .unwrap()
            .iter()
            .any(|item| item.id == second.id));
        assert_eq!(
            reopened
                .fail_queued_pane_prompts_for_terminal(
                    "workspace",
                    "pane",
                    "terminal",
                    "pane replaced",
                )
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            reopened
                .pane_prompt(&second.id)
                .await
                .unwrap()
                .unwrap()
                .state,
            "failed"
        );
        let third = reopened
            .enqueue_pane_prompt(
                "workspace",
                "pane",
                "terminal",
                Some("session"),
                "ambiguous",
                "ambiguous-request",
            )
            .await
            .unwrap();
        assert!(reopened.claim_pane_prompt(&third.id).await.unwrap());
        assert_eq!(
            reopened
                .invalidate_pane_prompts_for_terminal(
                    "workspace",
                    "pane",
                    "terminal",
                    "pane rebound",
                )
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            reopened
                .pane_prompt(&third.id)
                .await
                .unwrap()
                .unwrap()
                .state,
            "uncertain"
        );
        let fourth = reopened
            .enqueue_pane_prompt(
                "workspace",
                "pane",
                "terminal-new",
                Some("new-session"),
                "fresh session",
                "fresh-request",
            )
            .await
            .unwrap();
        assert_eq!(
            reopened
                .first_unresolved_pane_prompt_for_terminal("workspace", "pane", "terminal-new")
                .await
                .unwrap()
                .unwrap()
                .id,
            fourth.id
        );
        assert!(reopened.claim_pane_prompt(&fourth.id).await.unwrap());
        reopened
            .settle_pane_prompt(&fourth.id, "delivered", None, Some(7))
            .await
            .unwrap();
        assert_eq!(
            reopened
                .last_delivered_pane_sequence_for_terminal("workspace", "pane", "terminal-new",)
                .await
                .unwrap(),
            Some(7)
        );
        reopened.close().await;
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
    }
}
