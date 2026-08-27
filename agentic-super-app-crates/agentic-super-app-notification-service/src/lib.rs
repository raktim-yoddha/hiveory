use agentic_super_app_job_runtime::AgenticSuperAppJobRuntime;
use agentic_super_app_persistence::AgenticSuperAppPersistence;
use agentic_super_app_protocol::NotificationSummary;

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
        self.create_with_delivery(title, body, severity, true).await
    }
    pub async fn create_in_app(
        &self,
        title: &str,
        body: &str,
        severity: &str,
    ) -> Result<NotificationSummary, sqlx::Error> {
        self.create_with_delivery(title, body, severity, false)
            .await
    }
    async fn create_with_delivery(
        &self,
        title: &str,
        body: &str,
        severity: &str,
        native: bool,
    ) -> Result<NotificationSummary, sqlx::Error> {
        let item = self.persistence.notification(title, body, severity).await?;
        self.jobs.emit_notification(
            item.id.clone(),
            item.title.clone(),
            item.body.clone(),
            native,
        );
        Ok(item)
    }
}
