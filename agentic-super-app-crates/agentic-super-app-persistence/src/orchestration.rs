//! Durable state for Code-mode orchestration.
//!
//! The orchestration service owns policy and process lifetimes, while this
//! module owns the durable facts that survive a renderer or host restart.

use super::{now_ms, AgenticSuperAppPersistence};
use agentic_super_app_protocol::{
    CodeCheckpoint, CodeCheckpointKind, CodeCheckpointState, CodeCleanupPreview, CodeDagProposal,
    CodeDispatch, CodeDispatchState, CodeManagedWorktree, CodeManagedWorktreeState,
    CodeOrchestrationEventEnvelope, CodeOrchestrationMessage, CodeOrchestrationMessageKind,
    CodeQuestion, CodeReview, CodeReviewDecision, CodeReviewPolicy, CodeRunCreateRequest,
    CodeRunDetail, CodeRunState, CodeRunSummary, CodeTask, CodeTaskCreateRequest,
    CodeTaskDependency, CodeTaskState,
};
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

const EVENT_LIMIT: u32 = 500;

impl AgenticSuperAppPersistence {
    pub async fn orchestration_runs(
        &self,
        workspace_id: Option<&str>,
    ) -> Result<Vec<CodeRunSummary>, sqlx::Error> {
        let rows = if let Some(workspace_id) = workspace_id {
            sqlx::query(
                "SELECT id, workspace_id, title, objective, model, state, review_policy, concurrency_limit, host_concurrency_cap, created_at_unix_ms, updated_at_unix_ms, error FROM agentic_super_app_code_runs WHERE workspace_id=? ORDER BY updated_at_unix_ms DESC",
            )
            .bind(workspace_id)
            .fetch_all(self.pool())
            .await?
        } else {
            sqlx::query(
                "SELECT id, workspace_id, title, objective, model, state, review_policy, concurrency_limit, host_concurrency_cap, created_at_unix_ms, updated_at_unix_ms, error FROM agentic_super_app_code_runs ORDER BY updated_at_unix_ms DESC",
            )
            .fetch_all(self.pool())
            .await?
        };
        let mut summaries = Vec::with_capacity(rows.len());
        for row in rows {
            summaries.push(self.orchestration_summary_from_row(row).await?);
        }
        Ok(summaries)
    }

    pub async fn orchestration_run(
        &self,
        run_id: &str,
    ) -> Result<Option<CodeRunSummary>, sqlx::Error> {
        let Some(row) = sqlx::query(
            "SELECT id, workspace_id, title, objective, model, state, review_policy, concurrency_limit, host_concurrency_cap, created_at_unix_ms, updated_at_unix_ms, error FROM agentic_super_app_code_runs WHERE id=?",
        )
        .bind(run_id)
        .fetch_optional(self.pool())
        .await?
        else {
            return Ok(None);
        };
        Ok(Some(self.orchestration_summary_from_row(row).await?))
    }

    pub async fn orchestration_detail(
        &self,
        run_id: &str,
    ) -> Result<Option<CodeRunDetail>, sqlx::Error> {
        let Some(summary) = self.orchestration_run(run_id).await? else {
            return Ok(None);
        };
        let tasks = sqlx::query(
            "SELECT id, run_id, client_id, title, specification, state, position, active_dispatch_id, latest_checkpoint_id, base_checkpoint_id, attempt, error, created_at_unix_ms, updated_at_unix_ms FROM agentic_super_app_code_tasks WHERE run_id=? ORDER BY position, id",
        )
        .bind(run_id)
        .fetch_all(self.pool())
        .await?
        .into_iter()
        .map(task_from_row)
        .collect::<Vec<_>>();
        let dependencies = sqlx::query(
            "SELECT run_id, task_id, depends_on_task_id FROM agentic_super_app_code_task_dependencies WHERE run_id=? ORDER BY task_id, depends_on_task_id",
        )
        .bind(run_id)
        .fetch_all(self.pool())
        .await?
        .into_iter()
        .map(|row| CodeTaskDependency {
            run_id: row.get(0),
            task_id: row.get(1),
            depends_on_task_id: row.get(2),
        })
        .collect::<Vec<_>>();
        let dispatches = sqlx::query(
            "SELECT id, run_id, task_id, attempt, state, lease_generation, session_id, pid, worktree_id, checkpoint_id, last_heartbeat_at_unix_ms, started_at_unix_ms, updated_at_unix_ms, error, result_summary FROM agentic_super_app_code_dispatches WHERE run_id=? ORDER BY updated_at_unix_ms DESC",
        )
        .bind(run_id)
        .fetch_all(self.pool())
        .await?
        .into_iter()
        .map(dispatch_from_row)
        .collect::<Vec<_>>();
        let worktrees = sqlx::query(
            "SELECT id, run_id, task_id, dispatch_id, path, branch, base_checkpoint_id, state, dirty, locked, error, created_at_unix_ms, updated_at_unix_ms FROM agentic_super_app_code_worktrees WHERE run_id=? ORDER BY created_at_unix_ms DESC",
        )
        .bind(run_id)
        .fetch_all(self.pool())
        .await?
        .into_iter()
        .map(worktree_from_row)
        .collect::<Vec<_>>();
        let checkpoints = sqlx::query(
            "SELECT id, run_id, task_id, dispatch_id, kind, state, ref_name, commit_oid, parent_checkpoint_id, summary, created_at_unix_ms FROM agentic_super_app_code_checkpoints WHERE run_id=? ORDER BY created_at_unix_ms DESC",
        )
        .bind(run_id)
        .fetch_all(self.pool())
        .await?
        .into_iter()
        .map(checkpoint_from_row)
        .collect::<Vec<_>>();
        let reviews = sqlx::query(
            "SELECT id, run_id, task_id, checkpoint_id, decision, feedback, created_at_unix_ms FROM agentic_super_app_code_reviews WHERE run_id=? ORDER BY created_at_unix_ms DESC",
        )
        .bind(run_id)
        .fetch_all(self.pool())
        .await?
        .into_iter()
        .map(review_from_row)
        .collect::<Vec<_>>();
        let questions = sqlx::query(
            "SELECT id, run_id, task_id, dispatch_id, prompt, answer, answered, created_at_unix_ms FROM agentic_super_app_code_questions WHERE run_id=? ORDER BY created_at_unix_ms DESC",
        )
        .bind(run_id)
        .fetch_all(self.pool())
        .await?
        .into_iter()
        .map(question_from_row)
        .collect::<Vec<_>>();
        let messages = sqlx::query(
            "SELECT id, run_id, task_id, dispatch_id, kind, question_id, payload, created_at_unix_ms FROM agentic_super_app_code_messages WHERE run_id=? ORDER BY created_at_unix_ms DESC LIMIT 250",
        )
        .bind(run_id)
        .fetch_all(self.pool())
        .await?
        .into_iter()
        .map(message_from_row)
        .collect::<Vec<_>>();
        let events = self.orchestration_events(run_id, 0, EVENT_LIMIT).await?;
        let proposal =
            sqlx::query("SELECT proposal_json FROM agentic_super_app_code_runs WHERE id=?")
                .bind(run_id)
                .fetch_one(self.pool())
                .await?
                .get::<Option<String>, _>(0)
                .and_then(|json| serde_json::from_str::<CodeDagProposal>(&json).ok());
        let event_cursor = events.last().map(|event| event.sequence).unwrap_or(0);
        Ok(Some(CodeRunDetail {
            summary,
            tasks,
            dependencies,
            dispatches,
            worktrees,
            checkpoints,
            reviews,
            questions,
            messages,
            events,
            event_cursor,
            proposal,
        }))
    }

    pub async fn insert_orchestration_run(
        &self,
        request: &CodeRunCreateRequest,
        run_id: &str,
        host_cap: u8,
        concurrency_limit: u8,
    ) -> Result<(), sqlx::Error> {
        let now = now_ms();
        sqlx::query(
            "INSERT INTO agentic_super_app_code_runs (id, workspace_id, title, objective, state, review_policy, model, concurrency_limit, host_concurrency_cap, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)",
        )
        .bind(run_id)
        .bind(&request.workspace_id)
        .bind(request.title.trim())
        .bind(request.objective.trim())
        .bind(review_policy_value(request.review_policy))
        .bind(request.model.as_deref().filter(|value| !value.trim().is_empty()))
        .bind(i64::from(concurrency_limit))
        .bind(i64::from(host_cap))
        .bind(now)
        .bind(now)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn update_orchestration_run(
        &self,
        run_id: &str,
        title: &str,
        objective: &str,
        review_policy: CodeReviewPolicy,
        concurrency_limit: u8,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "UPDATE agentic_super_app_code_runs SET title=?, objective=?, review_policy=?, concurrency_limit=?, updated_at_unix_ms=? WHERE id=? AND state IN ('draft','ready','blocked','interrupted')",
        )
        .bind(title.trim())
        .bind(objective.trim())
        .bind(review_policy_value(review_policy))
        .bind(i64::from(concurrency_limit))
        .bind(now_ms())
        .bind(run_id)
        .execute(self.pool())
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn save_orchestration_proposal(
        &self,
        run_id: &str,
        proposal: &CodeDagProposal,
    ) -> Result<(), sqlx::Error> {
        let json = serde_json::to_string(proposal)
            .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
        sqlx::query(
            "UPDATE agentic_super_app_code_runs SET proposal_json=?, updated_at_unix_ms=? WHERE id=?",
        )
        .bind(json)
        .bind(now_ms())
        .bind(run_id)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn set_orchestration_source_checkpoint(
        &self,
        run_id: &str,
        checkpoint_id: &str,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "UPDATE agentic_super_app_code_runs SET source_checkpoint_id=?, updated_at_unix_ms=? WHERE id=?",
        )
        .bind(checkpoint_id)
        .bind(now_ms())
        .bind(run_id)
        .execute(self.pool())
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn set_orchestration_task_state(
        &self,
        run_id: &str,
        task_id: &str,
        state: CodeTaskState,
        active_dispatch_id: Option<&str>,
        base_checkpoint_id: Option<&str>,
        latest_checkpoint_id: Option<&str>,
        attempt: Option<u32>,
        error: Option<&str>,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "UPDATE agentic_super_app_code_tasks SET state=?, active_dispatch_id=?, base_checkpoint_id=COALESCE(?, base_checkpoint_id), latest_checkpoint_id=COALESCE(?, latest_checkpoint_id), attempt=COALESCE(?, attempt), error=?, updated_at_unix_ms=? WHERE run_id=? AND id=?",
        )
        .bind(task_state_value(state))
        .bind(active_dispatch_id)
        .bind(base_checkpoint_id)
        .bind(latest_checkpoint_id)
        .bind(attempt.map(i64::from))
        .bind(error)
        .bind(now_ms())
        .bind(run_id)
        .bind(task_id)
        .execute(self.pool())
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn set_orchestration_run_state(
        &self,
        run_id: &str,
        state: CodeRunState,
        error: Option<&str>,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "UPDATE agentic_super_app_code_runs SET state=?, error=?, updated_at_unix_ms=? WHERE id=?",
        )
        .bind(run_state_value(state))
        .bind(error)
        .bind(now_ms())
        .bind(run_id)
        .execute(self.pool())
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn cancel_active_orchestration(
        &self,
        run_id: &str,
        reason: &str,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool().begin().await?;
        let now = now_ms();
        sqlx::query(
            "UPDATE agentic_super_app_code_dispatches SET state='cancelled', error=?, updated_at_unix_ms=? WHERE run_id=? AND state IN ('preparing','running','awaiting_input','checkpointing')",
        )
        .bind(reason)
        .bind(now)
        .bind(run_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE agentic_super_app_code_tasks SET state='cancelled', active_dispatch_id=NULL, error=?, updated_at_unix_ms=? WHERE run_id=? AND state IN ('preparing','running','awaiting_input')",
        )
        .bind(reason)
        .bind(now)
        .bind(run_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn insert_orchestration_task(
        &self,
        task: &CodeTask,
        dependencies: &[CodeTaskDependency],
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool().begin().await?;
        sqlx::query(
            "INSERT INTO agentic_super_app_code_tasks (id, run_id, client_id, title, specification, state, position, active_dispatch_id, latest_checkpoint_id, base_checkpoint_id, attempt, error, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&task.id)
        .bind(&task.run_id)
        .bind(&task.client_id)
        .bind(&task.title)
        .bind(&task.specification)
        .bind(task_state_value(task.state))
        .bind(i64::from(task.position))
        .bind(&task.active_dispatch_id)
        .bind(&task.latest_checkpoint_id)
        .bind(&task.base_checkpoint_id)
        .bind(i64::from(task.attempt))
        .bind(&task.error)
        .bind(task.created_at_unix_ms)
        .bind(task.updated_at_unix_ms)
        .execute(&mut *tx)
        .await?;
        for dependency in dependencies {
            sqlx::query(
                "INSERT INTO agentic_super_app_code_task_dependencies (run_id, task_id, depends_on_task_id) VALUES (?, ?, ?)",
            )
            .bind(&dependency.run_id)
            .bind(&dependency.task_id)
            .bind(&dependency.depends_on_task_id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await
    }

    pub async fn update_orchestration_task(
        &self,
        task: &CodeTask,
        dependencies: &[CodeTaskDependency],
    ) -> Result<bool, sqlx::Error> {
        let mut tx = self.pool().begin().await?;
        let result = sqlx::query(
            "UPDATE agentic_super_app_code_tasks SET client_id=?, title=?, specification=?, state=?, position=?, active_dispatch_id=?, latest_checkpoint_id=?, base_checkpoint_id=?, attempt=?, error=?, updated_at_unix_ms=? WHERE id=? AND run_id=? AND state IN ('draft','ready','blocked','failed','interrupted')",
        )
        .bind(&task.client_id)
        .bind(&task.title)
        .bind(&task.specification)
        .bind(task_state_value(task.state))
        .bind(i64::from(task.position))
        .bind(&task.active_dispatch_id)
        .bind(&task.latest_checkpoint_id)
        .bind(&task.base_checkpoint_id)
        .bind(i64::from(task.attempt))
        .bind(&task.error)
        .bind(now_ms())
        .bind(&task.id)
        .bind(&task.run_id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 1 {
            sqlx::query(
                "DELETE FROM agentic_super_app_code_task_dependencies WHERE run_id=? AND task_id=?",
            )
            .bind(&task.run_id)
            .bind(&task.id)
            .execute(&mut *tx)
            .await?;
            for dependency in dependencies {
                sqlx::query(
                    "INSERT INTO agentic_super_app_code_task_dependencies (run_id, task_id, depends_on_task_id) VALUES (?, ?, ?)",
                )
                .bind(&dependency.run_id)
                .bind(&dependency.task_id)
                .bind(&dependency.depends_on_task_id)
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn delete_orchestration_task(
        &self,
        run_id: &str,
        task_id: &str,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "DELETE FROM agentic_super_app_code_tasks WHERE run_id=? AND id=? AND state='draft'",
        )
        .bind(run_id)
        .bind(task_id)
        .execute(self.pool())
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn claim_orchestration_dispatch(
        &self,
        dispatch: &CodeDispatch,
    ) -> Result<bool, sqlx::Error> {
        let mut tx = self.pool().begin().await?;
        let result = sqlx::query(
            "UPDATE agentic_super_app_code_tasks SET state='preparing', active_dispatch_id=?, attempt=?, error=NULL, updated_at_unix_ms=? WHERE id=? AND run_id=? AND state='ready' AND active_dispatch_id IS NULL",
        )
        .bind(&dispatch.id)
        .bind(i64::from(dispatch.attempt))
        .bind(now_ms())
        .bind(&dispatch.task_id)
        .bind(&dispatch.run_id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            tx.rollback().await?;
            return Ok(false);
        }
        sqlx::query(
            "INSERT INTO agentic_super_app_code_dispatches (id, run_id, task_id, attempt, state, lease_generation, session_id, pid, worktree_id, checkpoint_id, last_heartbeat_at_unix_ms, started_at_unix_ms, updated_at_unix_ms, error, result_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&dispatch.id)
        .bind(&dispatch.run_id)
        .bind(&dispatch.task_id)
        .bind(i64::from(dispatch.attempt))
        .bind(dispatch_state_value(dispatch.state))
        .bind(i64::try_from(dispatch.lease_generation).unwrap_or(i64::MAX))
        .bind(&dispatch.session_id)
        .bind(dispatch.pid.map(i64::from))
        .bind(&dispatch.worktree_id)
        .bind(&dispatch.checkpoint_id)
        .bind(dispatch.last_heartbeat_at_unix_ms)
        .bind(dispatch.started_at_unix_ms)
        .bind(dispatch.updated_at_unix_ms)
        .bind(&dispatch.error)
        .bind(&dispatch.result_summary)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }

    pub async fn update_orchestration_dispatch(
        &self,
        dispatch_id: &str,
        expected_lease_generation: u64,
        state: CodeDispatchState,
        session_id: Option<&str>,
        pid: Option<u32>,
        worktree_id: Option<&str>,
        checkpoint_id: Option<&str>,
        heartbeat_at: Option<i64>,
        error: Option<&str>,
        result_summary: Option<&str>,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "UPDATE agentic_super_app_code_dispatches SET state=?, session_id=?, pid=?, worktree_id=?, checkpoint_id=?, last_heartbeat_at_unix_ms=?, updated_at_unix_ms=?, error=?, result_summary=? WHERE id=? AND lease_generation=? AND state NOT IN ('succeeded','cancelled','stale')",
        )
        .bind(dispatch_state_value(state))
        .bind(session_id)
        .bind(pid.map(i64::from))
        .bind(worktree_id)
        .bind(checkpoint_id)
        .bind(heartbeat_at)
        .bind(now_ms())
        .bind(error)
        .bind(result_summary)
        .bind(dispatch_id)
        .bind(i64::try_from(expected_lease_generation).unwrap_or(i64::MAX))
        .execute(self.pool())
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn set_orchestration_task_result(
        &self,
        run_id: &str,
        task_id: &str,
        dispatch_id: &str,
        state: CodeTaskState,
        checkpoint_id: Option<&str>,
        error: Option<&str>,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "UPDATE agentic_super_app_code_tasks SET state=?, latest_checkpoint_id=?, error=?, updated_at_unix_ms=? WHERE run_id=? AND id=? AND active_dispatch_id=?",
        )
        .bind(task_state_value(state))
        .bind(checkpoint_id)
        .bind(error)
        .bind(now_ms())
        .bind(run_id)
        .bind(task_id)
        .bind(dispatch_id)
        .execute(self.pool())
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn resume_orchestration_dispatch(
        &self,
        run_id: &str,
        task_id: &str,
        dispatch_id: &str,
        expected_lease_generation: u64,
        answer: &str,
    ) -> Result<Option<u64>, sqlx::Error> {
        let mut tx = self.pool().begin().await?;
        let old_generation = i64::try_from(expected_lease_generation).unwrap_or(i64::MAX);
        let result = sqlx::query(
            "UPDATE agentic_super_app_code_dispatches SET state='running', lease_generation=lease_generation+1, updated_at_unix_ms=?, error=NULL WHERE id=? AND run_id=? AND task_id=? AND state='awaiting_input' AND lease_generation=?",
        )
        .bind(now_ms())
        .bind(dispatch_id)
        .bind(run_id)
        .bind(task_id)
        .bind(old_generation)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            tx.rollback().await?;
            return Ok(None);
        }
        sqlx::query(
            "UPDATE agentic_super_app_code_tasks SET state='running', error=NULL, updated_at_unix_ms=? WHERE run_id=? AND id=? AND active_dispatch_id=?",
        )
        .bind(now_ms())
        .bind(run_id)
        .bind(task_id)
        .bind(dispatch_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE agentic_super_app_code_questions SET answer=?, answered=1 WHERE id=(SELECT id FROM agentic_super_app_code_questions WHERE dispatch_id=? AND answered=0 ORDER BY created_at_unix_ms DESC LIMIT 1)",
        )
        .bind(answer)
        .bind(dispatch_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(Some(expected_lease_generation.saturating_add(1)))
    }

    pub async fn resume_interrupted_orchestration_dispatch(
        &self,
        run_id: &str,
        task_id: &str,
        dispatch_id: &str,
        expected_lease_generation: u64,
    ) -> Result<Option<u64>, sqlx::Error> {
        let mut tx = self.pool().begin().await?;
        let result = sqlx::query(
            "UPDATE agentic_super_app_code_dispatches SET state='running', lease_generation=lease_generation+1, updated_at_unix_ms=?, error=NULL WHERE id=? AND run_id=? AND task_id=? AND state='interrupted' AND lease_generation=?",
        )
        .bind(now_ms())
        .bind(dispatch_id)
        .bind(run_id)
        .bind(task_id)
        .bind(i64::try_from(expected_lease_generation).unwrap_or(i64::MAX))
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            tx.rollback().await?;
            return Ok(None);
        }
        sqlx::query(
            "UPDATE agentic_super_app_code_tasks SET state='running', error=NULL, updated_at_unix_ms=? WHERE run_id=? AND id=? AND active_dispatch_id=?",
        )
        .bind(now_ms())
        .bind(run_id)
        .bind(task_id)
        .bind(dispatch_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(Some(expected_lease_generation.saturating_add(1)))
    }

    pub async fn insert_orchestration_worktree(
        &self,
        worktree: &CodeManagedWorktree,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO agentic_super_app_code_worktrees (id, run_id, task_id, dispatch_id, path, branch, base_checkpoint_id, state, dirty, locked, error, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&worktree.id)
        .bind(&worktree.run_id)
        .bind(&worktree.task_id)
        .bind(&worktree.dispatch_id)
        .bind(&worktree.path)
        .bind(&worktree.branch)
        .bind(&worktree.base_checkpoint_id)
        .bind(worktree_state_value(worktree.state))
        .bind(worktree.dirty as i64)
        .bind(worktree.locked as i64)
        .bind(&worktree.error)
        .bind(worktree.created_at_unix_ms)
        .bind(worktree.updated_at_unix_ms)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn update_orchestration_worktree(
        &self,
        worktree_id: &str,
        state: CodeManagedWorktreeState,
        dirty: bool,
        locked: bool,
        error: Option<&str>,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "UPDATE agentic_super_app_code_worktrees SET state=?, dirty=?, locked=?, error=?, updated_at_unix_ms=? WHERE id=?",
        )
        .bind(worktree_state_value(state))
        .bind(dirty as i64)
        .bind(locked as i64)
        .bind(error)
        .bind(now_ms())
        .bind(worktree_id)
        .execute(self.pool())
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn insert_orchestration_checkpoint(
        &self,
        checkpoint: &CodeCheckpoint,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO agentic_super_app_code_checkpoints (id, run_id, task_id, dispatch_id, kind, state, ref_name, commit_oid, parent_checkpoint_id, summary, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&checkpoint.id)
        .bind(&checkpoint.run_id)
        .bind(&checkpoint.task_id)
        .bind(&checkpoint.dispatch_id)
        .bind(checkpoint_kind_value(checkpoint.kind))
        .bind(checkpoint_state_value(checkpoint.state))
        .bind(&checkpoint.ref_name)
        .bind(&checkpoint.commit_oid)
        .bind(&checkpoint.parent_checkpoint_id)
        .bind(&checkpoint.summary)
        .bind(checkpoint.created_at_unix_ms)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn insert_orchestration_review(
        &self,
        review: &CodeReview,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO agentic_super_app_code_reviews (id, run_id, task_id, checkpoint_id, decision, feedback, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&review.id)
        .bind(&review.run_id)
        .bind(&review.task_id)
        .bind(&review.checkpoint_id)
        .bind(review_decision_value(review.decision))
        .bind(&review.feedback)
        .bind(review.created_at_unix_ms)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn insert_orchestration_question(
        &self,
        question: &CodeQuestion,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO agentic_super_app_code_questions (id, run_id, task_id, dispatch_id, prompt, answer, answered, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&question.id)
        .bind(&question.run_id)
        .bind(&question.task_id)
        .bind(&question.dispatch_id)
        .bind(&question.prompt)
        .bind(&question.answer)
        .bind(question.answered as i64)
        .bind(question.created_at_unix_ms)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn insert_orchestration_message(
        &self,
        message: &CodeOrchestrationMessage,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO agentic_super_app_code_messages (id, run_id, task_id, dispatch_id, kind, question_id, payload, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&message.id)
        .bind(&message.run_id)
        .bind(&message.task_id)
        .bind(&message.dispatch_id)
        .bind(message_kind_value(message.kind))
        .bind(&message.question_id)
        .bind(&message.payload)
        .bind(message.created_at_unix_ms)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn insert_orchestration_event(
        &self,
        run_id: &str,
        event_id: &str,
        task_id: Option<&str>,
        dispatch_id: Option<&str>,
        lease_generation: u64,
        kind: CodeOrchestrationMessageKind,
        payload: &str,
        accepted: bool,
    ) -> Result<CodeOrchestrationEventEnvelope, sqlx::Error> {
        let mut tx = self.pool().begin().await?;
        let sequence: i64 = sqlx::query(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM agentic_super_app_code_events WHERE run_id=?",
        )
        .bind(run_id)
        .fetch_one(&mut *tx)
        .await?
        .get(0);
        let emitted_at = now_ms();
        sqlx::query(
            "INSERT OR IGNORE INTO agentic_super_app_code_events (run_id, sequence, event_id, task_id, dispatch_id, lease_generation, kind, payload, accepted, emitted_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(run_id)
        .bind(sequence)
        .bind(event_id)
        .bind(task_id)
        .bind(dispatch_id)
        .bind(i64::try_from(lease_generation).unwrap_or(i64::MAX))
        .bind(message_kind_value(kind))
        .bind(payload)
        .bind(accepted as i64)
        .bind(emitted_at)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        let row = sqlx::query(
            "SELECT run_id, sequence, event_id, task_id, dispatch_id, lease_generation, kind, payload, accepted, emitted_at_unix_ms FROM agentic_super_app_code_events WHERE event_id=?",
        )
        .bind(event_id)
        .fetch_one(self.pool())
        .await?;
        Ok(event_from_row(row))
    }

    pub async fn orchestration_events(
        &self,
        run_id: &str,
        after_sequence: u64,
        limit: u32,
    ) -> Result<Vec<CodeOrchestrationEventEnvelope>, sqlx::Error> {
        let limit = i64::from(limit.clamp(1, EVENT_LIMIT));
        Ok(sqlx::query(
            "SELECT run_id, sequence, event_id, task_id, dispatch_id, lease_generation, kind, payload, accepted, emitted_at_unix_ms FROM agentic_super_app_code_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?",
        )
        .bind(run_id)
        .bind(i64::try_from(after_sequence).unwrap_or(i64::MAX))
        .bind(limit)
        .fetch_all(self.pool())
        .await?
        .into_iter()
        .map(event_from_row)
        .collect())
    }

    pub async fn interrupt_active_orchestration(&self) -> Result<usize, sqlx::Error> {
        let now = now_ms();
        let runs = sqlx::query(
            "UPDATE agentic_super_app_code_runs SET state='interrupted', updated_at_unix_ms=? WHERE state IN ('running','preparing')",
        )
        .bind(now)
        .execute(self.pool())
        .await?
        .rows_affected() as usize;
        sqlx::query(
            "UPDATE agentic_super_app_code_dispatches SET state='interrupted', updated_at_unix_ms=?, error='Application restarted before this dispatch finished' WHERE state IN ('preparing','running','checkpointing')",
        )
        .bind(now)
        .execute(self.pool())
        .await?;
        sqlx::query(
            "UPDATE agentic_super_app_code_tasks SET state='failed', error='Application restarted before this task finished', updated_at_unix_ms=? WHERE state IN ('preparing','running')",
        )
        .bind(now)
        .execute(self.pool())
        .await?;
        Ok(runs)
    }

    async fn orchestration_summary_from_row(
        &self,
        row: sqlx::sqlite::SqliteRow,
    ) -> Result<CodeRunSummary, sqlx::Error> {
        let id: String = row.get(0);
        let task_count: i64 =
            sqlx::query("SELECT COUNT(*) FROM agentic_super_app_code_tasks WHERE run_id=?")
                .bind(&id)
                .fetch_one(self.pool())
                .await?
                .get(0);
        let completed_tasks: i64 = sqlx::query(
            "SELECT COUNT(*) FROM agentic_super_app_code_tasks WHERE run_id=? AND state='completed'",
        )
        .bind(&id)
        .fetch_one(self.pool())
        .await?
        .get(0);
        let active_dispatches: i64 = sqlx::query(
            "SELECT COUNT(*) FROM agentic_super_app_code_dispatches WHERE run_id=? AND state IN ('preparing','running','awaiting_input','checkpointing')",
        )
        .bind(&id)
        .fetch_one(self.pool())
        .await?
        .get(0);
        Ok(CodeRunSummary {
            id,
            workspace_id: row.get(1),
            title: row.get(2),
            objective: row.get(3),
            model: row.get(4),
            state: parse_run_state(row.get::<String, _>(5).as_str()),
            review_policy: parse_review_policy(row.get::<String, _>(6).as_str()),
            concurrency_limit: row.get::<i64, _>(7).clamp(1, 8) as u8,
            host_concurrency_cap: row.get::<i64, _>(8).clamp(1, 8) as u8,
            task_count: task_count.max(0) as u32,
            completed_tasks: completed_tasks.max(0) as u32,
            active_dispatches: active_dispatches.max(0) as u32,
            created_at_unix_ms: row.get(9),
            updated_at_unix_ms: row.get(10),
            error: row.get(11),
        })
    }
}

fn task_from_row(row: sqlx::sqlite::SqliteRow) -> CodeTask {
    CodeTask {
        id: row.get(0),
        run_id: row.get(1),
        client_id: row.get(2),
        title: row.get(3),
        specification: row.get(4),
        state: parse_task_state(row.get::<String, _>(5).as_str()),
        position: row.get::<i64, _>(6).max(0) as u32,
        active_dispatch_id: row.get(7),
        latest_checkpoint_id: row.get(8),
        base_checkpoint_id: row.get(9),
        attempt: row.get::<i64, _>(10).max(0) as u32,
        error: row.get(11),
        created_at_unix_ms: row.get(12),
        updated_at_unix_ms: row.get(13),
    }
}

fn dispatch_from_row(row: sqlx::sqlite::SqliteRow) -> CodeDispatch {
    CodeDispatch {
        id: row.get(0),
        run_id: row.get(1),
        task_id: row.get(2),
        attempt: row.get::<i64, _>(3).max(0) as u32,
        state: parse_dispatch_state(row.get::<String, _>(4).as_str()),
        lease_generation: row.get::<i64, _>(5).max(0) as u64,
        session_id: row.get(6),
        pid: row
            .get::<Option<i64>, _>(7)
            .map(|value| value.max(0) as u32),
        worktree_id: row.get(8),
        checkpoint_id: row.get(9),
        last_heartbeat_at_unix_ms: row.get(10),
        started_at_unix_ms: row.get(11),
        updated_at_unix_ms: row.get(12),
        error: row.get(13),
        result_summary: row.get(14),
    }
}

fn worktree_from_row(row: sqlx::sqlite::SqliteRow) -> CodeManagedWorktree {
    CodeManagedWorktree {
        id: row.get(0),
        run_id: row.get(1),
        task_id: row.get(2),
        dispatch_id: row.get(3),
        path: row.get(4),
        branch: row.get(5),
        base_checkpoint_id: row.get(6),
        state: parse_worktree_state(row.get::<String, _>(7).as_str()),
        dirty: row.get::<i64, _>(8) != 0,
        locked: row.get::<i64, _>(9) != 0,
        error: row.get(10),
        created_at_unix_ms: row.get(11),
        updated_at_unix_ms: row.get(12),
    }
}

fn checkpoint_from_row(row: sqlx::sqlite::SqliteRow) -> CodeCheckpoint {
    CodeCheckpoint {
        id: row.get(0),
        run_id: row.get(1),
        task_id: row.get(2),
        dispatch_id: row.get(3),
        kind: parse_checkpoint_kind(row.get::<String, _>(4).as_str()),
        state: parse_checkpoint_state(row.get::<String, _>(5).as_str()),
        ref_name: row.get(6),
        commit_oid: row.get(7),
        parent_checkpoint_id: row.get(8),
        summary: row.get(9),
        created_at_unix_ms: row.get(10),
    }
}

fn review_from_row(row: sqlx::sqlite::SqliteRow) -> CodeReview {
    CodeReview {
        id: row.get(0),
        run_id: row.get(1),
        task_id: row.get(2),
        checkpoint_id: row.get(3),
        decision: parse_review_decision(row.get::<String, _>(4).as_str()),
        feedback: row.get(5),
        created_at_unix_ms: row.get(6),
    }
}

fn question_from_row(row: sqlx::sqlite::SqliteRow) -> CodeQuestion {
    CodeQuestion {
        id: row.get(0),
        run_id: row.get(1),
        task_id: row.get(2),
        dispatch_id: row.get(3),
        prompt: row.get(4),
        answer: row.get(5),
        answered: row.get::<i64, _>(6) != 0,
        created_at_unix_ms: row.get(7),
    }
}

fn message_from_row(row: sqlx::sqlite::SqliteRow) -> CodeOrchestrationMessage {
    CodeOrchestrationMessage {
        id: row.get(0),
        run_id: row.get(1),
        task_id: row.get(2),
        dispatch_id: row.get(3),
        kind: parse_message_kind(row.get::<String, _>(4).as_str()),
        question_id: row.get(5),
        payload: row.get(6),
        created_at_unix_ms: row.get(7),
    }
}

fn event_from_row(row: sqlx::sqlite::SqliteRow) -> CodeOrchestrationEventEnvelope {
    CodeOrchestrationEventEnvelope {
        run_id: row.get(0),
        sequence: row.get::<i64, _>(1).max(0) as u64,
        event_id: row.get(2),
        task_id: row.get(3),
        dispatch_id: row.get(4),
        lease_generation: row.get::<i64, _>(5).max(0) as u64,
        kind: parse_message_kind(row.get::<String, _>(6).as_str()),
        payload: row.get(7),
        accepted: row.get::<i64, _>(8) != 0,
        emitted_at_unix_ms: row.get(9),
    }
}

fn run_state_value(state: CodeRunState) -> &'static str {
    match state {
        CodeRunState::Draft => "draft",
        CodeRunState::Ready => "ready",
        CodeRunState::Running => "running",
        CodeRunState::Paused => "paused",
        CodeRunState::Blocked => "blocked",
        CodeRunState::Completed => "completed",
        CodeRunState::Failed => "failed",
        CodeRunState::Cancelled => "cancelled",
        CodeRunState::Interrupted => "interrupted",
    }
}
fn parse_run_state(value: &str) -> CodeRunState {
    match value {
        "ready" => CodeRunState::Ready,
        "running" => CodeRunState::Running,
        "paused" => CodeRunState::Paused,
        "blocked" => CodeRunState::Blocked,
        "completed" => CodeRunState::Completed,
        "failed" => CodeRunState::Failed,
        "cancelled" => CodeRunState::Cancelled,
        "interrupted" => CodeRunState::Interrupted,
        _ => CodeRunState::Draft,
    }
}
fn task_state_value(state: CodeTaskState) -> &'static str {
    match state {
        CodeTaskState::Draft => "draft",
        CodeTaskState::Blocked => "blocked",
        CodeTaskState::Ready => "ready",
        CodeTaskState::Preparing => "preparing",
        CodeTaskState::Running => "running",
        CodeTaskState::AwaitingInput => "awaiting_input",
        CodeTaskState::AwaitingReview => "awaiting_review",
        CodeTaskState::Completed => "completed",
        CodeTaskState::Failed => "failed",
        CodeTaskState::Cancelled => "cancelled",
    }
}
fn parse_task_state(value: &str) -> CodeTaskState {
    match value {
        "blocked" => CodeTaskState::Blocked,
        "ready" => CodeTaskState::Ready,
        "preparing" => CodeTaskState::Preparing,
        "running" => CodeTaskState::Running,
        "awaiting_input" => CodeTaskState::AwaitingInput,
        "awaiting_review" => CodeTaskState::AwaitingReview,
        "completed" => CodeTaskState::Completed,
        "failed" => CodeTaskState::Failed,
        "cancelled" => CodeTaskState::Cancelled,
        _ => CodeTaskState::Draft,
    }
}
fn dispatch_state_value(state: CodeDispatchState) -> &'static str {
    match state {
        CodeDispatchState::Preparing => "preparing",
        CodeDispatchState::Running => "running",
        CodeDispatchState::AwaitingInput => "awaiting_input",
        CodeDispatchState::Checkpointing => "checkpointing",
        CodeDispatchState::Succeeded => "succeeded",
        CodeDispatchState::Failed => "failed",
        CodeDispatchState::Cancelled => "cancelled",
        CodeDispatchState::Interrupted => "interrupted",
        CodeDispatchState::Stale => "stale",
    }
}
fn parse_dispatch_state(value: &str) -> CodeDispatchState {
    match value {
        "running" => CodeDispatchState::Running,
        "awaiting_input" => CodeDispatchState::AwaitingInput,
        "checkpointing" => CodeDispatchState::Checkpointing,
        "succeeded" => CodeDispatchState::Succeeded,
        "failed" => CodeDispatchState::Failed,
        "cancelled" => CodeDispatchState::Cancelled,
        "interrupted" => CodeDispatchState::Interrupted,
        "stale" => CodeDispatchState::Stale,
        _ => CodeDispatchState::Preparing,
    }
}
fn review_policy_value(policy: CodeReviewPolicy) -> &'static str {
    match policy {
        CodeReviewPolicy::Manual => "manual",
        CodeReviewPolicy::Automatic => "automatic",
    }
}
fn parse_review_policy(value: &str) -> CodeReviewPolicy {
    if value == "automatic" {
        CodeReviewPolicy::Automatic
    } else {
        CodeReviewPolicy::Manual
    }
}
fn worktree_state_value(state: CodeManagedWorktreeState) -> &'static str {
    match state {
        CodeManagedWorktreeState::Provisioning => "provisioning",
        CodeManagedWorktreeState::Ready => "ready",
        CodeManagedWorktreeState::CleanupPending => "cleanup_pending",
        CodeManagedWorktreeState::Removed => "removed",
        CodeManagedWorktreeState::Failed => "failed",
    }
}
fn parse_worktree_state(value: &str) -> CodeManagedWorktreeState {
    match value {
        "ready" => CodeManagedWorktreeState::Ready,
        "cleanup_pending" => CodeManagedWorktreeState::CleanupPending,
        "removed" => CodeManagedWorktreeState::Removed,
        "failed" => CodeManagedWorktreeState::Failed,
        _ => CodeManagedWorktreeState::Provisioning,
    }
}
fn checkpoint_kind_value(kind: CodeCheckpointKind) -> &'static str {
    match kind {
        CodeCheckpointKind::Source => "source",
        CodeCheckpointKind::Result => "result",
        CodeCheckpointKind::Integration => "integration",
    }
}
fn parse_checkpoint_kind(value: &str) -> CodeCheckpointKind {
    match value {
        "result" => CodeCheckpointKind::Result,
        "integration" => CodeCheckpointKind::Integration,
        _ => CodeCheckpointKind::Source,
    }
}
fn checkpoint_state_value(state: CodeCheckpointState) -> &'static str {
    match state {
        CodeCheckpointState::Creating => "creating",
        CodeCheckpointState::Ready => "ready",
        CodeCheckpointState::Failed => "failed",
    }
}
fn parse_checkpoint_state(value: &str) -> CodeCheckpointState {
    match value {
        "ready" => CodeCheckpointState::Ready,
        "failed" => CodeCheckpointState::Failed,
        _ => CodeCheckpointState::Creating,
    }
}
fn review_decision_value(decision: CodeReviewDecision) -> &'static str {
    match decision {
        CodeReviewDecision::Accept => "accept",
        CodeReviewDecision::RequestChanges => "request_changes",
        CodeReviewDecision::Reject => "reject",
    }
}
fn parse_review_decision(value: &str) -> CodeReviewDecision {
    match value {
        "request_changes" => CodeReviewDecision::RequestChanges,
        "reject" => CodeReviewDecision::Reject,
        _ => CodeReviewDecision::Accept,
    }
}
fn message_kind_value(kind: CodeOrchestrationMessageKind) -> &'static str {
    match kind {
        CodeOrchestrationMessageKind::Status => "status",
        CodeOrchestrationMessageKind::Heartbeat => "heartbeat",
        CodeOrchestrationMessageKind::Question => "question",
        CodeOrchestrationMessageKind::Answer => "answer",
        CodeOrchestrationMessageKind::Escalation => "escalation",
        CodeOrchestrationMessageKind::Progress => "progress",
        CodeOrchestrationMessageKind::Completion => "completion",
    }
}
fn parse_message_kind(value: &str) -> CodeOrchestrationMessageKind {
    match value {
        "heartbeat" => CodeOrchestrationMessageKind::Heartbeat,
        "question" => CodeOrchestrationMessageKind::Question,
        "answer" => CodeOrchestrationMessageKind::Answer,
        "escalation" => CodeOrchestrationMessageKind::Escalation,
        "progress" => CodeOrchestrationMessageKind::Progress,
        "completion" => CodeOrchestrationMessageKind::Completion,
        _ => CodeOrchestrationMessageKind::Status,
    }
}

#[allow(dead_code)]
fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::now_v7())
}

#[allow(dead_code)]
fn json_string(value: &Value) -> String {
    value.to_string()
}

#[allow(dead_code)]
fn cleanup_preview_placeholder() -> CodeCleanupPreview {
    CodeCleanupPreview {
        worktree_id: String::new(),
        path: String::new(),
        branch: String::new(),
        dirty_files: Vec::new(),
        locked: false,
        can_remove: false,
        reason: None,
    }
}

#[allow(dead_code)]
fn task_create_placeholder() -> CodeTaskCreateRequest {
    CodeTaskCreateRequest {
        run_id: String::new(),
        client_id: None,
        title: String::new(),
        specification: String::new(),
        depends_on: Vec::new(),
    }
}
