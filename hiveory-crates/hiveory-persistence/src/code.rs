//! Durable Code-mode metadata. Terminal bytes are intentionally not stored.

use super::{now_ms, HiveoryPersistence};
use hiveory_code_domain::migrate_layout_v1;
use hiveory_protocol::{
    CodeDocumentSummary, CodePaneLayout, CodePreviewState, CodePreviewSummary, CodeProjectKind,
    CodeProjectSummary, CodeTerminalKind, CodeTerminalState, CodeTerminalSummary,
    CodeWorkspaceKind, CodeWorkspaceSummary, CodeWorkspaceTrust,
};
use sqlx::Row;

impl HiveoryPersistence {
    pub async fn code_projects(&self) -> Result<Vec<CodeProjectSummary>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT p.id, p.host_id, p.display_name, p.root_path, p.repository_name, p.project_kind, p.primary_workspace_id, p.current_branch, (SELECT COUNT(*) FROM hiveory_code_workspaces w WHERE w.project_id = p.id), p.available, p.unavailable_reason, p.updated_at_unix_ms FROM hiveory_code_projects p ORDER BY p.updated_at_unix_ms DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(project_from_row).collect())
    }

    pub async fn code_project(
        &self,
        project_id: &str,
    ) -> Result<Option<CodeProjectSummary>, sqlx::Error> {
        Ok(sqlx::query(
            "SELECT p.id, p.host_id, p.display_name, p.root_path, p.repository_name, p.project_kind, p.primary_workspace_id, p.current_branch, (SELECT COUNT(*) FROM hiveory_code_workspaces w WHERE w.project_id = p.id), p.available, p.unavailable_reason, p.updated_at_unix_ms FROM hiveory_code_projects p WHERE p.id=?",
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?
        .map(project_from_row))
    }

    pub async fn code_project_by_root(
        &self,
        host_id: &str,
        canonical_root_path: &str,
    ) -> Result<Option<CodeProjectSummary>, sqlx::Error> {
        Ok(sqlx::query(
            "SELECT p.id, p.host_id, p.display_name, p.root_path, p.repository_name, p.project_kind, p.primary_workspace_id, p.current_branch, (SELECT COUNT(*) FROM hiveory_code_workspaces w WHERE w.project_id = p.id), p.available, p.unavailable_reason, p.updated_at_unix_ms FROM hiveory_code_projects p WHERE p.host_id=? AND p.canonical_root_path=?",
        )
        .bind(host_id)
        .bind(canonical_root_path)
        .fetch_optional(&self.pool)
        .await?
        .map(project_from_row))
    }

    pub async fn save_code_project(&self, project: &CodeProjectSummary) -> Result<(), sqlx::Error> {
        let kind = project_kind_value(project.kind);
        sqlx::query(
            "INSERT INTO hiveory_code_projects (id, host_id, root_path, canonical_root_path, display_name, repository_name, project_kind, current_branch, primary_workspace_id, available, unavailable_reason, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET host_id=excluded.host_id, root_path=excluded.root_path, canonical_root_path=excluded.canonical_root_path, display_name=excluded.display_name, repository_name=excluded.repository_name, project_kind=excluded.project_kind, current_branch=excluded.current_branch, primary_workspace_id=excluded.primary_workspace_id, available=excluded.available, unavailable_reason=excluded.unavailable_reason, updated_at_unix_ms=excluded.updated_at_unix_ms",
        )
        .bind(&project.id)
        .bind(&project.host_id)
        .bind(&project.root_path)
        .bind(&project.root_path)
        .bind(&project.display_name)
        .bind(&project.repository_name)
        .bind(kind)
        .bind(&project.current_branch)
        .bind(&project.primary_workspace_id)
        .bind(project.available as i64)
        .bind(&project.unavailable_reason)
        .bind(project.updated_at_unix_ms)
        .bind(project.updated_at_unix_ms)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_code_project(&self, project_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM hiveory_code_projects WHERE id=?")
            .bind(project_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn code_workspaces(&self) -> Result<Vec<CodeWorkspaceSummary>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, host_id, display_name, root_path, repository_name, branch, is_git_repository, trust_state, updated_at_unix_ms, project_id, workspace_kind, worktree_name, base_ref, managed_by_app, available, unavailable_reason FROM hiveory_code_workspaces ORDER BY updated_at_unix_ms DESC",
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
            "SELECT id, host_id, display_name, root_path, repository_name, branch, is_git_repository, trust_state, updated_at_unix_ms, project_id, workspace_kind, worktree_name, base_ref, managed_by_app, available, unavailable_reason FROM hiveory_code_workspaces WHERE id=?",
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
            "INSERT INTO hiveory_code_workspaces (id, host_id, root_path, canonical_root_path, display_name, repository_name, branch, is_git_repository, trust_state, trusted_at_unix_ms, created_at_unix_ms, updated_at_unix_ms, project_id, workspace_kind, worktree_name, base_ref, managed_by_app, available, unavailable_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET host_id=excluded.host_id, root_path=excluded.root_path, canonical_root_path=excluded.canonical_root_path, display_name=excluded.display_name, repository_name=excluded.repository_name, branch=excluded.branch, is_git_repository=excluded.is_git_repository, trust_state=excluded.trust_state, trusted_at_unix_ms=excluded.trusted_at_unix_ms, updated_at_unix_ms=excluded.updated_at_unix_ms, project_id=excluded.project_id, workspace_kind=excluded.workspace_kind, worktree_name=excluded.worktree_name, base_ref=excluded.base_ref, managed_by_app=excluded.managed_by_app, available=excluded.available, unavailable_reason=excluded.unavailable_reason",
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
        .bind(&summary.project_id)
        .bind(workspace_kind_value(summary.workspace_kind))
        .bind(&summary.worktree_name)
        .bind(&summary.base_ref)
        .bind(summary.managed_by_app as i64)
        .bind(summary.available as i64)
        .bind(&summary.unavailable_reason)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_code_workspace(&self, workspace_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM hiveory_code_workspaces WHERE id=?")
            .bind(workspace_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn code_layout(
        &self,
        workspace_id: &str,
    ) -> Result<Option<CodePaneLayout>, sqlx::Error> {
        let Some(row) = sqlx::query(
            "SELECT layout_json, version, revision FROM hiveory_code_layouts WHERE workspace_id=?",
        )
        .bind(workspace_id)
        .fetch_optional(&self.pool)
        .await?
        else {
            return Ok(None);
        };
        let layout_json: String = row.get(0);
        let version: i64 = row.get(1);
        let revision: i64 = row.try_get(2).unwrap_or(0);

        let parsed: Result<CodePaneLayout, _> = serde_json::from_str(&layout_json);
        match parsed {
            Ok(mut layout) => {
                if version == 1 || layout.version == 1 {
                    let migrated = migrate_layout_v1(&layout);
                    self.save_code_layout(&migrated).await?;
                    Ok(Some(migrated))
                } else {
                    layout.revision = revision as u64;
                    Ok(Some(layout))
                }
            }
            Err(_) => {
                // If corrupted, fallback to clean migrated default
                let default = hiveory_code_domain::default_layout(workspace_id);
                self.save_code_layout(&default).await?;
                Ok(Some(default))
            }
        }
    }

    pub async fn save_code_layout(&self, layout: &CodePaneLayout) -> Result<(), sqlx::Error> {
        let layout_json = serde_json::to_string(layout)
            .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
        sqlx::query(
            "INSERT INTO hiveory_code_layouts (workspace_id, layout_json, version, revision, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET layout_json=excluded.layout_json, version=excluded.version, revision=excluded.revision, updated_at_unix_ms=excluded.updated_at_unix_ms",
        )
        .bind(&layout.workspace_id)
        .bind(layout_json)
        .bind(layout.version as i64)
        .bind(layout.revision as i64)
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn mutate_code_layout(
        &self,
        workspace_id: &str,
        expected_revision: u64,
        new_layout: &CodePaneLayout,
    ) -> Result<CodePaneLayout, sqlx::Error> {
        let mut layout = new_layout.clone();
        layout.revision = expected_revision + 1;
        let layout_json = serde_json::to_string(&layout)
            .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;

        let result = sqlx::query(
            "UPDATE hiveory_code_layouts SET layout_json=?, version=?, revision=?, updated_at_unix_ms=? WHERE workspace_id=? AND revision=?",
        )
        .bind(&layout_json)
        .bind(layout.version as i64)
        .bind(layout.revision as i64)
        .bind(now_ms())
        .bind(workspace_id)
        .bind(expected_revision as i64)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            // Check if workspace exists
            let exists =
                sqlx::query("SELECT revision FROM hiveory_code_layouts WHERE workspace_id=?")
                    .bind(workspace_id)
                    .fetch_optional(&self.pool)
                    .await?;

            if exists.is_none() && expected_revision == 0 {
                self.save_code_layout(&layout).await?;
                return Ok(layout);
            }

            return Err(sqlx::Error::Protocol(
                "layout_conflict: optimistic concurrency revision mismatch".to_owned(),
            ));
        }

        Ok(layout)
    }

    pub async fn save_code_document(
        &self,
        workspace_id: &str,
        document: &CodeDocumentSummary,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO hiveory_code_documents (workspace_id, relative_path, last_fingerprint, language, last_opened_at_unix_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id, relative_path) DO UPDATE SET last_fingerprint=excluded.last_fingerprint, language=excluded.language, last_opened_at_unix_ms=excluded.last_opened_at_unix_ms",
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
            "SELECT relative_path, language, last_fingerprint, last_opened_at_unix_ms FROM hiveory_code_documents WHERE workspace_id=? ORDER BY last_opened_at_unix_ms DESC",
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
            "INSERT INTO hiveory_code_terminals (id, workspace_id, kind, state, pid, adapter_id, model, session_id, exit_code, started_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, pid=excluded.pid, adapter_id=excluded.adapter_id, model=excluded.model, session_id=excluded.session_id, exit_code=excluded.exit_code, updated_at_unix_ms=excluded.updated_at_unix_ms",
        )
        .bind(&terminal.id)
        .bind(&terminal.workspace_id)
        .bind(terminal_kind_value(terminal.kind))
        .bind(terminal_state_value(terminal.state))
        .bind(terminal.pid.map(|pid| pid as i64))
        .bind(&terminal.adapter_id)
        .bind(&terminal.model)
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
            "SELECT id, workspace_id, kind, state, pid, adapter_id, model, session_id, exit_code, started_at_unix_ms, updated_at_unix_ms FROM hiveory_code_terminals WHERE workspace_id=? ORDER BY updated_at_unix_ms DESC LIMIT 50",
        )
        .bind(workspace_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(terminal_from_row).collect())
    }

    pub async fn mark_active_code_terminals_dormant(&self) -> Result<usize, sqlx::Error> {
        Ok(sqlx::query(
            "UPDATE hiveory_code_terminals SET state='dormant', updated_at_unix_ms=? WHERE state IN ('starting','running')",
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
            "UPDATE hiveory_code_terminals SET state=?, exit_code=?, updated_at_unix_ms=? WHERE id=?",
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
            "INSERT INTO hiveory_code_previews (id, workspace_id, url, origin, state, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET url=excluded.url, origin=excluded.origin, state=excluded.state, updated_at_unix_ms=excluded.updated_at_unix_ms",
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
            "SELECT id, workspace_id, url, origin, state FROM hiveory_code_previews WHERE workspace_id=? ORDER BY updated_at_unix_ms DESC LIMIT 20",
        )
        .bind(workspace_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(preview_from_row).collect())
    }
}

fn project_from_row(row: sqlx::sqlite::SqliteRow) -> CodeProjectSummary {
    CodeProjectSummary {
        id: row.get(0),
        host_id: row.get(1),
        display_name: row.get(2),
        root_path: row.get(3),
        repository_name: row.get(4),
        kind: match row.get::<String, _>(5).as_str() {
            "git" => CodeProjectKind::Git,
            _ => CodeProjectKind::Folder,
        },
        primary_workspace_id: row.get(6),
        current_branch: row.get(7),
        workspace_count: row.get::<i64, _>(8).max(0) as u32,
        available: row.get::<i64, _>(9) != 0,
        unavailable_reason: row.get(10),
        updated_at_unix_ms: row.get(11),
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
        capabilities: hiveory_code_domain::capabilities_for_trust(trust),
        project_id: row
            .try_get::<Option<String>, _>(9)
            .ok()
            .flatten()
            .unwrap_or_else(|| format!("legacy-project-{}", row.get::<String, _>(0))),
        workspace_kind: match row
            .try_get::<String, _>(10)
            .unwrap_or_else(|_| "primary".to_owned())
            .as_str()
        {
            "managed_worktree" => CodeWorkspaceKind::ManagedWorktree,
            "external_worktree" => CodeWorkspaceKind::ExternalWorktree,
            _ => CodeWorkspaceKind::Primary,
        },
        worktree_name: row.try_get(11).unwrap_or(None),
        base_ref: row.try_get(12).unwrap_or(None),
        managed_by_app: row.try_get::<i64, _>(13).unwrap_or(0) != 0,
        available: row.try_get::<i64, _>(14).unwrap_or(1) != 0,
        unavailable_reason: row.try_get(15).unwrap_or(None),
        updated_at_unix_ms: row.get(8),
    }
}

fn project_kind_value(kind: CodeProjectKind) -> &'static str {
    match kind {
        CodeProjectKind::Git => "git",
        CodeProjectKind::Folder => "folder",
    }
}

fn workspace_kind_value(kind: CodeWorkspaceKind) -> &'static str {
    match kind {
        CodeWorkspaceKind::Primary => "primary",
        CodeWorkspaceKind::ManagedWorktree => "managed_worktree",
        CodeWorkspaceKind::ExternalWorktree => "external_worktree",
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
            "dormant" => CodeTerminalState::Dormant,
            _ => CodeTerminalState::Interrupted,
        },
        pid: row.get::<Option<i64>, _>(4).map(|pid| pid as u32),
        adapter_id: row.get(5),
        model: row.get(6),
        session_id: row.get(7),
        exit_code: row.get(8),
        started_at_unix_ms: row.get(9),
        updated_at_unix_ms: row.get(10),
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
        CodeTerminalState::Dormant => "dormant",
    }
}

fn preview_state_value(state: CodePreviewState) -> &'static str {
    match state {
        CodePreviewState::Open => "open",
        CodePreviewState::Closed => "closed",
        CodePreviewState::Blocked => "blocked",
    }
}
