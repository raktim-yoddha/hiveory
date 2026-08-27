//! Declarative, least-privilege plugin execution for the local Agent runtime.
//!
//! Phase 7 deliberately supports a small adapter surface. Plugin manifests
//! describe schemas and permissions; they never cause application code to be
//! downloaded or executed.

use agentic_super_app_persistence::plugin::{
    AgenticSuperAppPluginStore, AgenticSuperAppPluginStoreError,
};
use agentic_super_app_persistence::routine::AgenticSuperAppRoutineStore;
use agentic_super_app_persistence::routine::AgenticSuperAppRoutineStoreError;
use agentic_super_app_protocol::{
    AgentPluginGrant, AgentPluginGrantRequest, AgentToolDefinition, AgentToolRisk,
    PluginAdapterKind, PluginCatalogEntry, PluginConnectionCreateRequest,
    PluginConnectionIdRequest, PluginConnectionKind, PluginConnectionSummary,
    PluginConnectionUpdateRequest, PluginDryRunRequest, PluginInstallRequest,
    PluginInvocationSummary, PluginManifest, PluginPermission, PluginToolDefinition,
};
use agentic_super_app_secret_store::{
    AgenticSuperAppSecretStoreError, AgenticSuperAppSecretStoreHandle,
};
use agentic_super_app_tool_runtime::{
    agentic_super_app_approval_fingerprint, AgenticSuperAppAuditLog,
    AgenticSuperAppExternalToolProvider,
};
use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::{header::HeaderName, Client};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{net::IpAddr, time::Duration};
use thiserror::Error;
use url::Url;

const MAX_REQUEST_BYTES: usize = 256 * 1024;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Error)]
pub enum AgenticSuperAppPluginRuntimeError {
    #[error("plugin store failure: {0}")]
    Store(#[from] AgenticSuperAppPluginStoreError),
    #[error("routine store failure: {0}")]
    RoutineStore(#[from] AgenticSuperAppRoutineStoreError),
    #[error("plugin secret failure: {0}")]
    Secret(String),
    #[error("plugin request is invalid: {0}")]
    InvalidInput(String),
    #[error("plugin item was not found: {0}")]
    NotFound(String),
    #[error("plugin request failed: {0}")]
    Request(String),
    #[error("plugin response was invalid")]
    InvalidResponse,
    #[error("plugin serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Clone)]
pub struct AgenticSuperAppPluginRuntime {
    store: AgenticSuperAppPluginStore,
    routines: AgenticSuperAppRoutineStore,
    secrets: AgenticSuperAppSecretStoreHandle,
    audit: AgenticSuperAppAuditLog,
    client: Client,
}

impl AgenticSuperAppPluginRuntime {
    pub fn new(
        persistence: agentic_super_app_persistence::AgenticSuperAppPersistence,
        secrets: AgenticSuperAppSecretStoreHandle,
        audit: AgenticSuperAppAuditLog,
    ) -> Result<Self, AgenticSuperAppPluginRuntimeError> {
        let client = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            // Redirects are disabled so a manifest host allow-list cannot be
            // bypassed by a public endpoint redirecting into a private host.
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| AgenticSuperAppPluginRuntimeError::Request(error.to_string()))?;
        Ok(Self {
            store: AgenticSuperAppPluginStore::new(persistence.clone()),
            routines: AgenticSuperAppRoutineStore::new(persistence),
            secrets,
            audit,
            client,
        })
    }

    pub async fn initialize(&self) -> Result<(), AgenticSuperAppPluginRuntimeError> {
        for manifest in builtin_manifests() {
            self.store.upsert_manifest(&manifest).await?;
        }
        Ok(())
    }

    pub async fn catalog(
        &self,
    ) -> Result<Vec<PluginCatalogEntry>, AgenticSuperAppPluginRuntimeError> {
        Ok(self.store.catalog().await?)
    }

    pub async fn connections(
        &self,
        plugin_id: Option<&str>,
    ) -> Result<Vec<PluginConnectionSummary>, AgenticSuperAppPluginRuntimeError> {
        Ok(self.store.connections(plugin_id).await?)
    }

    pub async fn install(
        &self,
        request: &PluginInstallRequest,
    ) -> Result<(), AgenticSuperAppPluginRuntimeError> {
        self.store.set_installed(request).await?;
        self.audit
            .record(
                "plugin.installation.changed",
                if request.enabled {
                    "enabled"
                } else {
                    "disabled"
                },
                "info",
                Some(&request.plugin_id),
                None,
            )
            .await
            .map_err(|error| AgenticSuperAppPluginRuntimeError::Request(error.to_string()))?;
        Ok(())
    }

    pub async fn create_connection(
        &self,
        request: &PluginConnectionCreateRequest,
    ) -> Result<PluginConnectionSummary, AgenticSuperAppPluginRuntimeError> {
        let secret_ref =
            if let Some(secret) = request
                .secret_value
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                Some(self.secrets.put(secret).map_err(|error| {
                    AgenticSuperAppPluginRuntimeError::Secret(error.to_string())
                })?)
            } else {
                None
            };
        match self
            .store
            .create_connection(request, secret_ref.as_deref())
            .await
        {
            Ok(connection) => Ok(connection),
            Err(error) => {
                if let Some(secret_ref) = secret_ref.as_deref() {
                    let _ = self.secrets.delete(secret_ref);
                }
                Err(error.into())
            }
        }
    }

    pub async fn update_connection(
        &self,
        request: &PluginConnectionUpdateRequest,
    ) -> Result<PluginConnectionSummary, AgenticSuperAppPluginRuntimeError> {
        let old = self
            .store
            .connection_with_secret(&request.connection_id)
            .await?
            .ok_or(AgenticSuperAppPluginRuntimeError::InvalidInput(
                "connection was not found".to_owned(),
            ))?;
        let new_secret_ref =
            if let Some(secret) = request
                .secret_value
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                Some(self.secrets.put(secret).map_err(|error| {
                    AgenticSuperAppPluginRuntimeError::Secret(error.to_string())
                })?)
            } else {
                None
            };
        let old_secret_ref = old.1;
        let next_secret_ref = new_secret_ref.clone().or_else(|| old_secret_ref.clone());
        match self
            .store
            .update_connection(request, next_secret_ref.as_deref())
            .await
        {
            Ok(connection) => {
                if let (Some(old_secret_ref), Some(new_secret_ref)) =
                    (old_secret_ref.as_deref(), new_secret_ref.as_deref())
                {
                    if old_secret_ref != new_secret_ref {
                        let _ = self.secrets.delete(old_secret_ref);
                    }
                }
                Ok(connection)
            }
            Err(error) => {
                if let Some(new_secret_ref) = new_secret_ref.as_deref() {
                    let _ = self.secrets.delete(new_secret_ref);
                }
                Err(error.into())
            }
        }
    }

    pub async fn delete_connection(
        &self,
        request: &PluginConnectionIdRequest,
    ) -> Result<(), AgenticSuperAppPluginRuntimeError> {
        if let Some((_, secret_ref)) = self
            .store
            .connection_with_secret(&request.connection_id)
            .await?
        {
            if let Some(secret_ref) = secret_ref {
                let _ = self.secrets.delete(&secret_ref);
            }
        }
        self.store.delete_connection(&request.connection_id).await?;
        Ok(())
    }

    pub async fn set_agent_grant(
        &self,
        request: &AgentPluginGrantRequest,
    ) -> Result<AgentPluginGrant, AgenticSuperAppPluginRuntimeError> {
        Ok(self.store.set_grant(request).await?)
    }

    pub async fn agent_grants(
        &self,
        agent_id: &str,
    ) -> Result<Vec<AgentPluginGrant>, AgenticSuperAppPluginRuntimeError> {
        Ok(self.store.grants_for_agent(agent_id).await?)
    }

    pub async fn invocations_for_run(
        &self,
        run_id: &str,
    ) -> Result<Vec<PluginInvocationSummary>, AgenticSuperAppPluginRuntimeError> {
        Ok(self.store.invocations_for_run(run_id, 100).await?)
    }

    pub async fn test_connection(
        &self,
        request: &PluginConnectionIdRequest,
    ) -> Result<PluginConnectionSummary, AgenticSuperAppPluginRuntimeError> {
        let connection = self
            .store
            .connection_with_secret(&request.connection_id)
            .await?
            .ok_or(AgenticSuperAppPluginRuntimeError::InvalidInput(
                "connection was not found".to_owned(),
            ))?;
        let manifest = self.store.manifest(&connection.0.plugin_id).await?;
        let url = self.safe_url(&manifest, &connection.0.origin, "/")?;
        // A connection test must never deliver a webhook payload. HEAD verifies
        // reachability without causing a mutating adapter to fire.
        let builder = match manifest.adapter {
            PluginAdapterKind::JsonHttpGet => self.client.get(url),
            PluginAdapterKind::JsonHttpPost => self.client.head(url),
        };
        let response = self
            .request_builder(&connection.0, connection.1.as_deref(), builder)?
            .send()
            .await
            .map_err(|error| AgenticSuperAppPluginRuntimeError::Request(error.to_string()))?;
        if !response.status().is_success() {
            return Err(AgenticSuperAppPluginRuntimeError::Request(format!(
                "connection test returned HTTP {}",
                response.status()
            )));
        }
        self.store
            .mark_connection_validated(&request.connection_id)
            .await?;
        Ok(self.store.connection(&request.connection_id).await?.ok_or(
            AgenticSuperAppPluginRuntimeError::InvalidInput(
                "connection disappeared during test".to_owned(),
            ),
        )?)
    }

    pub async fn dry_run(
        &self,
        request: &PluginDryRunRequest,
    ) -> Result<String, AgenticSuperAppPluginRuntimeError> {
        let manifest = self.enabled_manifest(&request.plugin_id).await?;
        let tool = manifest
            .tools
            .iter()
            .find(|tool| tool.name == request.tool_name)
            .ok_or(AgenticSuperAppPluginRuntimeError::NotFound(
                request.tool_name.clone(),
            ))?;
        if !matches!(manifest.adapter, PluginAdapterKind::JsonHttpPost)
            || !manifest.supports_dry_run
        {
            return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
                "this plugin tool does not support dry runs".to_owned(),
            ));
        }
        let args = parse_object(&request.arguments_json)?;
        validate_tool_arguments(tool, &args)?;
        let connection = self.store.connection(&request.connection_id).await?.ok_or(
            AgenticSuperAppPluginRuntimeError::InvalidInput("connection was not found".to_owned()),
        )?;
        if connection.plugin_id != request.plugin_id {
            return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
                "connection does not belong to plugin".to_owned(),
            ));
        }
        let url = self.safe_url(&manifest, &connection.origin, path_arg(&args)?)?;
        Ok(json!({
            "dry_run": true,
            "method": "POST",
            "target": url,
            "body": args.get("body").cloned().unwrap_or(Value::Null),
            "message": "No network request was sent."
        })
        .to_string())
    }

    async fn execute_inner(
        &self,
        run_id: &str,
        agent_id: &str,
        plugin_id: &str,
        tool_name: &str,
        arguments_json: &str,
    ) -> Result<String, AgenticSuperAppPluginRuntimeError> {
        let manifest = self.enabled_manifest(plugin_id).await?;
        let tool = manifest
            .tools
            .iter()
            .find(|tool| tool.name == tool_name)
            .ok_or_else(|| {
                AgenticSuperAppPluginRuntimeError::InvalidInput(
                    "plugin tool was not found".to_owned(),
                )
            })?;
        let args = parse_object(arguments_json)?;
        validate_tool_arguments(tool, &args)?;
        let grants = self.store.grants_for_agent(agent_id).await?;
        let qualified = format!("plugin.{plugin_id}.{tool_name}");
        let Some(grant) = grants.into_iter().find(|grant| {
            grant.enabled
                && grant.plugin_id == plugin_id
                && (grant.tool_names.is_empty()
                    || grant
                        .tool_names
                        .iter()
                        .any(|name| name == tool_name || name == &qualified))
        }) else {
            return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
                "plugin tool is not granted to this Agent".to_owned(),
            ));
        };
        if let Some(execution) = self.routines.execution_for_run(run_id).await? {
            if !execution
                .plugin_tool_names
                .iter()
                .any(|name| name == tool_name || name == &qualified)
            {
                return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
                    "plugin tool is outside the routine grant".to_owned(),
                ));
            }
        }
        let connection = self
            .store
            .connection_with_secret(&grant.connection_id)
            .await?
            .ok_or(AgenticSuperAppPluginRuntimeError::InvalidInput(
                "plugin connection was not found".to_owned(),
            ))?;
        if connection.0.plugin_id != plugin_id {
            return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
                "plugin connection mismatch".to_owned(),
            ));
        }
        let url = self.safe_url(&manifest, &connection.0.origin, path_arg(&args)?)?;
        let request_preview = preview_json(&Value::Object(args.clone()));
        let invocation = self
            .store
            .insert_invocation(
                Some(run_id),
                plugin_id,
                &connection.0.id,
                tool_name,
                &url,
                &request_preview,
            )
            .await?;
        let target = url.clone();
        let result = match manifest.adapter {
            PluginAdapterKind::JsonHttpGet => {
                let mut builder = self.client.get(url);
                if let Some(query) = args.get("query").and_then(Value::as_str) {
                    if query.len() > 2000 {
                        return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
                            "query is too long".to_owned(),
                        ));
                    }
                    builder = builder.query(&[("q", query)]);
                }
                self.send_json_request(&connection.0, connection.1.as_deref(), builder)
                    .await
            }
            PluginAdapterKind::JsonHttpPost => {
                let body = args.get("body").cloned().unwrap_or(Value::Null);
                let serialized = serde_json::to_vec(&body)?;
                if serialized.len() > MAX_REQUEST_BYTES {
                    return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
                        "request body is too large".to_owned(),
                    ));
                }
                let builder = self
                    .client
                    .post(url)
                    .header("Idempotency-Key", invocation.id.clone())
                    .json(&body);
                self.send_json_request(&connection.0, connection.1.as_deref(), builder)
                    .await
            }
        };
        match result {
            Ok(output) => {
                self.store
                    .finish_invocation(
                        &invocation.id,
                        "completed",
                        Some(&preview_json(&output)),
                        None,
                    )
                    .await?;
                self.audit
                    .record(
                        "plugin.invocation.completed",
                        "completed",
                        if tool.risk == AgentToolRisk::ReadOnly {
                            "info"
                        } else {
                            "warning"
                        },
                        Some(&target),
                        Some(&format!(
                            "plugin={plugin_id}; fingerprint={}",
                            agentic_super_app_approval_fingerprint(
                                &qualified,
                                &target,
                                arguments_json
                            )
                        )),
                    )
                    .await
                    .map_err(|error| {
                        AgenticSuperAppPluginRuntimeError::Request(error.to_string())
                    })?;
                Ok(output.to_string())
            }
            Err(error) => {
                let message = error.to_string();
                let _ = self
                    .store
                    .finish_invocation(&invocation.id, "failed", None, Some(&message))
                    .await;
                Err(error)
            }
        }
    }

    async fn send_json_request(
        &self,
        connection: &PluginConnectionSummary,
        secret_ref: Option<&str>,
        builder: reqwest::RequestBuilder,
    ) -> Result<Value, AgenticSuperAppPluginRuntimeError> {
        let response = self
            .request_builder(connection, secret_ref, builder)?
            .send()
            .await
            .map_err(|error| AgenticSuperAppPluginRuntimeError::Request(error.to_string()))?;
        let status = response.status();
        let bytes = bounded_response(response).await?;
        if !status.is_success() {
            return Err(AgenticSuperAppPluginRuntimeError::Request(format!(
                "plugin returned HTTP {}",
                status
            )));
        }
        let body: Value = serde_json::from_slice(&bytes)
            .map_err(|_| AgenticSuperAppPluginRuntimeError::InvalidResponse)?;
        Ok(json!({ "status": status.as_u16(), "body": body }))
    }

    fn request_builder(
        &self,
        connection: &PluginConnectionSummary,
        secret_ref: Option<&str>,
        builder: reqwest::RequestBuilder,
    ) -> Result<reqwest::RequestBuilder, AgenticSuperAppPluginRuntimeError> {
        if matches!(connection.kind, PluginConnectionKind::ApiKeyHeader) {
            let header = connection.api_key_header.as_deref().ok_or(
                AgenticSuperAppPluginRuntimeError::InvalidInput(
                    "API key header is missing".to_owned(),
                ),
            )?;
            let name = HeaderName::from_bytes(header.as_bytes()).map_err(|_| {
                AgenticSuperAppPluginRuntimeError::InvalidInput(
                    "API key header is invalid".to_owned(),
                )
            })?;
            let secret = secret_ref.ok_or(AgenticSuperAppPluginRuntimeError::Secret(
                "connection secret is unavailable".to_owned(),
            ))?;
            let value = self.secrets.get(secret).map_err(secret_error)?;
            Ok(builder.header(name, value))
        } else {
            Ok(builder)
        }
    }

    fn safe_url(
        &self,
        manifest: &PluginManifest,
        origin: &str,
        path: &str,
    ) -> Result<String, AgenticSuperAppPluginRuntimeError> {
        let base = Url::parse(origin).map_err(|_| {
            AgenticSuperAppPluginRuntimeError::InvalidInput(
                "connection origin is invalid".to_owned(),
            )
        })?;
        if base.scheme() != "https" || base.username() != "" || base.password().is_some() {
            return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
                "plugin connections must use HTTPS without embedded credentials".to_owned(),
            ));
        }
        let host = base
            .host_str()
            .ok_or(AgenticSuperAppPluginRuntimeError::InvalidInput(
                "connection host is missing".to_owned(),
            ))?;
        if !manifest
            .allowed_hosts
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(host))
        {
            return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
                "connection host is not allowed by the plugin manifest".to_owned(),
            ));
        }
        reject_private_host(host)?;
        if !path.starts_with('/') || path.contains("..") || path.len() > 2048 {
            return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
                "plugin path must be an absolute, bounded path without traversal".to_owned(),
            ));
        }
        let target = base.join(path).map_err(|_| {
            AgenticSuperAppPluginRuntimeError::InvalidInput(
                "plugin path could not be resolved".to_owned(),
            )
        })?;
        if target.scheme() != "https"
            || target.host_str() != Some(host)
            || target.username() != ""
            || target.password().is_some()
        {
            return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
                "plugin request escaped its declared HTTPS origin".to_owned(),
            ));
        }
        Ok(target.to_string())
    }

    async fn enabled_manifest(
        &self,
        plugin_id: &str,
    ) -> Result<PluginManifest, AgenticSuperAppPluginRuntimeError> {
        let entry = self
            .store
            .catalog()
            .await?
            .into_iter()
            .find(|entry| entry.manifest.id == plugin_id)
            .ok_or_else(|| AgenticSuperAppPluginRuntimeError::NotFound(plugin_id.to_owned()))?;
        if !entry.installed || !entry.enabled {
            return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
                "the plugin is disabled".to_owned(),
            ));
        }
        Ok(entry.manifest)
    }
}

#[async_trait]
impl AgenticSuperAppExternalToolProvider for AgenticSuperAppPluginRuntime {
    async fn definitions(&self, agent_id: &str) -> Result<Vec<AgentToolDefinition>, String> {
        let grants = self
            .store
            .grants_for_agent(agent_id)
            .await
            .map_err(|error| error.to_string())?;
        let catalog = self
            .store
            .catalog()
            .await
            .map_err(|error| error.to_string())?;
        let mut definitions = Vec::new();
        for grant in grants.into_iter().filter(|grant| grant.enabled) {
            let Some(entry) = catalog.iter().find(|entry| {
                entry.manifest.id == grant.plugin_id && entry.installed && entry.enabled
            }) else {
                continue;
            };
            for tool in &entry.manifest.tools {
                if grant.tool_names.is_empty()
                    || grant.tool_names.iter().any(|name| {
                        name == &tool.name
                            || name == &format!("plugin.{}.{}", grant.plugin_id, tool.name)
                    })
                {
                    definitions.push(AgentToolDefinition {
                        name: format!("plugin.{}.{}", grant.plugin_id, tool.name),
                        description: format!("{} ({})", tool.description, entry.manifest.name),
                        input_schema_json: tool.input_schema_json.clone(),
                        risk: tool.risk,
                    });
                }
            }
        }
        Ok(definitions)
    }

    async fn execute(
        &self,
        run_id: &str,
        agent_id: &str,
        name: &str,
        arguments_json: &str,
    ) -> Result<String, String> {
        let mut parts = name.splitn(3, '.');
        if parts.next() != Some("plugin") {
            return Err("plugin tool name is invalid".to_owned());
        }
        let plugin_id = parts.next().unwrap_or_default();
        let tool_name = parts.next().unwrap_or_default();
        if plugin_id.is_empty() || tool_name.is_empty() {
            return Err("plugin tool name is invalid".to_owned());
        }
        self.execute_inner(run_id, agent_id, plugin_id, tool_name, arguments_json)
            .await
            .map_err(|error| error.to_string())
    }
}

async fn bounded_response(
    response: reqwest::Response,
) -> Result<Vec<u8>, AgenticSuperAppPluginRuntimeError> {
    if response.content_length().unwrap_or(0) > MAX_RESPONSE_BYTES as u64 {
        return Err(AgenticSuperAppPluginRuntimeError::InvalidResponse);
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|error| AgenticSuperAppPluginRuntimeError::Request(error.to_string()))?;
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(AgenticSuperAppPluginRuntimeError::InvalidResponse);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn parse_object(
    arguments_json: &str,
) -> Result<Map<String, Value>, AgenticSuperAppPluginRuntimeError> {
    if arguments_json.len() > MAX_REQUEST_BYTES {
        return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
            "plugin arguments are too large".to_owned(),
        ));
    }
    let value: Value = serde_json::from_str(arguments_json).map_err(|_| {
        AgenticSuperAppPluginRuntimeError::InvalidInput(
            "plugin arguments are not valid JSON".to_owned(),
        )
    })?;
    value
        .as_object()
        .cloned()
        .ok_or(AgenticSuperAppPluginRuntimeError::InvalidInput(
            "plugin arguments must be an object".to_owned(),
        ))
}

fn validate_tool_arguments(
    tool: &PluginToolDefinition,
    args: &Map<String, Value>,
) -> Result<(), AgenticSuperAppPluginRuntimeError> {
    let schema: Value = serde_json::from_str(&tool.input_schema_json).map_err(|_| {
        AgenticSuperAppPluginRuntimeError::InvalidInput("plugin input schema is invalid".to_owned())
    })?;
    let properties = schema.get("properties").and_then(Value::as_object).ok_or(
        AgenticSuperAppPluginRuntimeError::InvalidInput(
            "plugin input schema must define properties".to_owned(),
        ),
    )?;
    let required = schema.get("required").and_then(Value::as_array).ok_or(
        AgenticSuperAppPluginRuntimeError::InvalidInput(
            "plugin input schema must define required fields".to_owned(),
        ),
    )?;
    if schema.get("additionalProperties") != Some(&Value::Bool(false)) {
        return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
            "plugin schemas must reject additional properties".to_owned(),
        ));
    }
    for key in args.keys() {
        if !properties.contains_key(key) {
            return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(format!(
                "unknown plugin argument: {key}"
            )));
        }
    }
    for key in required.iter().filter_map(Value::as_str) {
        if !args.contains_key(key) {
            return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(format!(
                "plugin argument is required: {key}"
            )));
        }
    }
    Ok(())
}

fn path_arg(args: &Map<String, Value>) -> Result<&str, AgenticSuperAppPluginRuntimeError> {
    args.get("path")
        .and_then(Value::as_str)
        .ok_or(AgenticSuperAppPluginRuntimeError::InvalidInput(
            "plugin path is required".to_owned(),
        ))
}

fn preview_json(value: &Value) -> String {
    let mut redacted = value.clone();
    redact_value(&mut redacted);
    let text = redacted.to_string();
    text.chars().take(1200).collect()
}

fn redact_value(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, item) in map.iter_mut() {
                let normalized = key.to_ascii_lowercase();
                if [
                    "token",
                    "secret",
                    "password",
                    "api_key",
                    "apikey",
                    "authorization",
                    "cookie",
                ]
                .iter()
                .any(|needle| normalized.contains(needle))
                {
                    *item = Value::String("[REDACTED]".to_owned());
                } else {
                    redact_value(item);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(redact_value),
        _ => {}
    }
}

fn reject_private_host(host: &str) -> Result<(), AgenticSuperAppPluginRuntimeError> {
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".local") {
        return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
            "private and local plugin hosts are blocked".to_owned(),
        ));
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        let private = match ip {
            IpAddr::V4(ip) => {
                ip.is_private()
                    || ip.is_loopback()
                    || ip.is_link_local()
                    || ip.is_unspecified()
                    || ip.is_broadcast()
            }
            IpAddr::V6(ip) => {
                ip.is_loopback()
                    || ip.is_unspecified()
                    || ip.is_unique_local()
                    || ip.is_unicast_link_local()
            }
        };
        if private {
            return Err(AgenticSuperAppPluginRuntimeError::InvalidInput(
                "private and local plugin hosts are blocked".to_owned(),
            ));
        }
    }
    Ok(())
}

fn secret_error(error: AgenticSuperAppSecretStoreError) -> AgenticSuperAppPluginRuntimeError {
    AgenticSuperAppPluginRuntimeError::Secret(error.to_string())
}

fn builtin_manifests() -> Vec<PluginManifest> {
    let mut manifests = vec![
        PluginManifest {
            id: "web-json-reader".to_owned(),
            publisher: "Agentic Super App".to_owned(),
            version: "1.0.0".to_owned(),
            name: "JSON Reader".to_owned(),
            description: "Read structured JSON from an explicitly allowlisted HTTPS service.".to_owned(),
            adapter: PluginAdapterKind::JsonHttpGet,
            tools: vec![PluginToolDefinition {
                name: "get_json".to_owned(),
                description: "Fetch a JSON document without mutating the remote service.".to_owned(),
                input_schema_json: r#"{"type":"object","properties":{"path":{"type":"string"},"query":{"type":["string","null"]}},"required":["path","query"],"additionalProperties":false}"#.to_owned(),
                output_schema_json: r#"{"type":"object","properties":{"status":{"type":"integer"},"body":{}},"required":["status","body"],"additionalProperties":false}"#.to_owned(),
                risk: AgentToolRisk::ReadOnly,
            }],
            permissions: vec![PluginPermission { capability: "network.https.read".to_owned(), explanation: "GET requests only to the configured declared host.".to_owned() }],
            allowed_hosts: vec!["api.github.com".to_owned(), "jsonplaceholder.typicode.com".to_owned()],
            connection_kind: PluginConnectionKind::None,
            supports_dry_run: false,
            content_hash: String::new(),
        },
        PluginManifest {
            id: "webhook-delivery".to_owned(),
            publisher: "Agentic Super App".to_owned(),
            version: "1.0.0".to_owned(),
            name: "Webhook Delivery".to_owned(),
            description: "Send a JSON payload to an approved HTTPS webhook after explicit approval.".to_owned(),
            adapter: PluginAdapterKind::JsonHttpPost,
            tools: vec![PluginToolDefinition {
                name: "post_json".to_owned(),
                description: "Send an externally visible JSON webhook request.".to_owned(),
                input_schema_json: r#"{"type":"object","properties":{"path":{"type":"string"},"body":{"type":"object"}},"required":["path","body"],"additionalProperties":false}"#.to_owned(),
                output_schema_json: r#"{"type":"object","properties":{"status":{"type":"integer"},"body":{}},"required":["status","body"],"additionalProperties":false}"#.to_owned(),
                risk: AgentToolRisk::ExternallyVisible,
            }],
            permissions: vec![PluginPermission { capability: "network.https.write".to_owned(), explanation: "POST requests only to the configured declared host and only after approval.".to_owned() }],
            allowed_hosts: vec!["hooks.example.com".to_owned(), "webhook.site".to_owned()],
            connection_kind: PluginConnectionKind::ApiKeyHeader,
            supports_dry_run: true,
            content_hash: String::new(),
        },
    ];
    for manifest in &mut manifests {
        let canonical = serde_json::to_vec(&json!({
            "id": &manifest.id,
            "publisher": &manifest.publisher,
            "version": &manifest.version,
            "adapter": manifest.adapter,
            "tools": &manifest.tools,
            "permissions": &manifest.permissions,
            "allowed_hosts": &manifest.allowed_hosts,
            "connection_kind": manifest.connection_kind,
            "supports_dry_run": manifest.supports_dry_run
        }))
        .unwrap_or_default();
        manifest.content_hash = format!("{:x}", Sha256::digest(canonical));
    }
    manifests
}

#[cfg(test)]
mod tests {
    use super::{builtin_manifests, reject_private_host};

    #[test]
    fn builtins_have_stable_strict_schemas_and_hashes() {
        for manifest in builtin_manifests() {
            assert!(!manifest.content_hash.is_empty());
            for tool in manifest.tools {
                let schema: serde_json::Value =
                    serde_json::from_str(&tool.input_schema_json).unwrap();
                assert_eq!(schema["additionalProperties"], false);
            }
        }
    }

    #[test]
    fn private_plugin_hosts_are_rejected() {
        assert!(reject_private_host("127.0.0.1").is_err());
        assert!(reject_private_host("example.com").is_ok());
    }
}
