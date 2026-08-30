use hiveory_persistence::HiveoryPersistence;
use hiveory_protocol::{CodePreviewState, CodePreviewSummary};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{
    webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl,
};
use url::Url;

pub(crate) const BROWSER_EVENT: &str = "hiveory-browser-event";
pub(crate) const GOOGLE_HOME: &str = "https://www.google.com/";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserOpenRequest {
    pub browser_id: String,
    pub workspace_id: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserNavigationRequest {
    pub browser_id: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserIdRequest {
    pub browser_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserBoundsRequest {
    pub browser_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct BrowserRuntimeState {
    pub browser_id: String,
    pub workspace_id: String,
    pub url: String,
    pub title: String,
    pub loading: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum BrowserEventKind {
    State,
    PopupRouted,
    DownloadStarted,
    DownloadFinished,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct BrowserEvent {
    pub event: BrowserEventKind,
    pub state: BrowserRuntimeState,
    pub notice: Option<String>,
}

#[derive(Debug, Clone, Copy)]
enum HistoryAction {
    Back,
    Forward,
}

struct BrowserEntry {
    workspace_id: String,
    preview_id: String,
    webview: Webview,
    current_url: String,
    title: String,
    loading: bool,
    error: Option<String>,
    history: Vec<String>,
    history_index: usize,
    pending_history_action: Option<HistoryAction>,
}

struct BrowserManagerInner {
    profile_dir: PathBuf,
    downloads_dir: PathBuf,
    persistence: HiveoryPersistence,
    entries: Mutex<HashMap<String, BrowserEntry>>,
}

#[derive(Clone)]
pub(crate) struct BrowserManager {
    inner: Arc<BrowserManagerInner>,
}

impl BrowserManager {
    pub(crate) fn new(
        profile_dir: PathBuf,
        downloads_dir: PathBuf,
        persistence: HiveoryPersistence,
    ) -> Self {
        Self {
            inner: Arc::new(BrowserManagerInner {
                profile_dir,
                downloads_dir,
                persistence,
                entries: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub(crate) fn open(
        &self,
        app: &AppHandle,
        request: &BrowserOpenRequest,
    ) -> Result<BrowserRuntimeState, String> {
        let url = normalize_browser_input(&request.url)?;

        if let Some(existing) = self.inner.snapshot(&request.browser_id)? {
            if existing.workspace_id != request.workspace_id {
                return Err("This browser resource belongs to another workspace.".to_owned());
            }
            if existing.url != url.as_str() {
                let state = self.navigate(
                    app,
                    &BrowserNavigationRequest {
                        browser_id: request.browser_id.clone(),
                        url: url.to_string(),
                    },
                )?;
                return Ok(state);
            }
            self.inner.show(&request.browser_id)?;
            emit_event(
                app,
                BrowserEvent {
                    event: BrowserEventKind::State,
                    state: existing.clone(),
                    notice: None,
                },
            );
            return Ok(existing);
        }

        fs::create_dir_all(&self.inner.profile_dir)
            .map_err(|error| format!("The browser profile could not be created: {error}"))?;
        fs::create_dir_all(&self.inner.downloads_dir)
            .map_err(|error| format!("The download directory could not be created: {error}"))?;

        let window = app
            .get_window("main")
            .ok_or_else(|| "The main application window is not available.".to_owned())?;
        let browser_id = request.browser_id.clone();
        let workspace_id = request.workspace_id.clone();
        let preview_id = request.browser_id.clone();
        let inner = Arc::clone(&self.inner);
        let app_for_load = app.clone();
        let inner_for_load = Arc::clone(&inner);
        let browser_id_for_load = browser_id.clone();
        let app_for_title = app.clone();
        let inner_for_title = Arc::clone(&inner);
        let browser_id_for_title = browser_id.clone();
        let app_for_popup = app.clone();
        let inner_for_popup = Arc::clone(&inner);
        let browser_id_for_popup = browser_id.clone();
        let app_for_download = app.clone();
        let inner_for_download = Arc::clone(&inner);
        let browser_id_for_download = browser_id.clone();
        let downloads_dir = self.inner.downloads_dir.clone();

        let webview_builder = WebviewBuilder::new(
            format!("hiveory-browser-{}", uuid::Uuid::now_v7()),
            WebviewUrl::External(url.clone()),
        )
        .data_directory(self.inner.profile_dir.clone())
        .on_navigation(is_allowed_browser_url)
        .on_new_window(move |new_url, _features| {
            if !is_allowed_browser_url(&new_url) {
                if let Some(state) = inner_for_popup
                    .snapshot(&browser_id_for_popup)
                    .ok()
                    .flatten()
                {
                    emit_event(
                        &app_for_popup,
                        BrowserEvent {
                            event: BrowserEventKind::Error,
                            state,
                            notice: Some("This pop-up used an unsupported URL scheme.".to_owned()),
                        },
                    );
                }
                return NewWindowResponse::Deny;
            }

            let notice = match inner_for_popup.navigate(&browser_id_for_popup, new_url.clone()) {
                Ok(_) => format!("Opened {} in the current Browser pane.", new_url),
                Err(error) => error,
            };
            if let Some(state) = inner_for_popup
                .snapshot(&browser_id_for_popup)
                .ok()
                .flatten()
            {
                emit_event(
                    &app_for_popup,
                    BrowserEvent {
                        event: BrowserEventKind::PopupRouted,
                        state,
                        notice: Some(notice),
                    },
                );
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |_, payload| {
            let state = match payload.event() {
                PageLoadEvent::Started => inner_for_load
                    .page_load_started(&browser_id_for_load, payload.url().to_string()),
                PageLoadEvent::Finished => inner_for_load
                    .page_load_finished(&browser_id_for_load, payload.url().to_string()),
            };
            if let Ok(Some(state)) = state {
                emit_event(
                    &app_for_load,
                    BrowserEvent {
                        event: BrowserEventKind::State,
                        state,
                        notice: None,
                    },
                );
            }
        })
        .on_document_title_changed(move |_, title| {
            if let Ok(Some(state)) = inner_for_title.title_changed(&browser_id_for_title, title) {
                emit_event(
                    &app_for_title,
                    BrowserEvent {
                        event: BrowserEventKind::State,
                        state,
                        notice: None,
                    },
                );
            }
        })
        .on_download(move |_, event| {
            match event {
                DownloadEvent::Requested { url, destination } => {
                    let filename = download_filename(&url);
                    let target = unique_download_path(&downloads_dir, &filename);
                    *destination = target;
                    if let Ok(Some(state)) = inner_for_download.snapshot(&browser_id_for_download) {
                        emit_event(
                            &app_for_download,
                            BrowserEvent {
                                event: BrowserEventKind::DownloadStarted,
                                state,
                                notice: Some(format!("Downloading {filename}…")),
                            },
                        );
                    }
                }
                DownloadEvent::Finished { url, path, success } => {
                    if let Ok(Some(state)) = inner_for_download.snapshot(&browser_id_for_download) {
                        let notice = if success {
                            path.map(|path| format!("Downloaded {} to {}.", url, path.display()))
                                .or_else(|| Some(format!("Downloaded {}.", url)))
                        } else {
                            Some(format!("Download failed for {}.", url))
                        };
                        emit_event(
                            &app_for_download,
                            BrowserEvent {
                                event: BrowserEventKind::DownloadFinished,
                                state,
                                notice,
                            },
                        );
                    }
                }
                _ => {}
            }
            true
        });

        let webview = window
            .add_child(
                webview_builder,
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(1.0, 1.0),
            )
            .map_err(|error| format!("The embedded Browser could not be created: {error}"))?;
        webview
            .hide()
            .map_err(|error| format!("The embedded Browser could not be hidden: {error}"))?;

        let entry = BrowserEntry {
            workspace_id: workspace_id.clone(),
            preview_id,
            webview,
            current_url: url.to_string(),
            title: String::new(),
            loading: true,
            error: None,
            history: vec![url.to_string()],
            history_index: 0,
            pending_history_action: None,
        };
        self.inner
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?
            .insert(browser_id.clone(), entry);

        let state = self
            .inner
            .snapshot(&browser_id)?
            .ok_or_else(|| "The Browser was created but its state was unavailable.".to_owned())?;
        emit_event(
            app,
            BrowserEvent {
                event: BrowserEventKind::State,
                state: state.clone(),
                notice: None,
            },
        );
        Ok(state)
    }

    pub(crate) fn navigate(
        &self,
        app: &AppHandle,
        request: &BrowserNavigationRequest,
    ) -> Result<BrowserRuntimeState, String> {
        let url = normalize_browser_input(&request.url)?;
        let state = self.inner.navigate(&request.browser_id, url)?;
        emit_event(
            app,
            BrowserEvent {
                event: BrowserEventKind::State,
                state: state.clone(),
                notice: None,
            },
        );
        Ok(state)
    }

    pub(crate) fn back(
        &self,
        app: &AppHandle,
        browser_id: &str,
    ) -> Result<BrowserRuntimeState, String> {
        let state = self.inner.history_action(browser_id, HistoryAction::Back)?;
        emit_event(
            app,
            BrowserEvent {
                event: BrowserEventKind::State,
                state: state.clone(),
                notice: None,
            },
        );
        Ok(state)
    }

    pub(crate) fn forward(
        &self,
        app: &AppHandle,
        browser_id: &str,
    ) -> Result<BrowserRuntimeState, String> {
        let state = self
            .inner
            .history_action(browser_id, HistoryAction::Forward)?;
        emit_event(
            app,
            BrowserEvent {
                event: BrowserEventKind::State,
                state: state.clone(),
                notice: None,
            },
        );
        Ok(state)
    }

    pub(crate) fn reload(
        &self,
        app: &AppHandle,
        browser_id: &str,
    ) -> Result<BrowserRuntimeState, String> {
        let state = self.inner.reload(browser_id)?;
        emit_event(
            app,
            BrowserEvent {
                event: BrowserEventKind::State,
                state: state.clone(),
                notice: None,
            },
        );
        Ok(state)
    }

    pub(crate) fn set_bounds(&self, request: &BrowserBoundsRequest) -> Result<(), String> {
        self.inner.set_bounds(request)
    }

    pub(crate) fn focus(&self, browser_id: &str) -> Result<(), String> {
        self.inner.focus(browser_id)
    }

    pub(crate) fn close(&self, browser_id: &str) -> Result<(), String> {
        self.inner.close(browser_id)
    }

    pub(crate) fn close_all(&self) {
        let entries = self
            .inner
            .entries
            .lock()
            .map(|mut entries| entries.drain().map(|(_, entry)| entry).collect::<Vec<_>>())
            .unwrap_or_default();
        for entry in entries {
            let _ = entry.webview.close();
        }
    }
}

impl BrowserManagerInner {
    fn snapshot(&self, browser_id: &str) -> Result<Option<BrowserRuntimeState>, String> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        Ok(entries.get(browser_id).map(snapshot_from_entry))
    }

    fn navigate(&self, browser_id: &str, url: Url) -> Result<BrowserRuntimeState, String> {
        let webview = {
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
            let entry = entries
                .get_mut(browser_id)
                .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?;
            entry.loading = true;
            entry.error = None;
            entry.pending_history_action = None;
            entry.current_url = url.to_string();
            entry.webview.clone()
        };
        webview
            .navigate(url)
            .map_err(|error| format!("The Browser could not navigate: {error}"))?;
        self.snapshot(browser_id)?
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())
    }

    fn history_action(
        &self,
        browser_id: &str,
        action: HistoryAction,
    ) -> Result<BrowserRuntimeState, String> {
        let webview = {
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
            let entry = entries
                .get_mut(browser_id)
                .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?;
            let can_move = match action {
                HistoryAction::Back => entry.history_index > 0,
                HistoryAction::Forward => entry.history_index + 1 < entry.history.len(),
            };
            if !can_move {
                return Ok(snapshot_from_entry(entry));
            }
            entry.loading = true;
            entry.error = None;
            entry.pending_history_action = Some(action);
            entry.webview.clone()
        };
        let script = match action {
            HistoryAction::Back => "history.back()",
            HistoryAction::Forward => "history.forward()",
        };
        webview
            .eval(script)
            .map_err(|error| format!("The Browser history action failed: {error}"))?;
        self.snapshot(browser_id)?
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())
    }

    fn reload(&self, browser_id: &str) -> Result<BrowserRuntimeState, String> {
        let webview = {
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
            let entry = entries
                .get_mut(browser_id)
                .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?;
            entry.loading = true;
            entry.error = None;
            entry.webview.clone()
        };
        webview
            .reload()
            .map_err(|error| format!("The Browser could not reload: {error}"))?;
        self.snapshot(browser_id)?
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())
    }

    fn set_bounds(&self, request: &BrowserBoundsRequest) -> Result<(), String> {
        let webview = {
            let entries = self
                .entries
                .lock()
                .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
            entries
                .get(&request.browser_id)
                .map(|entry| entry.webview.clone())
                .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?
        };
        if !request.visible || request.width < 1.0 || request.height < 1.0 {
            return webview
                .hide()
                .map_err(|error| format!("The Browser could not be hidden: {error}"));
        }
        webview
            .set_bounds(tauri::Rect {
                position: tauri::Position::Logical(LogicalPosition::new(request.x, request.y)),
                size: tauri::Size::Logical(LogicalSize::new(request.width, request.height)),
            })
            .map_err(|error| format!("The Browser could not be resized: {error}"))?;
        webview
            .show()
            .map_err(|error| format!("The Browser could not be shown: {error}"))
    }

    fn focus(&self, browser_id: &str) -> Result<(), String> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        entries
            .get(browser_id)
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?
            .webview
            .set_focus()
            .map_err(|error| format!("The Browser could not receive focus: {error}"))
    }

    fn close(&self, browser_id: &str) -> Result<(), String> {
        let entry = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?
            .remove(browser_id);
        if let Some(entry) = entry {
            entry
                .webview
                .close()
                .map_err(|error| format!("The Browser could not close: {error}"))?;
        }
        Ok(())
    }

    fn show(&self, browser_id: &str) -> Result<(), String> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        entries
            .get(browser_id)
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?
            .webview
            .show()
            .map_err(|error| format!("The Browser could not be shown: {error}"))
    }

    fn page_load_started(
        &self,
        browser_id: &str,
        url: String,
    ) -> Result<Option<BrowserRuntimeState>, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        let Some(entry) = entries.get_mut(browser_id) else {
            return Ok(None);
        };
        entry.current_url = url;
        entry.loading = true;
        entry.error = None;
        Ok(Some(snapshot_from_entry(entry)))
    }

    fn page_load_finished(
        &self,
        browser_id: &str,
        url: String,
    ) -> Result<Option<BrowserRuntimeState>, String> {
        let (state, preview) = {
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
            let Some(entry) = entries.get_mut(browser_id) else {
                return Ok(None);
            };
            match entry.pending_history_action.take() {
                Some(HistoryAction::Back) => {
                    entry.history_index = entry.history_index.saturating_sub(1);
                }
                Some(HistoryAction::Forward) => {
                    entry.history_index =
                        (entry.history_index + 1).min(entry.history.len().saturating_sub(1));
                }
                None => {
                    if entry.history.get(entry.history_index).map(String::as_str)
                        != Some(url.as_str())
                    {
                        entry.history.truncate(entry.history_index + 1);
                        entry.history.push(url.clone());
                        entry.history_index = entry.history.len().saturating_sub(1);
                    }
                }
            }
            entry.current_url = url.clone();
            entry.loading = false;
            entry.error = None;
            let state = snapshot_from_entry(entry);
            let preview = CodePreviewSummary {
                id: entry.preview_id.clone(),
                workspace_id: entry.workspace_id.clone(),
                url,
                origin: Url::parse(&state.url)
                    .map(|url| url.origin().ascii_serialization())
                    .unwrap_or_default(),
                state: CodePreviewState::Open,
            };
            (state, preview)
        };
        let persistence = self.persistence.clone();
        tauri::async_runtime::spawn(async move {
            let _ = persistence.save_code_preview(&preview, now_ms()).await;
        });
        Ok(Some(state))
    }

    fn title_changed(
        &self,
        browser_id: &str,
        title: String,
    ) -> Result<Option<BrowserRuntimeState>, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        let Some(entry) = entries.get_mut(browser_id) else {
            return Ok(None);
        };
        entry.title = title;
        Ok(Some(snapshot_from_entry(entry)))
    }
}

fn snapshot_from_entry(entry: &BrowserEntry) -> BrowserRuntimeState {
    BrowserRuntimeState {
        browser_id: entry.preview_id.clone(),
        workspace_id: entry.workspace_id.clone(),
        url: entry.current_url.clone(),
        title: entry.title.clone(),
        loading: entry.loading,
        can_go_back: entry.history_index > 0,
        can_go_forward: entry.history_index + 1 < entry.history.len(),
        error: entry.error.clone(),
    }
}

fn emit_event(app: &AppHandle, event: BrowserEvent) {
    let _ = app.emit_to("main", BROWSER_EVENT, event);
}

pub(crate) fn normalize_browser_input(value: &str) -> Result<Url, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Url::parse(GOOGLE_HOME).map_err(|error| error.to_string());
    }

    if trimmed.contains("://") || trimmed.starts_with("//") {
        let url = Url::parse(trimmed)
            .map_err(|_| "Browser address must be a valid URL or search text.".to_owned())?;
        return validate_browser_url(&url);
    }

    if let Some(candidate) = bare_host_candidate(trimmed) {
        let scheme = if is_local_host(&candidate) {
            "http"
        } else {
            "https"
        };
        return validate_browser_url(
            &Url::parse(&format!("{scheme}://{candidate}"))
                .map_err(|_| "Browser address must be a valid URL or search text.".to_owned())?,
        );
    }

    if let Ok(url) = Url::parse(trimmed) {
        return validate_browser_url(&url);
    }

    let mut search = Url::parse("https://www.google.com/search")
        .map_err(|error| format!("Google search URL could not be created: {error}"))?;
    search.query_pairs_mut().append_pair("q", trimmed);
    Ok(search)
}

fn bare_host_candidate(value: &str) -> Option<String> {
    if value.chars().any(char::is_whitespace) || value.contains('\\') {
        return None;
    }
    if value.contains("://") || value.starts_with("//") {
        return None;
    }
    let candidate = value.trim_end_matches('/');
    if candidate.is_empty() || candidate.contains('#') || candidate.contains('?') {
        return None;
    }
    let host = candidate
        .split_once('/')
        .map(|(host, _)| host)
        .unwrap_or(candidate);
    if host.contains('@') {
        return None;
    }
    if host.eq_ignore_ascii_case("localhost")
        || host.to_ascii_lowercase().starts_with("localhost:")
        || host.starts_with("127.0.0.1:")
        || host.starts_with("[::1]")
        || host.parse::<std::net::IpAddr>().is_ok()
        || host.contains('.')
        || host.contains(':')
    {
        Some(candidate.to_owned())
    } else {
        None
    }
}

fn is_local_host(value: &str) -> bool {
    let host_port = value
        .split_once('/')
        .map(|(host, _)| host)
        .unwrap_or(value)
        .trim();
    let host = if let Some((host, _)) = host_port
        .strip_prefix('[')
        .and_then(|value| value.split_once(']'))
    {
        host
    } else {
        host_port.split(':').next().unwrap_or(host_port)
    };
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false)
}

pub(crate) fn is_allowed_browser_url(url: &Url) -> bool {
    validate_browser_url(url).is_ok()
}

fn validate_browser_url(url: &Url) -> Result<Url, String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Browser supports only HTTP and HTTPS URLs.".to_owned());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Browser URLs cannot contain embedded credentials.".to_owned());
    }
    if url.host_str().is_none() {
        return Err("Browser URL must include a host.".to_owned());
    }
    Ok(url.clone())
}

fn download_filename(url: &Url) -> String {
    let name = url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|value| !value.is_empty())
        .unwrap_or("download");
    sanitize_filename(name)
}

fn sanitize_filename(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    let sanitized = sanitized.trim().trim_matches('.');
    if sanitized.is_empty() {
        "download".to_owned()
    } else {
        sanitized.chars().take(120).collect()
    }
}

fn unique_download_path(directory: &Path, filename: &str) -> PathBuf {
    let candidate = directory.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let stem = candidate
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let extension = candidate.extension().and_then(|value| value.to_str());
    for index in 1..10_000 {
        let name = match extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = directory.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{stem}-{}", uuid::Uuid::now_v7()))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::{is_allowed_browser_url, normalize_browser_input};

    #[test]
    fn plain_text_uses_google_search() {
        let url = normalize_browser_input("rust tauri webview").unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("www.google.com"));
        assert_eq!(url.query(), Some("q=rust+tauri+webview"));
    }

    #[test]
    fn local_hosts_default_to_http() {
        let url = normalize_browser_input("localhost:5173/dashboard").unwrap();
        assert_eq!(url.as_str(), "http://localhost:5173/dashboard");
        let url = normalize_browser_input("LOCALHOST/dashboard").unwrap();
        assert_eq!(url.as_str(), "http://localhost/dashboard");
    }

    #[test]
    fn hostname_defaults_to_https() {
        let url = normalize_browser_input("example.com/docs").unwrap();
        assert_eq!(url.as_str(), "https://example.com/docs");
    }

    #[test]
    fn unsafe_schemes_are_rejected() {
        let url = url::Url::parse("javascript:alert(1)").unwrap();
        assert!(!is_allowed_browser_url(&url));
        assert!(normalize_browser_input("file:///tmp/index.html").is_err());
    }

    #[test]
    fn credentials_are_rejected() {
        let url = url::Url::parse("https://user:pass@example.com").unwrap();
        assert!(!is_allowed_browser_url(&url));
        assert!(normalize_browser_input("mailto:user@example.com").is_err());
    }
}
