//! Durable status snapshots for Hiveory-launched local coding-agent panes.

use super::{now_ms, HiveoryPersistence};
use hiveory_protocol::{CodeAgentPaneStatus, CodeAgentPaneStatusSource, CodeAgentPaneStatusState};
use sqlx::Row;

const STATUS_LIMIT: i64 = 200;

impl HiveoryPersistence {
    pub async fn upsert_code_agent_pane_status(
        &self,
        status: &CodeAgentPaneStatus,
    ) -> Result<CodeAgentPaneStatus, sqlx::Error> {
        let mut transaction = self.pool().begin().await?;
        let now = now_ms();
        sqlx::query(
            "INSERT INTO hiveory_code_agent_pane_statuses (session_id, workspace_id, terminal_id, pane_id, run_id, task_id, participant_address, adapter_id, state, source, summary, sequence, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT(session_id) DO UPDATE SET workspace_id=excluded.workspace_id, terminal_id=COALESCE(excluded.terminal_id, terminal_id), pane_id=COALESCE(excluded.pane_id, pane_id), run_id=COALESCE(excluded.run_id, run_id), task_id=COALESCE(excluded.task_id, task_id), participant_address=COALESCE(excluded.participant_address, participant_address), adapter_id=COALESCE(excluded.adapter_id, adapter_id), state=excluded.state, source=excluded.source, summary=excluded.summary, updated_at_unix_ms=excluded.updated_at_unix_ms",
        )
        .bind(&status.session_id).bind(&status.workspace_id).bind(&status.terminal_id).bind(&status.pane_id)
        .bind(&status.run_id).bind(&status.task_id).bind(&status.participant_address).bind(&status.adapter_id)
        .bind(status_state_value(status.state)).bind(status_source_value(status.source)).bind(&status.summary).bind(now)
        .execute(&mut *transaction).await?;
        let event = sqlx::query(
            "INSERT INTO hiveory_code_agent_pane_status_events (session_id, workspace_id, state, source, summary, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&status.session_id).bind(&status.workspace_id).bind(status_state_value(status.state))
        .bind(status_source_value(status.source)).bind(&status.summary).bind(now)
        .execute(&mut *transaction).await?;
        let sequence = event.last_insert_rowid();
        sqlx::query("UPDATE hiveory_code_agent_pane_statuses SET sequence=? WHERE session_id=?")
            .bind(sequence)
            .bind(&status.session_id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        self.code_agent_pane_status(&status.session_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    /// Accept one authenticated report from a pane. The caller-provided
    /// sequence is per session, while the returned sequence is the global
    /// durable cursor used for workspace observation.
    pub async fn report_code_agent_pane_status(
        &self,
        session_id: &str,
        report_sequence: u64,
        state: CodeAgentPaneStatusState,
        summary: Option<String>,
    ) -> Result<CodeAgentPaneStatus, sqlx::Error> {
        self.report_code_agent_pane_status_from(
            session_id,
            report_sequence,
            state,
            summary,
            CodeAgentPaneStatusSource::CliReport,
        )
        .await
    }

    /// Accept a provider lifecycle hook from the session-specific local adapter.
    /// Hook and CLI sequences are independent so one cannot suppress the other.
    pub async fn report_code_agent_pane_adapter_hook(
        &self,
        session_id: &str,
        report_sequence: u64,
        state: CodeAgentPaneStatusState,
        summary: Option<String>,
    ) -> Result<CodeAgentPaneStatus, sqlx::Error> {
        self.report_code_agent_pane_status_from(
            session_id,
            report_sequence,
            state,
            summary,
            CodeAgentPaneStatusSource::AdapterHook,
        )
        .await
    }

    async fn report_code_agent_pane_status_from(
        &self,
        session_id: &str,
        report_sequence: u64,
        state: CodeAgentPaneStatusState,
        summary: Option<String>,
        source: CodeAgentPaneStatusSource,
    ) -> Result<CodeAgentPaneStatus, sqlx::Error> {
        let mut transaction = self.pool().begin().await?;
        let row = sqlx::query("SELECT session_id, workspace_id, terminal_id, pane_id, run_id, task_id, participant_address, adapter_id, state, source, summary, sequence, updated_at_unix_ms FROM hiveory_code_agent_pane_statuses WHERE session_id=?")
            .bind(session_id)
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;
        let current = status_from_row(row);
        let last_report_sequence: i64 = match source {
            CodeAgentPaneStatusSource::CliReport => sqlx::query_scalar(
                "SELECT last_cli_report_sequence FROM hiveory_code_agent_pane_statuses WHERE session_id=?",
            )
            .bind(session_id)
            .fetch_one(&mut *transaction)
            .await?,
            CodeAgentPaneStatusSource::AdapterHook => sqlx::query_scalar(
                "SELECT last_adapter_hook_sequence FROM hiveory_code_agent_pane_statuses WHERE session_id=?",
            )
            .bind(session_id)
            .fetch_one(&mut *transaction)
            .await?,
            CodeAgentPaneStatusSource::Host => unreachable!("host status is not a report"),
        };
        if report_sequence <= last_report_sequence.max(0) as u64 {
            transaction.commit().await?;
            return Ok(current);
        }

        let now = now_ms();
        match source {
            CodeAgentPaneStatusSource::CliReport => sqlx::query(
                "UPDATE hiveory_code_agent_pane_statuses SET state=?, source=?, summary=?, last_cli_report_sequence=?, updated_at_unix_ms=? WHERE session_id=?",
            )
            .bind(status_state_value(state))
            .bind(status_source_value(source))
            .bind(&summary)
            .bind(report_sequence as i64)
            .bind(now)
            .bind(session_id)
            .execute(&mut *transaction)
            .await?,
            CodeAgentPaneStatusSource::AdapterHook => sqlx::query(
                "UPDATE hiveory_code_agent_pane_statuses SET state=?, source=?, summary=?, last_adapter_hook_sequence=?, updated_at_unix_ms=? WHERE session_id=?",
            )
            .bind(status_state_value(state))
            .bind(status_source_value(source))
            .bind(&summary)
            .bind(report_sequence as i64)
            .bind(now)
            .bind(session_id)
            .execute(&mut *transaction)
            .await?,
            CodeAgentPaneStatusSource::Host => unreachable!("host status is not a report"),
        };
        let event = sqlx::query("INSERT INTO hiveory_code_agent_pane_status_events (session_id, workspace_id, state, source, summary, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(session_id)
            .bind(&current.workspace_id)
            .bind(status_state_value(state))
            .bind(status_source_value(source))
            .bind(&summary)
            .bind(now)
            .execute(&mut *transaction)
            .await?;
        let sequence = event.last_insert_rowid();
        sqlx::query("UPDATE hiveory_code_agent_pane_statuses SET sequence=? WHERE session_id=?")
            .bind(sequence)
            .bind(session_id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        self.code_agent_pane_status(session_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    pub async fn recover_code_agent_pane_statuses(&self) -> Result<usize, sqlx::Error> {
        let statuses = sqlx::query("SELECT session_id, workspace_id, terminal_id, pane_id, run_id, task_id, participant_address, adapter_id, state, source, summary, sequence, updated_at_unix_ms FROM hiveory_code_agent_pane_statuses WHERE state IN ('starting', 'working', 'waiting', 'blocked', 'idle')")
            .fetch_all(self.pool())
            .await?
            .into_iter()
            .map(status_from_row)
            .collect::<Vec<_>>();
        let count = statuses.len();
        for current in statuses {
            self.upsert_code_agent_pane_status(&CodeAgentPaneStatus {
                state: CodeAgentPaneStatusState::Unknown,
                source: CodeAgentPaneStatusSource::Host,
                summary: Some(
                    "Status is unknown after host restart; wait for a new CLI report.".to_owned(),
                ),
                sequence: 0,
                updated_at_unix_ms: 0,
                ..current
            })
            .await?;
        }
        Ok(count)
    }

    /// Bind a bridge-created status to its visible pane after the terminal has
    /// been started. Both renderer and CLI launches use this path, so status
    /// ownership cannot depend on who created the pane.
    pub async fn attach_code_agent_pane_status(
        &self,
        session_id: &str,
        terminal_id: &str,
        pane_id: &str,
        adapter_id: Option<&str>,
    ) -> Result<Option<CodeAgentPaneStatus>, sqlx::Error> {
        let Some(mut status) = self.code_agent_pane_status(session_id).await? else {
            return Ok(None);
        };
        status.terminal_id = Some(terminal_id.to_owned());
        status.pane_id = Some(pane_id.to_owned());
        if let Some(adapter_id) = adapter_id {
            status.adapter_id = Some(adapter_id.to_owned());
        }
        self.upsert_code_agent_pane_status(&status).await.map(Some)
    }

    /// Record a host-observed lifecycle transition for the visible pane bound
    /// to a terminal. Terminal summaries deliberately do not contain the
    /// bridge session ID, so delivery and process-exit paths must resolve this
    /// durable binding by terminal ID rather than silently leaving `starting`.
    pub async fn update_code_agent_pane_status_for_terminal(
        &self,
        terminal_id: &str,
        state: CodeAgentPaneStatusState,
        summary: impl Into<String>,
    ) -> Result<Option<CodeAgentPaneStatus>, sqlx::Error> {
        let Some(row) = sqlx::query("SELECT session_id, workspace_id, terminal_id, pane_id, run_id, task_id, participant_address, adapter_id, state, source, summary, sequence, updated_at_unix_ms FROM hiveory_code_agent_pane_statuses WHERE terminal_id=? LIMIT 1")
            .bind(terminal_id)
            .fetch_optional(self.pool())
            .await?
        else {
            return Ok(None);
        };
        let mut status = status_from_row(row);
        status.state = state;
        status.source = CodeAgentPaneStatusSource::Host;
        status.summary = Some(summary.into());
        self.upsert_code_agent_pane_status(&status).await.map(Some)
    }

    pub async fn bind_code_agent_pane_status(
        &self,
        session_id: &str,
        run_id: &str,
        task_id: &str,
        participant_address: &str,
    ) -> Result<Option<CodeAgentPaneStatus>, sqlx::Error> {
        let Some(mut status) = self.code_agent_pane_status(session_id).await? else {
            return Ok(None);
        };
        status.run_id = Some(run_id.to_owned());
        status.task_id = Some(task_id.to_owned());
        status.participant_address = Some(participant_address.to_owned());
        status.summary = Some("Assigned to orchestration task".to_owned());
        status.source = CodeAgentPaneStatusSource::Host;
        self.upsert_code_agent_pane_status(&status).await.map(Some)
    }

    pub async fn code_agent_pane_status(
        &self,
        session_id: &str,
    ) -> Result<Option<CodeAgentPaneStatus>, sqlx::Error> {
        Ok(sqlx::query("SELECT session_id, workspace_id, terminal_id, pane_id, run_id, task_id, participant_address, adapter_id, state, source, summary, sequence, updated_at_unix_ms FROM hiveory_code_agent_pane_statuses WHERE session_id=?")
            .bind(session_id).fetch_optional(self.pool()).await?.map(status_from_row))
    }

    pub async fn code_agent_pane_statuses(
        &self,
        workspace_id: &str,
        after_sequence: Option<u64>,
    ) -> Result<Vec<CodeAgentPaneStatus>, sqlx::Error> {
        self.expire_stale_code_agent_pane_statuses(workspace_id)
            .await?;
        let rows = if let Some(after) = after_sequence.filter(|value| *value > 0) {
            sqlx::query("SELECT session_id, workspace_id, terminal_id, pane_id, run_id, task_id, participant_address, adapter_id, state, source, summary, sequence, updated_at_unix_ms FROM hiveory_code_agent_pane_statuses WHERE workspace_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?")
                .bind(workspace_id).bind(after as i64).bind(STATUS_LIMIT).fetch_all(self.pool()).await?
        } else {
            sqlx::query("SELECT session_id, workspace_id, terminal_id, pane_id, run_id, task_id, participant_address, adapter_id, state, source, summary, sequence, updated_at_unix_ms FROM hiveory_code_agent_pane_statuses WHERE workspace_id=? ORDER BY updated_at_unix_ms DESC LIMIT ?")
                .bind(workspace_id).bind(STATUS_LIMIT).fetch_all(self.pool()).await?
        };
        Ok(rows.into_iter().map(status_from_row).collect())
    }

    /// A live lifecycle signal older than thirty minutes is no longer safe to
    /// present as current work. Preserve the last summary, but make uncertainty
    /// explicit and durable so every observer sees the same state.
    async fn expire_stale_code_agent_pane_statuses(
        &self,
        workspace_id: &str,
    ) -> Result<(), sqlx::Error> {
        const STALE_AFTER_MS: i64 = 30 * 60 * 1000;
        let cutoff = now_ms().saturating_sub(STALE_AFTER_MS);
        let statuses = sqlx::query("SELECT session_id, workspace_id, terminal_id, pane_id, run_id, task_id, participant_address, adapter_id, state, source, summary, sequence, updated_at_unix_ms FROM hiveory_code_agent_pane_statuses WHERE workspace_id=? AND updated_at_unix_ms < ? AND state IN ('starting', 'working', 'waiting', 'blocked', 'idle')")
            .bind(workspace_id)
            .bind(cutoff)
            .fetch_all(self.pool())
            .await?
            .into_iter()
            .map(status_from_row)
            .collect::<Vec<_>>();
        for current in statuses {
            self.upsert_code_agent_pane_status(&CodeAgentPaneStatus {
                state: CodeAgentPaneStatusState::Unknown,
                source: CodeAgentPaneStatusSource::Host,
                summary: Some("No lifecycle update for 30 minutes; status is unknown.".to_owned()),
                sequence: 0,
                updated_at_unix_ms: 0,
                ..current
            })
            .await?;
        }
        Ok(())
    }
}

fn status_from_row(row: sqlx::sqlite::SqliteRow) -> CodeAgentPaneStatus {
    CodeAgentPaneStatus {
        session_id: row.get(0),
        workspace_id: row.get(1),
        terminal_id: row.get(2),
        pane_id: row.get(3),
        run_id: row.get(4),
        task_id: row.get(5),
        participant_address: row.get(6),
        adapter_id: row.get(7),
        state: parse_status_state(&row.get::<String, _>(8)),
        source: parse_status_source(&row.get::<String, _>(9)),
        summary: row.get(10),
        sequence: row.get::<i64, _>(11).max(0) as u64,
        updated_at_unix_ms: row.get(12),
    }
}

fn status_state_value(value: CodeAgentPaneStatusState) -> &'static str {
    match value {
        CodeAgentPaneStatusState::Starting => "starting",
        CodeAgentPaneStatusState::Working => "working",
        CodeAgentPaneStatusState::Waiting => "waiting",
        CodeAgentPaneStatusState::Blocked => "blocked",
        CodeAgentPaneStatusState::Idle => "idle",
        CodeAgentPaneStatusState::Completed => "completed",
        CodeAgentPaneStatusState::Exited => "exited",
        CodeAgentPaneStatusState::Failed => "failed",
        CodeAgentPaneStatusState::Unknown => "unknown",
    }
}
fn parse_status_state(value: &str) -> CodeAgentPaneStatusState {
    match value {
        "starting" => CodeAgentPaneStatusState::Starting,
        "working" => CodeAgentPaneStatusState::Working,
        "waiting" => CodeAgentPaneStatusState::Waiting,
        "blocked" => CodeAgentPaneStatusState::Blocked,
        "idle" => CodeAgentPaneStatusState::Idle,
        "completed" => CodeAgentPaneStatusState::Completed,
        "exited" => CodeAgentPaneStatusState::Exited,
        "failed" => CodeAgentPaneStatusState::Failed,
        _ => CodeAgentPaneStatusState::Unknown,
    }
}
fn status_source_value(value: CodeAgentPaneStatusSource) -> &'static str {
    match value {
        CodeAgentPaneStatusSource::Host => "host",
        CodeAgentPaneStatusSource::CliReport => "cli_report",
        CodeAgentPaneStatusSource::AdapterHook => "adapter_hook",
    }
}
fn parse_status_source(value: &str) -> CodeAgentPaneStatusSource {
    match value {
        "cli_report" => CodeAgentPaneStatusSource::CliReport,
        "adapter_hook" => CodeAgentPaneStatusSource::AdapterHook,
        _ => CodeAgentPaneStatusSource::Host,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hiveory_code_domain::capabilities_for_trust;
    use hiveory_protocol::{CodeWorkspaceKind, CodeWorkspaceSummary, CodeWorkspaceTrust};
    use uuid::Uuid;

    async fn fixture() -> (HiveoryPersistence, String, std::path::PathBuf) {
        let path =
            std::env::temp_dir().join(format!("hiveory-pane-status-{}.sqlite3", Uuid::now_v7()));
        let persistence = HiveoryPersistence::open(&path)
            .await
            .expect("open database");
        let workspace_id = "workspace-pane-status".to_owned();
        persistence
            .save_code_workspace(&CodeWorkspaceSummary {
                id: workspace_id.clone(),
                host_id: "local".to_owned(),
                display_name: "Pane status fixture".to_owned(),
                root_path: std::env::temp_dir().to_string_lossy().into_owned(),
                repository_name: None,
                branch: None,
                is_git_repository: false,
                trust: CodeWorkspaceTrust::Trusted,
                capabilities: capabilities_for_trust(CodeWorkspaceTrust::Trusted),
                project_id: "project-pane-status".to_owned(),
                workspace_kind: CodeWorkspaceKind::Primary,
                worktree_name: None,
                base_ref: None,
                parent_workspace_id: None,
                managed_by_app: false,
                available: true,
                unavailable_reason: None,
                updated_at_unix_ms: now_ms(),
            })
            .await
            .expect("save workspace");
        (persistence, workspace_id, path)
    }

    #[tokio::test]
    async fn cli_reports_are_monotonic_and_recovery_marks_active_status_unknown() {
        let (persistence, workspace_id, path) = fixture().await;
        persistence
            .upsert_code_agent_pane_status(&CodeAgentPaneStatus {
                session_id: "pane-session".to_owned(),
                workspace_id,
                terminal_id: Some("terminal".to_owned()),
                pane_id: Some("pane".to_owned()),
                run_id: None,
                task_id: None,
                participant_address: None,
                adapter_id: Some("codex-cli".to_owned()),
                state: CodeAgentPaneStatusState::Starting,
                source: CodeAgentPaneStatusSource::Host,
                summary: None,
                sequence: 0,
                updated_at_unix_ms: 0,
            })
            .await
            .expect("seed status");

        let working = persistence
            .report_code_agent_pane_status(
                "pane-session",
                2,
                CodeAgentPaneStatusState::Working,
                Some("Inspecting files".to_owned()),
            )
            .await
            .expect("report working");
        let stale = persistence
            .report_code_agent_pane_status(
                "pane-session",
                1,
                CodeAgentPaneStatusState::Failed,
                Some("stale".to_owned()),
            )
            .await
            .expect("ignore stale report");
        assert_eq!(stale.state, CodeAgentPaneStatusState::Working);
        assert_eq!(stale.sequence, working.sequence);

        assert_eq!(
            persistence
                .recover_code_agent_pane_statuses()
                .await
                .expect("recover"),
            1
        );
        let recovered = persistence
            .code_agent_pane_status("pane-session")
            .await
            .expect("status")
            .expect("present");
        assert_eq!(recovered.state, CodeAgentPaneStatusState::Unknown);
        assert!(recovered.sequence > working.sequence);

        persistence.close().await;
        let reopened = HiveoryPersistence::open(&path).await.expect("reopen");
        assert_eq!(
            reopened
                .code_agent_pane_status("pane-session")
                .await
                .expect("read")
                .expect("present")
                .state,
            CodeAgentPaneStatusState::Unknown
        );
        reopened.close().await;
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
    }

    #[tokio::test]
    async fn attaches_starting_status_to_every_visible_pane_launch() {
        let (persistence, workspace_id, path) = fixture().await;
        persistence
            .upsert_code_agent_pane_status(&CodeAgentPaneStatus {
                session_id: "pane-session".to_owned(),
                workspace_id,
                terminal_id: None,
                pane_id: None,
                run_id: None,
                task_id: None,
                participant_address: None,
                adapter_id: None,
                state: CodeAgentPaneStatusState::Starting,
                source: CodeAgentPaneStatusSource::Host,
                summary: Some("Coding-agent session starting".to_owned()),
                sequence: 0,
                updated_at_unix_ms: 0,
            })
            .await
            .expect("save starting status");

        let attached = persistence
            .attach_code_agent_pane_status("pane-session", "terminal-a", "pane-a", Some("opencode"))
            .await
            .expect("attach pane")
            .expect("status exists");

        assert_eq!(attached.terminal_id.as_deref(), Some("terminal-a"));
        assert_eq!(attached.pane_id.as_deref(), Some("pane-a"));
        assert_eq!(attached.adapter_id.as_deref(), Some("opencode"));
        assert_eq!(attached.state, CodeAgentPaneStatusState::Starting);
        let updated = persistence
            .update_code_agent_pane_status_for_terminal(
                "terminal-a",
                CodeAgentPaneStatusState::Working,
                "Prompt delivered to coding-agent pane",
            )
            .await
            .expect("update status")
            .expect("bound status exists");
        assert_eq!(updated.state, CodeAgentPaneStatusState::Working);
        assert_eq!(updated.pane_id.as_deref(), Some("pane-a"));
        assert_eq!(
            updated.summary.as_deref(),
            Some("Prompt delivered to coding-agent pane")
        );
        let failed = persistence
            .update_code_agent_pane_status_for_terminal(
                "terminal-a",
                CodeAgentPaneStatusState::Failed,
                "Coding-agent terminal exited with code 1.",
            )
            .await
            .expect("record terminal failure")
            .expect("bound status exists");
        assert_eq!(failed.state, CodeAgentPaneStatusState::Failed);
        assert_eq!(
            failed.summary.as_deref(),
            Some("Coding-agent terminal exited with code 1.")
        );
        assert!(persistence
            .update_code_agent_pane_status_for_terminal(
                "missing-terminal",
                CodeAgentPaneStatusState::Failed,
                "not found",
            )
            .await
            .expect("ignore missing terminal")
            .is_none());
        std::fs::remove_file(path).ok();
    }

    #[tokio::test]
    async fn adapter_hook_reports_have_independent_ordering_and_provenance() {
        let (persistence, workspace_id, path) = fixture().await;
        persistence
            .upsert_code_agent_pane_status(&CodeAgentPaneStatus {
                session_id: "hook-pane".to_owned(),
                workspace_id,
                terminal_id: None,
                pane_id: Some("pane".to_owned()),
                run_id: None,
                task_id: None,
                participant_address: None,
                adapter_id: Some("opencode".to_owned()),
                state: CodeAgentPaneStatusState::Starting,
                source: CodeAgentPaneStatusSource::Host,
                summary: None,
                sequence: 0,
                updated_at_unix_ms: 0,
            })
            .await
            .expect("seed status");
        persistence
            .report_code_agent_pane_status(
                "hook-pane",
                1,
                CodeAgentPaneStatusState::Working,
                Some("Model report".to_owned()),
            )
            .await
            .expect("model report");
        let hook = persistence
            .report_code_agent_pane_adapter_hook(
                "hook-pane",
                1,
                CodeAgentPaneStatusState::Idle,
                Some("OpenCode is ready".to_owned()),
            )
            .await
            .expect("hook report");
        assert_eq!(hook.source, CodeAgentPaneStatusSource::AdapterHook);
        assert_eq!(hook.state, CodeAgentPaneStatusState::Idle);
        let stale_hook = persistence
            .report_code_agent_pane_adapter_hook(
                "hook-pane",
                1,
                CodeAgentPaneStatusState::Failed,
                Some("stale".to_owned()),
            )
            .await
            .expect("ignore stale hook");
        assert_eq!(stale_hook.state, CodeAgentPaneStatusState::Idle);

        persistence.close().await;
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
    }
}
