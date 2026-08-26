use agentic_super_app_persistence::AgenticSuperAppPersistence;
use agentic_super_app_protocol::{JobState, JobSummary, SharedEventEnvelope, SharedEventKind};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct AgenticSuperAppJobRuntime {
    persistence: AgenticSuperAppPersistence,
    cancellations: Arc<Mutex<HashMap<String, CancellationToken>>>,
    events: broadcast::Sender<SharedEventEnvelope>,
    sequence: Arc<Mutex<u64>>,
}

impl AgenticSuperAppJobRuntime {
    pub fn new(persistence: AgenticSuperAppPersistence) -> Self {
        let (events, _) = broadcast::channel(256);
        Self {
            persistence,
            cancellations: Arc::new(Mutex::new(HashMap::new())),
            events,
            sequence: Arc::new(Mutex::new(0)),
        }
    }
    pub async fn create(&self, kind: &str) -> Result<(JobSummary, CancellationToken), sqlx::Error> {
        let job = self.persistence.create_job(kind).await?;
        let token = CancellationToken::new();
        self.cancellations
            .lock()
            .expect("job cancellation lock")
            .insert(job.id.clone(), token.clone());
        self.emit(
            SharedEventKind::JobStateChanged,
            Some(job.id.clone()),
            Some("Job queued".to_owned()),
            None,
        );
        Ok((job, token))
    }
    pub async fn transition(
        &self,
        id: &str,
        state: JobState,
        message: Option<String>,
        error_code: Option<&str>,
    ) -> Result<JobSummary, sqlx::Error> {
        let job = self.persistence.update_job(id, state, error_code).await?;
        if matches!(
            job.state,
            JobState::Completed | JobState::Failed | JobState::Cancelled | JobState::Interrupted
        ) {
            self.cancellations
                .lock()
                .expect("job cancellation lock")
                .remove(id);
        }
        self.emit(
            SharedEventKind::JobStateChanged,
            Some(id.to_owned()),
            message,
            None,
        );
        Ok(job)
    }
    pub fn cancel(&self, id: &str) -> bool {
        if let Some(token) = self
            .cancellations
            .lock()
            .expect("job cancellation lock")
            .get(id)
        {
            token.cancel();
            true
        } else {
            false
        }
    }
    pub fn subscribe(&self) -> broadcast::Receiver<SharedEventEnvelope> {
        self.events.subscribe()
    }
    pub fn emit(
        &self,
        kind: SharedEventKind,
        job_id: Option<String>,
        message: Option<String>,
        text_delta: Option<String>,
    ) {
        let mut sequence = self.sequence.lock().expect("event sequence lock");
        *sequence += 1;
        let _ = self.events.send(SharedEventEnvelope {
            sequence: *sequence,
            emitted_at_unix_ms: now_ms(),
            kind,
            job_id,
            message,
            text_delta,
        });
    }
    pub async fn checkpoint(
        &self,
        id: &str,
        sequence: i64,
        summary: &str,
    ) -> Result<(), sqlx::Error> {
        self.persistence.checkpoint(id, sequence, summary).await
    }
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
