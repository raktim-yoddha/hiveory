//! Durable, timezone-aware routine scheduling.

use agentic_super_app_agent_runtime::AgenticSuperAppAgentRuntime;
use agentic_super_app_notification_service::AgenticSuperAppNotificationService;
use agentic_super_app_persistence::routine::{
    AgenticSuperAppRoutineStore, AgenticSuperAppRoutineStoreError,
};
use agentic_super_app_protocol::{
    AgentRunStartRequest, AgentRunState, AgentRunSummary, RoutineCatchUpPolicy,
    RoutineCreateRequest, RoutineDeliveryDestination, RoutineDetail, RoutineExecution,
    RoutineExecutionState, RoutineIdRequest, RoutineQuery, RoutineSummary, RoutineUpdateRequest,
};
use async_trait::async_trait;
use chrono::{DateTime, Datelike, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use std::{collections::BTreeSet, str::FromStr, sync::Arc, time::Duration};
use thiserror::Error;
use tokio_util::sync::CancellationToken;

const RECONCILE_INTERVAL: Duration = Duration::from_secs(30);
const MAX_MISSED_OCCURRENCES: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoutineOccurrence {
    pub scheduled_for_unix_ms: i64,
    pub occurrence_key: String,
}

#[derive(Debug, Error)]
pub enum AgenticSuperAppRoutineSchedulerError {
    #[error("routine store failure: {0}")]
    Store(#[from] AgenticSuperAppRoutineStoreError),
    #[error("routine schedule is invalid: {0}")]
    InvalidSchedule(String),
    #[error("routine launcher failed: {0}")]
    Launcher(String),
}

#[async_trait]
pub trait RoutineRunLauncher: Send + Sync {
    async fn launch(&self, request: AgentRunStartRequest) -> Result<AgentRunSummary, String>;

    async fn state(&self, run_id: &str) -> Result<Option<AgentRunState>, String>;
}

#[async_trait]
impl RoutineRunLauncher for AgenticSuperAppAgentRuntime {
    async fn launch(&self, request: AgentRunStartRequest) -> Result<AgentRunSummary, String> {
        self.start_run(&request)
            .await
            .map_err(|error| error.to_string())
    }

    async fn state(&self, run_id: &str) -> Result<Option<AgentRunState>, String> {
        self.store()
            .run(run_id)
            .await
            .map(|run| run.map(|summary| summary.state))
            .map_err(|error| error.to_string())
    }
}

#[derive(Clone)]
pub struct AgenticSuperAppRoutineScheduler {
    store: AgenticSuperAppRoutineStore,
    notifications: AgenticSuperAppNotificationService,
    launcher: Arc<dyn RoutineRunLauncher>,
    shutdown: CancellationToken,
}

impl AgenticSuperAppRoutineScheduler {
    pub fn new(
        persistence: agentic_super_app_persistence::AgenticSuperAppPersistence,
        notifications: AgenticSuperAppNotificationService,
        launcher: Arc<dyn RoutineRunLauncher>,
    ) -> Self {
        Self {
            store: AgenticSuperAppRoutineStore::new(persistence),
            notifications,
            launcher,
            shutdown: CancellationToken::new(),
        }
    }

    pub async fn run(&self) {
        self.reconcile().await;
        let mut interval = tokio::time::interval(RECONCILE_INTERVAL);
        interval.tick().await;
        loop {
            tokio::select! {
                _ = self.shutdown.cancelled() => break,
                _ = interval.tick() => self.reconcile().await,
            }
        }
    }

    pub fn stop(&self) {
        self.shutdown.cancel();
    }

    pub async fn list(
        &self,
        query: &RoutineQuery,
    ) -> Result<Vec<RoutineSummary>, AgenticSuperAppRoutineSchedulerError> {
        Ok(self.store.list(query).await?)
    }

    pub async fn detail(
        &self,
        routine_id: &str,
    ) -> Result<RoutineDetail, AgenticSuperAppRoutineSchedulerError> {
        Ok(self.store.detail(routine_id).await?)
    }

    pub async fn create(
        &self,
        request: &RoutineCreateRequest,
    ) -> Result<RoutineDetail, AgenticSuperAppRoutineSchedulerError> {
        let next_run = if request.enabled {
            next_occurrence(
                &request.schedule.expression,
                &request.schedule.timezone,
                now_ms(),
            )?
            .map(|occurrence| occurrence.scheduled_for_unix_ms)
        } else {
            None
        };
        Ok(self.store.create(request, next_run).await?)
    }

    pub async fn update(
        &self,
        request: &RoutineUpdateRequest,
    ) -> Result<RoutineDetail, AgenticSuperAppRoutineSchedulerError> {
        let next_run = if request.enabled {
            next_occurrence(
                &request.schedule.expression,
                &request.schedule.timezone,
                now_ms(),
            )?
            .map(|occurrence| occurrence.scheduled_for_unix_ms)
        } else {
            None
        };
        Ok(self.store.update(request, next_run).await?)
    }

    pub async fn archive(
        &self,
        request: &RoutineIdRequest,
    ) -> Result<(), AgenticSuperAppRoutineSchedulerError> {
        Ok(self.store.set_archived(&request.routine_id, true).await?)
    }

    pub async fn run_now(
        &self,
        routine_id: &str,
    ) -> Result<RoutineExecution, AgenticSuperAppRoutineSchedulerError> {
        let execution = self
            .store
            .create_manual_execution(routine_id, now_ms())
            .await?;
        self.dispatch(execution.clone()).await?;
        Ok(self
            .store
            .detail(routine_id)
            .await?
            .executions
            .into_iter()
            .find(|item| item.id == execution.id)
            .unwrap_or(execution))
    }

    pub async fn executions(
        &self,
        routine_id: &str,
        limit: u32,
    ) -> Result<Vec<RoutineExecution>, AgenticSuperAppRoutineSchedulerError> {
        Ok(self.store.executions(routine_id, limit).await?)
    }

    pub async fn reconcile_now(&self) {
        self.reconcile().await;
    }

    async fn reconcile(&self) {
        if let Err(error) = self.reconcile_active().await {
            let _ = self
                .notifications
                .create("Routine recovery failed", &error.to_string(), "error")
                .await;
        }
        let configs = match self.store.configs().await {
            Ok(configs) => configs,
            Err(error) => {
                let _ = self
                    .notifications
                    .create("Routine scheduler unavailable", &error.to_string(), "error")
                    .await;
                return;
            }
        };
        let now = now_ms();
        for routine in configs
            .into_iter()
            .filter(|routine| routine.summary.enabled)
        {
            if let Err(error) = self.reconcile_routine(&routine, now).await {
                let _ = self
                    .notifications
                    .create(
                        "Routine could not be scheduled",
                        &format!("{}: {}", routine.summary.name, error),
                        "error",
                    )
                    .await;
            }
        }
    }

    async fn reconcile_active(&self) -> Result<(), AgenticSuperAppRoutineSchedulerError> {
        let active_executions = self.store.active_executions().await?;
        for execution in active_executions
            .iter()
            .filter(|execution| execution.run_id.is_some())
        {
            let Some(run_id) = execution.run_id.as_deref() else {
                continue;
            };
            let Some(state) = self
                .launcher
                .state(run_id)
                .await
                .map_err(AgenticSuperAppRoutineSchedulerError::Launcher)?
            else {
                continue;
            };
            let delivery = self
                .store
                .detail(&execution.routine_id)
                .await?
                .summary
                .delivery;
            let mapped = match state {
                AgentRunState::Completed => Some(RoutineExecutionState::Completed),
                AgentRunState::Failed | AgentRunState::Cancelled => {
                    Some(RoutineExecutionState::Failed)
                }
                AgentRunState::AwaitingApproval => Some(RoutineExecutionState::AwaitingApproval),
                AgentRunState::Interrupted => Some(RoutineExecutionState::Interrupted),
                _ => Some(RoutineExecutionState::Running),
            };
            if let Some(mapped) = mapped {
                if mapped != execution.state {
                    let updated = self
                        .store
                        .set_execution_state(&execution.id, mapped, None, None)
                        .await?;
                    if matches!(
                        updated.state,
                        RoutineExecutionState::Completed
                            | RoutineExecutionState::Failed
                            | RoutineExecutionState::Interrupted
                    ) {
                        let severity = if updated.state == RoutineExecutionState::Completed {
                            "info"
                        } else {
                            "error"
                        };
                        let _ = self
                            .notify(
                                delivery,
                                "Routine execution updated",
                                &format!(
                                    "Execution {} is {}.",
                                    &updated.id,
                                    execution_state_label(updated.state)
                                ),
                                severity,
                            )
                            .await;
                    }
                }
            }
        }
        self.dispatch_queued().await?;
        Ok(())
    }

    async fn dispatch_queued(&self) -> Result<(), AgenticSuperAppRoutineSchedulerError> {
        let active_executions = self.store.active_executions().await?;
        for execution in active_executions
            .iter()
            .filter(|execution| execution.run_id.is_none())
        {
            let detail = self.store.detail(&execution.routine_id).await?;
            let has_active_run = active_executions.iter().any(|candidate| {
                candidate.routine_id == execution.routine_id
                    && candidate.id != execution.id
                    && candidate.run_id.is_some()
                    && matches!(
                        candidate.state,
                        RoutineExecutionState::Queued
                            | RoutineExecutionState::Running
                            | RoutineExecutionState::AwaitingApproval
                    )
            });
            if detail.summary.concurrency
                == agentic_super_app_protocol::RoutineConcurrencyPolicy::QueueOne
                && has_active_run
            {
                continue;
            }
            self.dispatch(execution.clone()).await?;
        }
        Ok(())
    }

    async fn reconcile_routine(
        &self,
        routine: &RoutineDetail,
        now: i64,
    ) -> Result<(), AgenticSuperAppRoutineSchedulerError> {
        let Some(current) = routine.summary.next_run_unix_ms else {
            return Ok(());
        };
        if current > now {
            return Ok(());
        }
        let due = due_occurrences(
            &routine.summary.schedule.expression,
            &routine.summary.schedule.timezone,
            current,
            now,
        )?;
        if due.is_empty() {
            let future = next_occurrence(
                &routine.summary.schedule.expression,
                &routine.summary.schedule.timezone,
                now,
            )?
            .map(|item| item.scheduled_for_unix_ms);
            let _ = self
                .store
                .advance_next_run(&routine.summary.id, current, future)
                .await?;
            return Ok(());
        }
        let future = next_occurrence(
            &routine.summary.schedule.expression,
            &routine.summary.schedule.timezone,
            now,
        )?
        .map(|item| item.scheduled_for_unix_ms);
        match routine.summary.catch_up {
            RoutineCatchUpPolicy::Skip => {
                let _ = self
                    .store
                    .advance_next_run(&routine.summary.id, current, future)
                    .await?;
                self.notify(
                    routine.summary.delivery,
                    "Routine missed",
                    &format!(
                        "{} had {} missed occurrence(s); catch-up is disabled.",
                        routine.summary.name,
                        due.len()
                    ),
                    "warning",
                )
                .await?;
            }
            RoutineCatchUpPolicy::RunLatest => {
                if let Some(latest) = due.last() {
                    if let Some(execution) = self
                        .store
                        .claim_occurrence(
                            &routine.summary.id,
                            current,
                            future,
                            &latest.occurrence_key,
                            latest.scheduled_for_unix_ms,
                        )
                        .await?
                    {
                        self.dispatch(execution).await?;
                    }
                }
            }
            RoutineCatchUpPolicy::RunAllBounded => {
                let mut expected = current;
                for occurrence in due {
                    let next = next_occurrence(
                        &routine.summary.schedule.expression,
                        &routine.summary.schedule.timezone,
                        occurrence.scheduled_for_unix_ms,
                    )?
                    .map(|item| item.scheduled_for_unix_ms);
                    if let Some(execution) = self
                        .store
                        .claim_occurrence(
                            &routine.summary.id,
                            expected,
                            next,
                            &occurrence.occurrence_key,
                            occurrence.scheduled_for_unix_ms,
                        )
                        .await?
                    {
                        self.dispatch(execution).await?;
                    }
                    expected = next.unwrap_or(future.unwrap_or(now.saturating_add(60_000)));
                    if expected > now {
                        break;
                    }
                }
                if expected <= now {
                    let _ = self
                        .store
                        .advance_next_run(&routine.summary.id, expected, future)
                        .await?;
                }
            }
        }
        Ok(())
    }

    async fn dispatch(
        &self,
        execution: RoutineExecution,
    ) -> Result<(), AgenticSuperAppRoutineSchedulerError> {
        let detail = self.store.detail(&execution.routine_id).await?;
        if execution.state == RoutineExecutionState::Skipped {
            let _ = self
                .notify(
                    detail.summary.delivery,
                    "Routine skipped",
                    &format!(
                        "Occurrence {} was skipped by its concurrency policy.",
                        execution.occurrence_key
                    ),
                    "warning",
                )
                .await;
            return Ok(());
        }
        let request = AgentRunStartRequest {
            agent_id: detail.summary.agent_id,
            conversation_id: None,
            prompt: detail.prompt_template,
            background: true,
            routine_execution_id: Some(execution.id.clone()),
        };
        match self.launcher.launch(request).await {
            Ok(run) => {
                self.store
                    .link_execution_run(&execution.id, &run.id)
                    .await?;
                Ok(())
            }
            Err(error) => {
                self.store
                    .set_execution_state(
                        &execution.id,
                        RoutineExecutionState::Failed,
                        Some(&error),
                        None,
                    )
                    .await?;
                self.notify(
                    detail.summary.delivery,
                    "Routine failed to start",
                    &error,
                    "error",
                )
                .await?;
                Err(AgenticSuperAppRoutineSchedulerError::Launcher(error))
            }
        }
    }

    async fn notify(
        &self,
        delivery: RoutineDeliveryDestination,
        title: &str,
        body: &str,
        severity: &str,
    ) -> Result<(), AgenticSuperAppRoutineSchedulerError> {
        let result = match delivery {
            RoutineDeliveryDestination::InApp => {
                self.notifications
                    .create_in_app(title, body, severity)
                    .await
            }
            RoutineDeliveryDestination::InAppAndNative => {
                self.notifications.create(title, body, severity).await
            }
        };
        result
            .map(|_| ())
            .map_err(|error| AgenticSuperAppRoutineSchedulerError::Launcher(error.to_string()))
    }
}

#[derive(Debug, Clone)]
struct CronExpression {
    minute: BTreeSet<u32>,
    hour: BTreeSet<u32>,
    day_of_month: BTreeSet<u32>,
    month: BTreeSet<u32>,
    day_of_week: BTreeSet<u32>,
    dom_any: bool,
    dow_any: bool,
}

impl FromStr for CronExpression {
    type Err = String;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let fields = value.split_whitespace().collect::<Vec<_>>();
        if fields.len() != 5 {
            return Err(
                "cron expressions must contain five fields: minute hour day month weekday"
                    .to_owned(),
            );
        }
        let dom_any = fields[2] == "*";
        let dow_any = fields[4] == "*";
        Ok(Self {
            minute: parse_field(fields[0], 0, 59)?,
            hour: parse_field(fields[1], 0, 23)?,
            day_of_month: parse_field(fields[2], 1, 31)?,
            month: parse_field(fields[3], 1, 12)?,
            day_of_week: parse_field(fields[4], 0, 7)?
                .into_iter()
                .map(|item| if item == 7 { 0 } else { item })
                .collect(),
            dom_any,
            dow_any,
        })
    }
}

fn parse_field(field: &str, min: u32, max: u32) -> Result<BTreeSet<u32>, String> {
    let mut values = BTreeSet::new();
    for part in field.split(',') {
        let (base, step) = if let Some((base, step)) = part.split_once('/') {
            let step = step
                .parse::<u32>()
                .map_err(|_| "cron step must be a positive integer".to_owned())?;
            if step == 0 {
                return Err("cron step must be positive".to_owned());
            }
            (base, step)
        } else {
            (part, 1)
        };
        let (start, end) = if base == "*" {
            (min, max)
        } else if let Some((start, end)) = base.split_once('-') {
            (
                start
                    .parse()
                    .map_err(|_| "cron range is invalid".to_owned())?,
                end.parse()
                    .map_err(|_| "cron range is invalid".to_owned())?,
            )
        } else {
            let value = base
                .parse()
                .map_err(|_| "cron value is invalid".to_owned())?;
            (value, value)
        };
        if start < min || end > max || start > end {
            return Err(format!("cron value must be between {min} and {max}"));
        }
        let mut value = start;
        while value <= end {
            values.insert(value);
            if end - value < step {
                break;
            }
            value += step;
        }
    }
    if values.is_empty() {
        Err("cron field cannot be empty".to_owned())
    } else {
        Ok(values)
    }
}

pub fn next_occurrence(
    expression: &str,
    timezone: &str,
    after_unix_ms: i64,
) -> Result<Option<RoutineOccurrence>, AgenticSuperAppRoutineSchedulerError> {
    let cron = expression
        .parse::<CronExpression>()
        .map_err(AgenticSuperAppRoutineSchedulerError::InvalidSchedule)?;
    let tz = timezone.parse::<Tz>().map_err(|_| {
        AgenticSuperAppRoutineSchedulerError::InvalidSchedule(format!(
            "unknown IANA timezone: {timezone}"
        ))
    })?;
    let start_seconds = after_unix_ms.div_euclid(1000);
    let mut cursor = start_seconds.div_euclid(60) * 60 + 60;
    for _ in 0..(366 * 24 * 60 * 2) {
        let Some(utc) = Utc.timestamp_opt(cursor, 0).single() else {
            break;
        };
        let local = tz.from_utc_datetime(&utc.naive_utc());
        if cron_matches(&cron, &local) {
            return Ok(Some(RoutineOccurrence {
                scheduled_for_unix_ms: cursor * 1000,
                occurrence_key: format!("{}@{}", local.format("%Y-%m-%dT%H:%M"), timezone),
            }));
        }
        cursor += 60;
    }
    Ok(None)
}

fn due_occurrences(
    expression: &str,
    timezone: &str,
    first_unix_ms: i64,
    now_unix_ms: i64,
) -> Result<Vec<RoutineOccurrence>, AgenticSuperAppRoutineSchedulerError> {
    let mut occurrences = Vec::new();
    let mut cursor = first_unix_ms.saturating_sub(60_000);
    let mut seen = BTreeSet::new();
    while occurrences.len() < MAX_MISSED_OCCURRENCES {
        let Some(next) = next_occurrence(expression, timezone, cursor)? else {
            break;
        };
        if next.scheduled_for_unix_ms > now_unix_ms {
            break;
        }
        cursor = next.scheduled_for_unix_ms;
        if seen.insert(next.occurrence_key.clone()) {
            occurrences.push(next);
        }
    }
    Ok(occurrences)
}

fn cron_matches<TzValue: TimeZone>(cron: &CronExpression, local: &DateTime<TzValue>) -> bool
where
    TzValue::Offset: std::fmt::Display,
{
    let minute = local.minute();
    let hour = local.hour();
    let dom = local.day();
    let month = local.month();
    let dow = local.weekday().num_days_from_sunday();
    if !cron.minute.contains(&minute) || !cron.hour.contains(&hour) || !cron.month.contains(&month)
    {
        return false;
    }
    let dom_match = cron.day_of_month.contains(&dom);
    let dow_match = cron.day_of_week.contains(&dow);
    if cron.dom_any && cron.dow_any {
        true
    } else if cron.dom_any {
        dow_match
    } else if cron.dow_any {
        dom_match
    } else {
        dom_match || dow_match
    }
}

fn execution_state_label(state: RoutineExecutionState) -> &'static str {
    match state {
        RoutineExecutionState::Queued => "queued",
        RoutineExecutionState::Running => "running",
        RoutineExecutionState::AwaitingApproval => "awaiting approval",
        RoutineExecutionState::Completed => "completed",
        RoutineExecutionState::Failed => "failed",
        RoutineExecutionState::Skipped => "skipped",
        RoutineExecutionState::Interrupted => "interrupted",
        RoutineExecutionState::UnknownOutcome => "unknown outcome",
    }
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::next_occurrence;

    #[test]
    fn computes_weekday_schedule_in_named_timezone() {
        let next = next_occurrence("0 9 * * 1-5", "Asia/Kolkata", 1_756_184_400_000)
            .expect("valid schedule")
            .expect("next occurrence");
        assert!(next.occurrence_key.ends_with("@Asia/Kolkata"));
        assert!(next.scheduled_for_unix_ms > 1_756_184_400_000);
    }

    #[test]
    fn rejects_non_five_field_schedules() {
        assert!(next_occurrence("every morning", "UTC", 0).is_err());
    }
}
