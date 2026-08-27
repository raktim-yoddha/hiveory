//! Durable Code-mode metadata. Terminal bytes are intentionally not stored.

use super::{now_ms, AgenticSuperAppPersistence};
use agentic_super_app_protocol::{
    CodeDocumentSummary, CodePaneLayout, CodePreviewState, CodePreviewSummary, CodeTerminalKind,
    CodeTerminalState, CodeTerminalSummary, CodeWorkspaceSummary, CodeWorkspaceTrust,
};
use sqlx::Row;

impl AgenticSuperAppPersistence {
    pub async fn code_workspaces(&self) -> Result<Vec<CodeWorkspaceSummary>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, host_id, display_name, root_path, repository_name, branch, is_git_repository, trust_state, updated_at_unix_ms FROM agentic_super_app_code_workspaces ORDER BY updated_at_unix_ms DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(workspace_from_row).collect())
    }

    pub async fn code_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Option<CodeWorkspaceSummary>, sqlx::Error> {
        Ok(sqlx::query(
            "SELECT id, host_id, display_name, root_path, repository_name, branch, is_git_repository, trust_state, updated_at_unix_ms FROM agentic_super_app_code_workspaces WHERE id=?",
        )
        .bind(workspace_id)
        .fetch_optional(&self.pool)
        .await?
        .map(workspace_from_row))
    }

    pub async fn save_code_workspace(
        &self,
        summary: &CodeWorkspaceSummary,
    ) -> Result<(), sqlx::Error> {
        let trust = match summary.trust {
            CodeWorkspaceTrust::Trusted => "trusted",
            CodeWorkspaceTrust::Untrusted => "untrusted",
        };
        let trusted_at = matches!(summary.trust, CodeWorkspaceTrust::Trusted).then_some(now_ms());
        sqlx::query(
            "INSERT INTO agentic_super_app_code_workspaces (id, host_id, root_path, canonical_root_path, display_name, repository_name, branch, is_git_repository, trust_state, trusted_at_unix_ms, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET host_id=excluded.host_id, root_path=excluded.root_path, canonical_root_path=excluded.canonical_root_path, display_name=excluded.display_name, repository_name=excluded.repository_name, branch=excluded.branch, is_git_repository=excluded.is_git_repository, trust_state=excluded.trust_state, trusted_at_unix_ms=excluded.trusted_at_unix_ms, updated_at_unix_ms=excluded.updated_at_unix_ms",
        )
        .bind(&summary.id)
        .bind(&summary.host_id)
        .bind(&summary.root_path)
        .bind(&summary.root_path)
        .bind(&summary.display_name)
        .bind(&summary.repository_name)
        .bind(&summary.branch)
        .bind(summary.is_git_repository as i64)
        .bind(trust)
        .bind(trusted_at)
        .bind(summary.updated_at_unix_ms)
        .bind(summary.updated_at_unix_ms)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn code_layout(
        &self,
        workspace_id: &str,
    ) -> Result<Option<CodePaneLayout>, sqlx::Error> {
        let Some(layout_json) = sqlx::query(
            "SELECT layout_json FROM agentic_super_app_code_layouts WHERE workspace_id=?",
        )
        .bind(workspace_id)
        .fetch_optional(&self.pool)
        .await?
        .map(|row| row.get::<String, _>(0)) else {
            return Ok(None);
        };
        serde_json::from_str(&layout_json)
            .map(Some)
            .map_err(|error| sqlx::Error::Decode(Box::new(error)))
    }

    pub async fn save_code_layout(&self, layout: &CodePaneLayout) -> Result<(), sqlx::Error> {
        let layout_json = serde_json::to_string(layout)
            .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
        sqlx::query(
            "INSERT INTO agentic_super_app_code_layouts (workspace_id, layout_json, version, updated_at_unix_ms) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET layout_json=excluded.layout_json, version=excluded.version, updated_at_unix_ms=excluded.updated_at_unix_ms",
        )
        .bind(&layout.workspace_id)
        .bind(layout_json)
        .bind(layout.version as i64)
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn save_code_document(
        &self,
        workspace_id: &str,
        document: &CodeDocumentSummary,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO agentic_super_app_code_documents (workspace_id, relative_path, last_fingerprint, language, last_opened_at_unix_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id, relative_path) DO UPDATE SET last_fingerprint=excluded.last_fingerprint, language=excluded.language, last_opened_at_unix_ms=excluded.last_opened_at_unix_ms",
        )
        .bind(workspace_id)
        .bind(&document.relative_path)
        .bind(&document.last_fingerprint)
        .bind(&document.language)
        .bind(document.last_opened_at_unix_ms)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn code_documents(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<CodeDocumentSummary>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT relative_path, language, last_fingerprint, last_opened_at_unix_ms FROM agentic_super_app_code_documents WHERE workspace_id=? ORDER BY last_opened_at_unix_ms DESC",
        )
        .bind(workspace_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| CodeDocumentSummary {
                relative_path: row.get(0),
                language: row.get(1),
                last_fingerprint: row.get(2),
                last_opened_at_unix_ms: row.get(3),
            })
            .collect())
    }

    pub async fn save_code_terminal(
        &self,
        terminal: &CodeTerminalSummary,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO agentic_super_app_code_terminals (id, workspace_id, kind, state, pid, adapter_id, session_id, exit_code, started_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, pid=excluded.pid, adapter_id=excluded.adapter_id, session_id=excluded.session_id, exit_code=excluded.exit_code, updated_at_unix_ms=excluded.updated_at_unix_ms",
        )
        .bind(&terminal.id)
        .bind(&terminal.workspace_id)
        .bind(terminal_kind_value(terminal.kind))
        .bind(terminal_state_value(terminal.state))
        .bind(terminal.pid.map(|pid| pid as i64))
        .bind(&terminal.adapter_id)
        .bind(&terminal.session_id)
        .bind(terminal.exit_code)
        .bind(terminal.started_at_unix_ms)
        .bind(terminal.updated_at_unix_ms)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn code_terminals(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<CodeTerminalSummary>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, workspace_id, kind, state, pid, adapter_id, session_id, exit_code, started_at_unix_ms, updated_at_unix_ms FROM agentic_super_app_code_terminals WHERE workspace_id=? ORDER BY updated_at_unix_ms DESC LIMIT 50",
        )
        .bind(workspace_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(terminal_from_row).collect())
    }

    pub async fn interrupt_active_code_terminals(&self) -> Result<usize, sqlx::Error> {
        Ok(sqlx::query(
            "UPDATE agentic_super_app_code_terminals SET state='interrupted', updated_at_unix_ms=? WHERE state IN ('starting','running')",
        )
        .bind(now_ms())
        .execute(&self.pool)
        .await?
        .rows_affected() as usize)
    }

    pub async fn finish_code_terminal(
        &self,
        terminal_id: &str,
        state: CodeTerminalState,
        exit_code: Option<i32>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE agentic_super_app_code_terminals SET state=?, exit_code=?, updated_at_unix_ms=? WHERE id=?",
        )
        .bind(terminal_state_value(state))
        .bind(exit_code)
        .bind(now_ms())
        .bind(terminal_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn save_code_preview(
        &self,
        preview: &CodePreviewSummary,
        now: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO agentic_super_app_code_previews (id, workspace_id, url, origin, state, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET url=excluded.url, origin=excluded.origin, state=excluded.state, updated_at_unix_ms=excluded.updated_at_unix_ms",
        )
        .bind(&preview.id)
        .bind(&preview.workspace_id)
        .bind(&preview.url)
        .bind(&preview.origin)
        .bind(preview_state_value(preview.state))
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn code_previews(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<CodePreviewSummary>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, workspace_id, url, origin, state FROM agentic_super_app_code_previews WHERE workspace_id=? ORDER BY updated_at_unix_ms DESC LIMIT 20",
        )
        .bind(workspace_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(preview_from_row).collect())
    }
}

fn workspace_from_row(row: sqlx::sqlite::SqliteRow) -> CodeWorkspaceSummary {
    let trust = if row.get::<String, _>(7) == "trusted" {
        CodeWorkspaceTrust::Trusted
    } else {
        CodeWorkspaceTrust::Untrusted
    };
    CodeWorkspaceSummary {
        id: row.get(0),
        host_id: row.get(1),
        display_name: row.get(2),
        root_path: row.get(3),
        repository_name: row.get(4),
        branch: row.get(5),
        is_git_repository: row.get::<i64, _>(6) != 0,
        trust,
        capabilities: agentic_super_app_code_domain::capabilities_for_trust(trust),
        updated_at_unix_ms: row.get(8),
    }
}

fn terminal_from_row(row: sqlx::sqlite::SqliteRow) -> CodeTerminalSummary {
    CodeTerminalSummary {
        id: row.get(0),
        workspace_id: row.get(1),
        kind: match row.get::<String, _>(2).as_str() {
            "coding_agent" => CodeTerminalKind::CodingAgent,
            _ => CodeTerminalKind::Shell,
        },
        state: match row.get::<String, _>(3).as_str() {
            "starting" => CodeTerminalState::Starting,
            "running" => CodeTerminalState::Running,
            "exited" => CodeTerminalState::Exited,
            "failed" => CodeTerminalState::Failed,
            _ => CodeTerminalState::Interrupted,
        },
        pid: row.get::<Option<i64>, _>(4).map(|pid| pid as u32),
        adapter_id: row.get(5),
        session_id: row.get(6),
        exit_code: row.get(7),
        started_at_unix_ms: row.get(8),
        updated_at_unix_ms: row.get(9),
    }
}

fn preview_from_row(row: sqlx::sqlite::SqliteRow) -> CodePreviewSummary {
    CodePreviewSummary {
        id: row.get(0),
        workspace_id: row.get(1),
        url: row.get(2),
        origin: row.get(3),
        state: match row.get::<String, _>(4).as_str() {
            "closed" => CodePreviewState::Closed,
            "blocked" => CodePreviewState::Blocked,
            _ => CodePreviewState::Open,
        },
    }
}

fn terminal_kind_value(kind: CodeTerminalKind) -> &'static str {
    match kind {
        CodeTerminalKind::Shell => "shell",
        CodeTerminalKind::CodingAgent => "coding_agent",
    }
}

fn terminal_state_value(state: CodeTerminalState) -> &'static str {
    match state {
        CodeTerminalState::Starting => "starting",
        CodeTerminalState::Running => "running",
        CodeTerminalState::Exited => "exited",
        CodeTerminalState::Failed => "failed",
        CodeTerminalState::Interrupted => "interrupted",
    }
}

fn preview_state_value(state: CodePreviewState) -> &'static str {
    match state {
        CodePreviewState::Open => "open",
        CodePreviewState::Closed => "closed",
        CodePreviewState::Blocked => "blocked",
    }
}
