use agentic_super_app_job_runtime::AgenticSuperAppJobRuntime;
use agentic_super_app_persistence::AgenticSuperAppPersistence;
use agentic_super_app_protocol::{NotificationSummary, SharedEventKind};

#[derive(Clone)]
pub struct AgenticSuperAppNotificationService {
    persistence: AgenticSuperAppPersistence,
    jobs: AgenticSuperAppJobRuntime,
}
impl AgenticSuperAppNotificationService {
    pub fn new(persistence: AgenticSuperAppPersistence, jobs: AgenticSuperAppJobRuntime) -> Self {
        Self { persistence, jobs }
    }
    pub async fn create(
        &self,
        title: &str,
        body: &str,
        severity: &str,
    ) -> Result<NotificationSummary, sqlx::Error> {
        let item = self.persistence.notification(title, body, severity).await?;
        self.jobs.emit(
            SharedEventKind::NotificationCreated,
            None,
            Some(item.title.clone()),
            None,
        );
        Ok(item)
    }
}
