use crate::application::hosted_source;
use hiveory_persistence::{HiveoryPersistence, TaskSourceSaveRequest};
use hiveory_protocol::{
    TaskSourceConnectRequest, TaskSourceItem, TaskSourceProvider, TaskSourceSnapshot,
    TaskSourceSummary,
};
use hiveory_secret_store::HiveorySecretStore;
use reqwest::Client;
use serde_json::{json, Value};
use std::{
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use url::Url;

const MAX_ITEMS: usize = 100;

pub(crate) async fn connect(
    persistence: &HiveoryPersistence,
    secrets: &dyn HiveorySecretStore,
    request: &TaskSourceConnectRequest,
) -> Result<TaskSourceSummary, String> {
    let label = required(&request.label, "source name")?;
    let endpoint = normalized_endpoint(request.provider, request.endpoint.as_deref())?;
    let account = request
        .account_email
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let token = request
        .token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if request.provider == TaskSourceProvider::Jira && (account.is_none() || token.is_none()) {
        return Err("Jira requires the site URL, account email, and API token.".to_owned());
    }
    if request.provider == TaskSourceProvider::Linear && token.is_none() {
        return Err("Linear requires a personal API key.".to_owned());
    }
    let client = http_client()?;
    validate(
        &client,
        request.provider,
        endpoint.as_deref(),
        account,
        token,
    )
    .await?;
    let secret_ref = token
        .map(|value| secrets.put(value).map_err(|error| error.to_string()))
        .transpose()?;
    persistence
        .save_task_source(TaskSourceSaveRequest {
            workspace_id: &request.workspace_id,
            provider: request.provider,
            label: &label,
            endpoint: endpoint.as_deref(),
            account_label: account,
            secret_ref: secret_ref.as_deref(),
            validated_at_unix_ms: Some(now_ms()),
            last_error: None,
        })
        .await
        .map_err(|error| error.to_string())
}

pub(crate) async fn snapshot(
    persistence: &HiveoryPersistence,
    secrets: &dyn HiveorySecretStore,
    workspace_id: &str,
    root: &Path,
) -> TaskSourceSnapshot {
    let mut sources = persistence
        .task_sources(workspace_id)
        .await
        .unwrap_or_default();
    let tracking = hosted_source::load_tracking(persistence, workspace_id, root).await;
    let github_ready = tracking.auth_state == hiveory_protocol::CodeHostedAuthState::Ready;
    sources.insert(
        0,
        TaskSourceSummary {
            id: "github-local".to_owned(),
            workspace_id: workspace_id.to_owned(),
            provider: TaskSourceProvider::Github,
            label: tracking
                .repository
                .as_ref()
                .map(|repo| format!("GitHub · {}/{}", repo.owner, repo.name))
                .unwrap_or_else(|| "GitHub · local gh CLI".to_owned()),
            endpoint: None,
            account_label: None,
            enabled: true,
            validated_at_unix_ms: github_ready.then_some(tracking.refreshed_at_unix_ms),
            last_error: tracking.message.clone(),
            updated_at_unix_ms: tracking.refreshed_at_unix_ms,
        },
    );
    let mut items = tracking
        .issues
        .into_iter()
        .map(|issue| TaskSourceItem {
            source_id: "github-local".to_owned(),
            provider: TaskSourceProvider::Github,
            identifier: format!("#{}", issue.number),
            title: issue.title,
            status: issue.state,
            url: Some(issue.url),
            assignee: issue.author,
            project: tracking.repository.as_ref().map(|repo| repo.name.clone()),
            updated_at: issue.updated_at,
        })
        .collect::<Vec<_>>();
    let remote_sources = sources
        .iter()
        .filter(|source| source.provider != TaskSourceProvider::Github && source.enabled)
        .cloned()
        .collect::<Vec<_>>();
    for source in &remote_sources {
        let result = load_remote(&persistence, secrets, source).await;
        match result {
            Ok(mut provider_items) => items.append(&mut provider_items),
            Err(error) => {
                if let Some(current) = sources
                    .iter_mut()
                    .find(|candidate| candidate.id == source.id)
                {
                    current.last_error = Some(error);
                }
            }
        }
    }
    TaskSourceSnapshot {
        workspace_id: workspace_id.to_owned(),
        sources,
        items,
        refreshed_at_unix_ms: now_ms(),
    }
}

pub(crate) async fn remove(
    persistence: &HiveoryPersistence,
    secrets: &dyn HiveorySecretStore,
    source_id: &str,
) -> Result<(), String> {
    if source_id == "github-local" {
        return Err(
            "GitHub is provided by the local gh CLI and cannot be removed here.".to_owned(),
        );
    }
    if let Some(secret_ref) = persistence
        .remove_task_source(source_id)
        .await
        .map_err(|error| error.to_string())?
    {
        let _ = secrets.delete(&secret_ref);
    }
    Ok(())
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("Hiveory/0.1 local task source")
        .build()
        .map_err(|error| error.to_string())
}
fn required(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("{label} is required."))
    } else {
        Ok(value.to_owned())
    }
}
fn normalized_endpoint(
    provider: TaskSourceProvider,
    endpoint: Option<&str>,
) -> Result<Option<String>, String> {
    let default = match provider {
        TaskSourceProvider::Linear => Some("https://api.linear.app"),
        TaskSourceProvider::Github => None,
        TaskSourceProvider::Jira => None,
    };
    let value = endpoint
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or(default);
    let Some(value) = value else {
        return if provider == TaskSourceProvider::Jira {
            Err("Jira site URL is required.".to_owned())
        } else {
            Ok(None)
        };
    };
    let url = Url::parse(value).map_err(|_| "Enter a valid HTTPS endpoint.".to_owned())?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err("Task source endpoints must use HTTPS.".to_owned());
    }
    Ok(Some(url.as_str().trim_end_matches('/').to_owned()))
}
async fn validate(
    client: &Client,
    provider: TaskSourceProvider,
    endpoint: Option<&str>,
    account: Option<&str>,
    token: Option<&str>,
) -> Result<(), String> {
    match provider {
        TaskSourceProvider::Github => Ok(()),
        TaskSourceProvider::Jira => {
            let response = client
                .get(format!("{}/rest/api/3/myself", endpoint.unwrap()))
                .basic_auth(account.unwrap(), token.map(str::to_owned))
                .send()
                .await
                .map_err(|error| error.to_string())?;
            response
                .error_for_status()
                .map_err(|error| format!("Jira connection test failed: {error}"))?;
            Ok(())
        }
        TaskSourceProvider::Linear => {
            let response = client
                .post(format!("{}/graphql", endpoint.unwrap()))
                .bearer_auth(token.unwrap())
                .json(&json!({"query":"query { viewer { id } }"}))
                .send()
                .await
                .map_err(|error| error.to_string())?;
            response
                .error_for_status()
                .map_err(|error| format!("Linear connection test failed: {error}"))?;
            Ok(())
        }
    }
}
async fn load_remote(
    persistence: &HiveoryPersistence,
    secrets: &dyn HiveorySecretStore,
    source: &TaskSourceSummary,
) -> Result<Vec<TaskSourceItem>, String> {
    let secret_ref = persistence
        .task_source_secret_ref(&source.id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "Credential is missing from the OS keyring. Reconnect this source.".to_owned()
        })?;
    let token = secrets.get(&secret_ref).map_err(|_| {
        "Credential is unavailable from the OS keyring. Reconnect this source.".to_owned()
    })?;
    let client = http_client()?;
    match source.provider {
        TaskSourceProvider::Jira => load_jira(&client, source, &token).await,
        TaskSourceProvider::Linear => load_linear(&client, source, &token).await,
        TaskSourceProvider::Github => Ok(Vec::new()),
    }
}
async fn load_jira(
    client: &Client,
    source: &TaskSourceSummary,
    token: &str,
) -> Result<Vec<TaskSourceItem>, String> {
    let response = client
        .get(format!(
            "{}/rest/api/3/search/jql",
            source.endpoint.as_deref().unwrap()
        ))
        .basic_auth(
            source.account_label.as_deref().unwrap_or_default(),
            Some(token.to_owned()),
        )
        .query(&[
            ("jql", "order by updated DESC"),
            ("maxResults", "100"),
            ("fields", "summary,status,assignee,updated,project"),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let value: Value = response
        .error_for_status()
        .map_err(|error| format!("Jira refresh failed: {error}"))?
        .json()
        .await
        .map_err(|error| error.to_string())?;
    Ok(value
        .get("issues")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(MAX_ITEMS)
        .map(|issue| TaskSourceItem {
            source_id: source.id.clone(),
            provider: TaskSourceProvider::Jira,
            identifier: issue
                .get("key")
                .and_then(Value::as_str)
                .unwrap_or("JIRA")
                .to_owned(),
            title: issue
                .pointer("/fields/summary")
                .and_then(Value::as_str)
                .unwrap_or("Untitled issue")
                .to_owned(),
            status: issue
                .pointer("/fields/status/name")
                .and_then(Value::as_str)
                .unwrap_or("Unknown")
                .to_owned(),
            url: issue.get("key").and_then(Value::as_str).map(|key| {
                format!(
                    "{}/browse/{key}",
                    source.endpoint.as_deref().unwrap_or_default()
                )
            }),
            assignee: issue
                .pointer("/fields/assignee/displayName")
                .and_then(Value::as_str)
                .map(str::to_owned),
            project: issue
                .pointer("/fields/project/name")
                .and_then(Value::as_str)
                .map(str::to_owned),
            updated_at: issue
                .pointer("/fields/updated")
                .and_then(Value::as_str)
                .map(str::to_owned),
        })
        .collect())
}
async fn load_linear(
    client: &Client,
    source: &TaskSourceSummary,
    token: &str,
) -> Result<Vec<TaskSourceItem>, String> {
    let query = "query { issues(first: 100, orderBy: updatedAt) { nodes { identifier title url updatedAt state { name } assignee { name } team { name } project { name } } } }";
    let response = client
        .post(format!("{}/graphql", source.endpoint.as_deref().unwrap()))
        .bearer_auth(token)
        .json(&json!({"query": query}))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let value: Value = response
        .error_for_status()
        .map_err(|error| format!("Linear refresh failed: {error}"))?
        .json()
        .await
        .map_err(|error| error.to_string())?;
    if let Some(errors) = value.get("errors") {
        return Err(format!("Linear refresh failed: {errors}"));
    }
    Ok(value
        .pointer("/data/issues/nodes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(MAX_ITEMS)
        .map(|issue| TaskSourceItem {
            source_id: source.id.clone(),
            provider: TaskSourceProvider::Linear,
            identifier: issue
                .get("identifier")
                .and_then(Value::as_str)
                .unwrap_or("LINEAR")
                .to_owned(),
            title: issue
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Untitled issue")
                .to_owned(),
            status: issue
                .pointer("/state/name")
                .and_then(Value::as_str)
                .unwrap_or("Unknown")
                .to_owned(),
            url: issue.get("url").and_then(Value::as_str).map(str::to_owned),
            assignee: issue
                .pointer("/assignee/name")
                .and_then(Value::as_str)
                .map(str::to_owned),
            project: issue
                .pointer("/project/name")
                .or_else(|| issue.pointer("/team/name"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            updated_at: issue
                .get("updatedAt")
                .and_then(Value::as_str)
                .map(str::to_owned),
        })
        .collect())
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
