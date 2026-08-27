use agentic_super_app_protocol::{
    RoutineCatchUpPolicy, RoutineConcurrencyPolicy, RoutineCreateRequest,
    RoutineDeliveryDestination, RoutineDetail, RoutineExecution, RoutineExecutionState,
    RoutineQuery, RoutineSchedule, RoutineSummary, RoutineUpdateRequest,
};
use sqlx::{sqlite::SqliteRow, QueryBuilder, Row, Sqlite};
use thiserror::Error;
use uuid::Uuid;

const DEFAULT_LIMIT: u32 = 100;

#[derive(Debug, Error)]
pub enum AgenticSuperAppRoutineStoreError {
    #[error("routine was not found")]
    NotFound,
    #[error("routine input is invalid: {0}")]
    InvalidInput(String),
    #[error("routine conflicts with existing durable state")]
    Conflict,
    #[error("database failure: {0}")]
    Database(#[from] sqlx::Error),
    #[error("serialization failure: {0}")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Clone)]
pub struct AgenticSuperAppRoutineStore {
    persistence: super::AgenticSuperAppPersistence,
}

impl AgenticSuperAppRoutineStore {
    pub fn new(persistence: super::AgenticSuperAppPersistence) -> Self {
        Self { persistence }
    }

    pub fn persistence(&self) -> &super::AgenticSuperAppPersistence {
        &self.persistence
    }

    pub async fn create(
        &self,
        request: &RoutineCreateRequest,
        next_run_unix_ms: Option<i64>,
    ) -> Result<RoutineDetail, AgenticSuperAppRoutineStoreError> {
        validate_request(
            &request.name,
            &request.prompt_template,
            &request.schedule,
            request.max_duration_seconds,
            request.max_tool_calls,
            request.approval_timeout_seconds,
        )?;
        self.ensure_agent(&request.agent_id).await?;
        self.ensure_folder_grants(&request.agent_id, &request.folder_grant_ids)
            .await?;
        let id = Uuid::now_v7().to_string();
        let now = now_ms();
        let result = sqlx::query(
            "INSERT INTO agentic_super_app_routines (id, name, description, agent_id, prompt_template, schedule_expression, timezone, enabled, archived, catch_up, concurrency, delivery, folder_grant_ids_json, plugin_tool_names_json, max_duration_seconds, max_tool_calls, approval_timeout_seconds, next_run_unix_ms, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(request.name.trim())
        .bind(request.description.trim())
        .bind(&request.agent_id)
        .bind(request.prompt_template.trim())
        .bind(request.schedule.expression.trim())
        .bind(request.schedule.timezone.trim())
        .bind(if request.enabled { 1 } else { 0 })
        .bind(catch_up_value(request.catch_up))
        .bind(concurrency_value(request.concurrency))
        .bind(delivery_value(request.delivery))
        .bind(serde_json::to_string(&request.folder_grant_ids)?)
        .bind(serde_json::to_string(&request.plugin_tool_names)?)
        .bind(i64::from(request.max_duration_seconds))
        .bind(i64::from(request.max_tool_calls))
        .bind(i64::from(request.approval_timeout_seconds))
        .bind(next_run_unix_ms)
        .bind(now)
        .bind(now)
        .execute(self.persistence.pool())
        .await;
        match result {
            Ok(_) => self.detail(&id).await,
            Err(sqlx::Error::Database(error)) if error.message().contains("FOREIGN KEY") => {
                Err(AgenticSuperAppRoutineStoreError::NotFound)
            }
            Err(sqlx::Error::Database(error)) if error.message().contains("UNIQUE") => {
                Err(AgenticSuperAppRoutineStoreError::Conflict)
            }
            Err(error) => Err(error.into()),
        }
    }

    pub async fn update(
        &self,
        request: &RoutineUpdateRequest,
        next_run_unix_ms: Option<i64>,
    ) -> Result<RoutineDetail, AgenticSuperAppRoutineStoreError> {
        validate_request(
            &request.name,
            &request.prompt_template,
            &request.schedule,
            request.max_duration_seconds,
            request.max_tool_calls,
            request.approval_timeout_seconds,
        )?;
        self.ensure_agent(&request.agent_id).await?;
        self.ensure_folder_grants(&request.agent_id, &request.folder_grant_ids)
            .await?;
        let result = sqlx::query(
            "UPDATE agentic_super_app_routines SET name=?, description=?, agent_id=?, prompt_template=?, schedule_expression=?, timezone=?, enabled=?, catch_up=?, concurrency=?, delivery=?, folder_grant_ids_json=?, plugin_tool_names_json=?, max_duration_seconds=?, max_tool_calls=?, approval_timeout_seconds=?, next_run_unix_ms=?, updated_at_unix_ms=? WHERE id=? AND archived=0",
        )
        .bind(request.name.trim())
        .bind(request.description.trim())
        .bind(&request.agent_id)
        .bind(request.prompt_template.trim())
        .bind(request.schedule.expression.trim())
        .bind(request.schedule.timezone.trim())
        .bind(if request.enabled { 1 } else { 0 })
        .bind(catch_up_value(request.catch_up))
        .bind(concurrency_value(request.concurrency))
        .bind(delivery_value(request.delivery))
        .bind(serde_json::to_string(&request.folder_grant_ids)?)
        .bind(serde_json::to_string(&request.plugin_tool_names)?)
        .bind(i64::from(request.max_duration_seconds))
        .bind(i64::from(request.max_tool_calls))
        .bind(i64::from(request.approval_timeout_seconds))
        .bind(next_run_unix_ms)
        .bind(now_ms())
        .bind(&request.routine_id)
        .execute(self.persistence.pool())
        .await?;
        if result.rows_affected() == 0 {
            return Err(AgenticSuperAppRoutineStoreError::NotFound);
        }
        self.detail(&request.routine_id).await
    }

    pub async fn list(
        &self,
        query: &RoutineQuery,
    ) -> Result<Vec<RoutineSummary>, AgenticSuperAppRoutineStoreError> {
        let limit = i64::from(query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, 200));
        let mut builder = QueryBuilder::<Sqlite>::new(
            "SELECT r.id, r.name, r.description, r.agent_id, COALESCE(a.name, 'Unknown Agent'), r.schedule_expression, r.timezone, r.enabled, r.archived, r.catch_up, r.concurrency, r.delivery, r.next_run_unix_ms, r.last_run_unix_ms, r.last_execution_state, r.created_at_unix_ms, r.updated_at_unix_ms FROM agentic_super_app_routines r LEFT JOIN agentic_super_app_agents a ON a.id=r.agent_id WHERE 1=1",
        );
        if !query.include_archived {
            builder.push(" AND r.archived=0");
        }
        if let Some(enabled) = query.enabled {
            builder
                .push(" AND r.enabled=")
                .push_bind(if enabled { 1 } else { 0 });
        }
        builder.push(" ORDER BY COALESCE(r.next_run_unix_ms, 9223372036854775807), r.updated_at_unix_ms DESC LIMIT ").push_bind(limit);
        let rows = builder.build().fetch_all(self.persistence.pool()).await?;
        Ok(rows.iter().map(summary_from_row).collect())
    }

    pub async fn detail(
        &self,
        routine_id: &str,
    ) -> Result<RoutineDetail, AgenticSuperAppRoutineStoreError> {
        let row = self
            .routine_row(routine_id)
            .await?
            .ok_or(AgenticSuperAppRoutineStoreError::NotFound)?;
        let executions = self.executions(routine_id, 50).await?;
        Ok(detail_from_row(&row, executions))
    }

    pub async fn configs(&self) -> Result<Vec<RoutineDetail>, AgenticSuperAppRoutineStoreError> {
        let rows = sqlx::query(
            "SELECT r.id, r.name, r.description, r.agent_id, COALESCE(a.name, 'Unknown Agent'), r.schedule_expression, r.timezone, r.enabled, r.archived, r.catch_up, r.concurrency, r.delivery, r.next_run_unix_ms, r.last_run_unix_ms, r.last_execution_state, r.created_at_unix_ms, r.updated_at_unix_ms, r.prompt_template, r.folder_grant_ids_json, r.plugin_tool_names_json, r.max_duration_seconds, r.max_tool_calls, r.approval_timeout_seconds FROM agentic_super_app_routines r LEFT JOIN agentic_super_app_agents a ON a.id=r.agent_id WHERE r.archived=0 ORDER BY r.updated_at_unix_ms DESC",
        )
        .fetch_all(self.persistence.pool())
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| detail_from_row(&row, Vec::new()))
            .collect())
    }

    pub async fn set_archived(
        &self,
        routine_id: &str,
        archived: bool,
    ) -> Result<(), AgenticSuperAppRoutineStoreError> {
        let result = sqlx::query(
            "UPDATE agentic_super_app_routines SET archived=?, enabled=CASE WHEN ?=1 THEN 0 ELSE enabled END, updated_at_unix_ms=? WHERE id=?",
        )
        .bind(if archived { 1 } else { 0 })
        .bind(if archived { 1 } else { 0 })
        .bind(now_ms())
        .bind(routine_id)
        .execute(self.persistence.pool())
        .await?;
        if result.rows_affected() == 0 {
            return Err(AgenticSuperAppRoutineStoreError::NotFound);
        }
        Ok(())
    }

    pub async fn executions(
        &self,
        routine_id: &str,
        limit: u32,
    ) -> Result<Vec<RoutineExecution>, AgenticSuperAppRoutineStoreError> {
        let rows = sqlx::query("SELECT id, routine_id, run_id, occurrence_key, scheduled_for_unix_ms, state, folder_grant_ids_json, plugin_tool_names_json, error, report, created_at_unix_ms, updated_at_unix_ms, started_at_unix_ms, completed_at_unix_ms FROM agentic_super_app_routine_executions WHERE routine_id=? ORDER BY scheduled_for_unix_ms DESC LIMIT ?")
            .bind(routine_id)
            .bind(i64::from(limit.clamp(1, 200)))
            .fetch_all(self.persistence.pool())
            .await?;
        rows.into_iter().map(execution_from_row).collect()
    }

    pub async fn execution_for_run(
        &self,
        run_id: &str,
    ) -> Result<Option<RoutineExecution>, AgenticSuperAppRoutineStoreError> {
        let row = sqlx::query("SELECT id, routine_id, run_id, occurrence_key, scheduled_for_unix_ms, state, folder_grant_ids_json, plugin_tool_names_json, error, report, created_at_unix_ms, updated_at_unix_ms, started_at_unix_ms, completed_at_unix_ms FROM agentic_super_app_routine_executions WHERE run_id=? OR id=(SELECT routine_execution_id FROM agentic_super_app_agent_runs WHERE id=?)")
            .bind(run_id)
            .bind(run_id)
            .fetch_optional(self.persistence.pool())
            .await?;
        row.map(execution_from_row).transpose()
    }

    pub async fn execution_by_id(
        &self,
        execution_id: &str,
    ) -> Result<Option<RoutineExecution>, AgenticSuperAppRoutineStoreError> {
        let row = sqlx::query("SELECT id, routine_id, run_id, occurrence_key, scheduled_for_unix_ms, state, folder_grant_ids_json, plugin_tool_names_json, error, report, created_at_unix_ms, updated_at_unix_ms, started_at_unix_ms, completed_at_unix_ms FROM agentic_super_app_routine_executions WHERE id=?")
            .bind(execution_id)
            .fetch_optional(self.persistence.pool())
            .await?;
        row.map(execution_from_row).transpose()
    }

    pub async fn advance_next_run(
        &self,
        routine_id: &str,
        expected_next_run_unix_ms: i64,
        next_run_unix_ms: Option<i64>,
    ) -> Result<bool, AgenticSuperAppRoutineStoreError> {
        let result = sqlx::query("UPDATE agentic_super_app_routines SET next_run_unix_ms=?, updated_at_unix_ms=? WHERE id=? AND enabled=1 AND archived=0 AND next_run_unix_ms=?")
            .bind(next_run_unix_ms)
            .bind(now_ms())
            .bind(routine_id)
            .bind(expected_next_run_unix_ms)
            .execute(self.persistence.pool())
            .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn claim_occurrence(
        &self,
        routine_id: &str,
        expected_next_run_unix_ms: i64,
        next_run_unix_ms: Option<i64>,
        occurrence_key: &str,
        scheduled_for_unix_ms: i64,
    ) -> Result<Option<RoutineExecution>, AgenticSuperAppRoutineStoreError> {
        let mut transaction = self.persistence.pool().begin().await?;
        let Some(row) = sqlx::query("SELECT concurrency, folder_grant_ids_json, plugin_tool_names_json FROM agentic_super_app_routines WHERE id=? AND enabled=1 AND archived=0 AND next_run_unix_ms=?")
            .bind(routine_id)
            .bind(expected_next_run_unix_ms)
            .fetch_optional(&mut *transaction)
            .await? else {
                return Ok(None);
            };
        let concurrency = row.get::<String, _>(0);
        let active: i64 = sqlx::query("SELECT COUNT(*) FROM agentic_super_app_routine_executions WHERE routine_id=? AND state IN ('queued','running','awaiting_approval')")
            .bind(routine_id)
            .fetch_one(&mut *transaction)
            .await?
            .get(0);
        let queued: i64 = sqlx::query("SELECT COUNT(*) FROM agentic_super_app_routine_executions WHERE routine_id=? AND state='queued'")
            .bind(routine_id)
            .fetch_one(&mut *transaction)
            .await?
            .get(0);
        let should_skip = (concurrency == "skip" && active > 0)
            || (concurrency == "queue_one" && (active >= 2 || queued > 0))
            || (concurrency == "parallel_bounded" && active >= 4);
        let state = if should_skip {
            RoutineExecutionState::Skipped
        } else {
            RoutineExecutionState::Queued
        };
        let id = Uuid::now_v7().to_string();
        let now = now_ms();
        let state_value = execution_state_value(state);
        let result = sqlx::query("INSERT OR IGNORE INTO agentic_super_app_routine_executions (id, routine_id, occurrence_key, scheduled_for_unix_ms, state, folder_grant_ids_json, plugin_tool_names_json, created_at_unix_ms, updated_at_unix_ms, completed_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ?='skipped' THEN ? ELSE NULL END)")
            .bind(&id)
            .bind(routine_id)
            .bind(occurrence_key)
            .bind(scheduled_for_unix_ms)
            .bind(state_value)
            .bind(row.get::<String, _>(1))
            .bind(row.get::<String, _>(2))
            .bind(now)
            .bind(now)
            .bind(state_value)
            .bind(now)
            .execute(&mut *transaction)
            .await?;
        if result.rows_affected() == 0 {
            return Ok(None);
        }
        let advance = sqlx::query("UPDATE agentic_super_app_routines SET next_run_unix_ms=?, last_run_unix_ms=?, last_execution_state=?, updated_at_unix_ms=? WHERE id=? AND enabled=1 AND archived=0 AND next_run_unix_ms=?")
            .bind(next_run_unix_ms)
            .bind(scheduled_for_unix_ms)
            .bind(state_value)
            .bind(now)
            .bind(routine_id)
            .bind(expected_next_run_unix_ms)
            .execute(&mut *transaction)
            .await?;
        if advance.rows_affected() == 0 {
            transaction.rollback().await?;
            return Ok(None);
        }
        transaction.commit().await?;
        self.execution(&id).await.map(Some)
    }

    pub async fn create_manual_execution(
        &self,
        routine_id: &str,
        scheduled_for_unix_ms: i64,
    ) -> Result<RoutineExecution, AgenticSuperAppRoutineStoreError> {
        let row = sqlx::query("SELECT r.id, r.name, r.description, r.agent_id, COALESCE(a.name, 'Unknown Agent'), r.schedule_expression, r.timezone, r.enabled, r.archived, r.catch_up, r.concurrency, r.delivery, r.next_run_unix_ms, r.last_run_unix_ms, r.last_execution_state, r.created_at_unix_ms, r.updated_at_unix_ms, r.prompt_template, r.folder_grant_ids_json, r.plugin_tool_names_json, r.max_duration_seconds, r.max_tool_calls, r.approval_timeout_seconds FROM agentic_super_app_routines r LEFT JOIN agentic_super_app_agents a ON a.id=r.agent_id WHERE r.id=? AND r.archived=0")
            .bind(routine_id)
            .fetch_optional(self.persistence.pool())
            .await?
            .ok_or(AgenticSuperAppRoutineStoreError::NotFound)?;
        let folder_grant_ids: String = row.get(18);
        let plugin_tool_names: String = row.get(19);
        let id = Uuid::now_v7().to_string();
        let now = now_ms();
        sqlx::query("INSERT INTO agentic_super_app_routine_executions (id, routine_id, occurrence_key, scheduled_for_unix_ms, state, folder_grant_ids_json, plugin_tool_names_json, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)")
            .bind(&id)
            .bind(routine_id)
            .bind(format!("manual:{id}"))
            .bind(scheduled_for_unix_ms)
            .bind(folder_grant_ids)
            .bind(plugin_tool_names)
            .bind(now)
            .bind(now)
            .execute(self.persistence.pool())
            .await?;
        self.execution(&id).await
    }

    pub async fn link_execution_run(
        &self,
        execution_id: &str,
        run_id: &str,
    ) -> Result<RoutineExecution, AgenticSuperAppRoutineStoreError> {
        let result = sqlx::query("UPDATE agentic_super_app_routine_executions SET run_id=?, state='running', started_at_unix_ms=COALESCE(started_at_unix_ms, ?), updated_at_unix_ms=? WHERE id=? AND state='queued'")
            .bind(run_id)
            .bind(now_ms())
            .bind(now_ms())
            .bind(execution_id)
            .execute(self.persistence.pool())
            .await?;
        if result.rows_affected() == 0 {
            return Err(AgenticSuperAppRoutineStoreError::Conflict);
        }
        self.execution(execution_id).await
    }

    pub async fn set_execution_state(
        &self,
        execution_id: &str,
        state: RoutineExecutionState,
        error: Option<&str>,
        report: Option<&str>,
    ) -> Result<RoutineExecution, AgenticSuperAppRoutineStoreError> {
        let terminal = matches!(
            state,
            RoutineExecutionState::Completed
                | RoutineExecutionState::Failed
                | RoutineExecutionState::Skipped
                | RoutineExecutionState::Interrupted
                | RoutineExecutionState::UnknownOutcome
        );
        let now = now_ms();
        let result = sqlx::query("UPDATE agentic_super_app_routine_executions SET state=?, error=?, report=COALESCE(?, report), updated_at_unix_ms=?, completed_at_unix_ms=CASE WHEN ?=1 THEN COALESCE(completed_at_unix_ms, ?) ELSE completed_at_unix_ms END WHERE id=?")
            .bind(execution_state_value(state))
            .bind(error)
            .bind(report)
            .bind(now)
            .bind(if terminal { 1 } else { 0 })
            .bind(now)
            .bind(execution_id)
            .execute(self.persistence.pool())
            .await?;
        if result.rows_affected() == 0 {
            return Err(AgenticSuperAppRoutineStoreError::NotFound);
        }
        self.execution(execution_id).await
    }

    pub async fn active_executions(
        &self,
    ) -> Result<Vec<RoutineExecution>, AgenticSuperAppRoutineStoreError> {
        let rows = sqlx::query("SELECT id, routine_id, run_id, occurrence_key, scheduled_for_unix_ms, state, folder_grant_ids_json, plugin_tool_names_json, error, report, created_at_unix_ms, updated_at_unix_ms, started_at_unix_ms, completed_at_unix_ms FROM agentic_super_app_routine_executions WHERE state IN ('queued','running','awaiting_approval') ORDER BY created_at_unix_ms")
            .fetch_all(self.persistence.pool())
            .await?;
        rows.into_iter().map(execution_from_row).collect()
    }

    async fn execution(
        &self,
        execution_id: &str,
    ) -> Result<RoutineExecution, AgenticSuperAppRoutineStoreError> {
        let row = sqlx::query("SELECT id, routine_id, run_id, occurrence_key, scheduled_for_unix_ms, state, folder_grant_ids_json, plugin_tool_names_json, error, report, created_at_unix_ms, updated_at_unix_ms, started_at_unix_ms, completed_at_unix_ms FROM agentic_super_app_routine_executions WHERE id=?")
            .bind(execution_id)
            .fetch_optional(self.persistence.pool())
            .await?
            .ok_or(AgenticSuperAppRoutineStoreError::NotFound)?;
        execution_from_row(row)
    }

    async fn routine_row(
        &self,
        routine_id: &str,
    ) -> Result<Option<SqliteRow>, AgenticSuperAppRoutineStoreError> {
        Ok(sqlx::query("SELECT r.id, r.name, r.description, r.agent_id, COALESCE(a.name, 'Unknown Agent'), r.schedule_expression, r.timezone, r.enabled, r.archived, r.catch_up, r.concurrency, r.delivery, r.next_run_unix_ms, r.last_run_unix_ms, r.last_execution_state, r.created_at_unix_ms, r.updated_at_unix_ms, r.prompt_template, r.folder_grant_ids_json, r.plugin_tool_names_json, r.max_duration_seconds, r.max_tool_calls, r.approval_timeout_seconds FROM agentic_super_app_routines r LEFT JOIN agentic_super_app_agents a ON a.id=r.agent_id WHERE r.id=?")
            .bind(routine_id)
            .fetch_optional(self.persistence.pool())
            .await?)
    }

    async fn ensure_agent(&self, agent_id: &str) -> Result<(), AgenticSuperAppRoutineStoreError> {
        let exists =
            sqlx::query("SELECT 1 FROM agentic_super_app_agents WHERE id=? AND archived=0")
                .bind(agent_id)
                .fetch_optional(self.persistence.pool())
                .await?
                .is_some();
        if exists {
            Ok(())
        } else {
            Err(AgenticSuperAppRoutineStoreError::NotFound)
        }
    }

    async fn ensure_folder_grants(
        &self,
        agent_id: &str,
        grant_ids: &[String],
    ) -> Result<(), AgenticSuperAppRoutineStoreError> {
        for grant_id in grant_ids {
            let exists = sqlx::query(
                "SELECT 1 FROM agentic_super_app_agent_folders WHERE id=? AND agent_id=? AND (can_read=1 OR can_write=1)",
            )
            .bind(grant_id)
            .bind(agent_id)
            .fetch_optional(self.persistence.pool())
            .await?
            .is_some();
            if !exists {
                return Err(AgenticSuperAppRoutineStoreError::InvalidInput(
                    "routine contains a folder grant outside the selected Agent".to_owned(),
                ));
            }
        }
        Ok(())
    }
}

fn validate_request(
    name: &str,
    prompt: &str,
    schedule: &RoutineSchedule,
    max_duration_seconds: u32,
    max_tool_calls: u32,
    approval_timeout_seconds: u32,
) -> Result<(), AgenticSuperAppRoutineStoreError> {
    if name.trim().is_empty() || name.len() > 120 {
        return Err(AgenticSuperAppRoutineStoreError::InvalidInput(
            "routine name must be between 1 and 120 characters".to_owned(),
        ));
    }
    if prompt.trim().is_empty() || prompt.len() > 64 * 1024 {
        return Err(AgenticSuperAppRoutineStoreError::InvalidInput(
            "routine prompt must be between 1 and 64 KiB".to_owned(),
        ));
    }
    if schedule.expression.trim().is_empty() || schedule.timezone.trim().is_empty() {
        return Err(AgenticSuperAppRoutineStoreError::InvalidInput(
            "schedule expression and timezone are required".to_owned(),
        ));
    }
    if max_duration_seconds == 0 || max_tool_calls == 0 || approval_timeout_seconds == 0 {
        return Err(AgenticSuperAppRoutineStoreError::InvalidInput(
            "routine limits must be greater than zero".to_owned(),
        ));
    }
    Ok(())
}

fn summary_from_row(row: &SqliteRow) -> RoutineSummary {
    RoutineSummary {
        id: row.get(0),
        name: row.get(1),
        description: row.get(2),
        agent_id: row.get(3),
        agent_name: row.get(4),
        schedule: RoutineSchedule {
            expression: row.get(5),
            timezone: row.get(6),
        },
        enabled: row.get::<i64, _>(7) != 0,
        archived: row.get::<i64, _>(8) != 0,
        catch_up: catch_up_from_value(&row.get::<String, _>(9)),
        concurrency: concurrency_from_value(&row.get::<String, _>(10)),
        delivery: delivery_from_value(&row.get::<String, _>(11)),
        next_run_unix_ms: row.get(12),
        last_run_unix_ms: row.get(13),
        last_execution_state: row
            .get::<Option<String>, _>(14)
            .as_deref()
            .map(execution_state_from_value),
        created_at_unix_ms: row.get(15),
        updated_at_unix_ms: row.get(16),
    }
}

fn detail_from_row(row: &SqliteRow, executions: Vec<RoutineExecution>) -> RoutineDetail {
    let summary = summary_from_row(row);
    RoutineDetail {
        summary,
        prompt_template: row.get(17),
        folder_grant_ids: serde_json::from_str(&row.get::<String, _>(18)).unwrap_or_default(),
        plugin_tool_names: serde_json::from_str(&row.get::<String, _>(19)).unwrap_or_default(),
        max_duration_seconds: row.get::<i64, _>(20).max(1) as u32,
        max_tool_calls: row.get::<i64, _>(21).max(1) as u32,
        approval_timeout_seconds: row.get::<i64, _>(22).max(1) as u32,
        executions,
    }
}

fn execution_from_row(
    row: SqliteRow,
) -> Result<RoutineExecution, AgenticSuperAppRoutineStoreError> {
    Ok(RoutineExecution {
        id: row.get(0),
        routine_id: row.get(1),
        run_id: row.get(2),
        occurrence_key: row.get(3),
        scheduled_for_unix_ms: row.get(4),
        state: execution_state_from_value(&row.get::<String, _>(5)),
        folder_grant_ids: serde_json::from_str(&row.get::<String, _>(6))?,
        plugin_tool_names: serde_json::from_str(&row.get::<String, _>(7))?,
        error: row.get(8),
        report: row.get(9),
        created_at_unix_ms: row.get(10),
        updated_at_unix_ms: row.get(11),
        started_at_unix_ms: row.get(12),
        completed_at_unix_ms: row.get(13),
    })
}

fn catch_up_value(value: RoutineCatchUpPolicy) -> &'static str {
    match value {
        RoutineCatchUpPolicy::Skip => "skip",
        RoutineCatchUpPolicy::RunLatest => "run_latest",
        RoutineCatchUpPolicy::RunAllBounded => "run_all_bounded",
    }
}
fn catch_up_from_value(value: &str) -> RoutineCatchUpPolicy {
    match value {
        "run_latest" => RoutineCatchUpPolicy::RunLatest,
        "run_all_bounded" => RoutineCatchUpPolicy::RunAllBounded,
        _ => RoutineCatchUpPolicy::Skip,
    }
}
fn concurrency_value(value: RoutineConcurrencyPolicy) -> &'static str {
    match value {
        RoutineConcurrencyPolicy::Skip => "skip",
        RoutineConcurrencyPolicy::QueueOne => "queue_one",
        RoutineConcurrencyPolicy::ParallelBounded => "parallel_bounded",
    }
}
fn concurrency_from_value(value: &str) -> RoutineConcurrencyPolicy {
    match value {
        "queue_one" => RoutineConcurrencyPolicy::QueueOne,
        "parallel_bounded" => RoutineConcurrencyPolicy::ParallelBounded,
        _ => RoutineConcurrencyPolicy::Skip,
    }
}
fn delivery_value(value: RoutineDeliveryDestination) -> &'static str {
    match value {
        RoutineDeliveryDestination::InApp => "in_app",
        RoutineDeliveryDestination::InAppAndNative => "in_app_and_native",
    }
}
fn delivery_from_value(value: &str) -> RoutineDeliveryDestination {
    match value {
        "in_app_and_native" => RoutineDeliveryDestination::InAppAndNative,
        _ => RoutineDeliveryDestination::InApp,
    }
}
fn execution_state_value(value: RoutineExecutionState) -> &'static str {
    match value {
        RoutineExecutionState::Queued => "queued",
        RoutineExecutionState::Running => "running",
        RoutineExecutionState::AwaitingApproval => "awaiting_approval",
        RoutineExecutionState::Completed => "completed",
        RoutineExecutionState::Failed => "failed",
        RoutineExecutionState::Skipped => "skipped",
        RoutineExecutionState::Interrupted => "interrupted",
        RoutineExecutionState::UnknownOutcome => "unknown_outcome",
    }
}
fn execution_state_from_value(value: &str) -> RoutineExecutionState {
    match value {
        "running" => RoutineExecutionState::Running,
        "awaiting_approval" => RoutineExecutionState::AwaitingApproval,
        "completed" => RoutineExecutionState::Completed,
        "failed" => RoutineExecutionState::Failed,
        "skipped" => RoutineExecutionState::Skipped,
        "interrupted" => RoutineExecutionState::Interrupted,
        "unknown_outcome" => RoutineExecutionState::UnknownOutcome,
        _ => RoutineExecutionState::Queued,
    }
}
fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
