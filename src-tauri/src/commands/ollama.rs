//! Ollama-related Tauri commands.
//!
//! All HTTP communication with the local Ollama daemon happens here, on the
//! Rust side. The webview cannot call Ollama directly due to CORS and
//! mixed-content restrictions.
//!
//! Endpoints used:
//!   - GET  /api/tags   — list installed models / health check
//!   - POST /api/pull   — download a model (streamed)
//!   - DELETE /api/delete — remove a model
//!   - POST /api/generate — synchronous inference
//!
//! CRITICAL design decisions:
//!   1. ALL Ollama HTTP calls use `.no_proxy()` on the reqwest client.
//!      Loopback traffic must never go through a corporate proxy/VPN —
//!      doing so silently breaks detection on machines with HTTP_PROXY
//!      env vars or OS-level PAC/WPAD auto-proxy configured.
//!   2. OLLAMA_HOST env var is normalized: bare `host:port` gets a
//!      `http://` scheme prefix; values already having a scheme are
//!      used as-is. Matches Ollama's own convention.
//!   3. ollama_health returns structured diagnostics (which URLs were
//!      tried, which errors occurred) so the UI can surface them to
//!      the user — not just stderr.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// ─── URL Normalization ────────────────────────────────────────────

/// Normalize the OLLAMA_HOST env var or fall back to the default.
///
/// Ollama's own convention for OLLAMA_HOST is `HOST:PORT` with NO scheme
/// (e.g. `OLLAMA_HOST=0.0.0.0:11434`). Some users may copy a full URL
/// with a scheme already on it (`http://127.0.0.1:11434`). We handle
/// both forms:
///   - If the value starts with `http://` or `https://`, use as-is.
///   - Otherwise, prefix with `http://`.
///   - If no port is present, append `:11434` (Ollama's default).
///
/// Falls back to `http://127.0.0.1:11434` when OLLAMA_HOST is unset.
///
/// IMPORTANT: We use 127.0.0.1 (not "localhost") because on Windows,
/// "localhost" can resolve to ::1 (IPv6) first, and Ollama by default
/// only listens on IPv4 127.0.0.1.
fn ollama_base_url() -> String {
    let raw = std::env::var("OLLAMA_HOST")
        .unwrap_or_else(|_| "http://127.0.0.1:11434".to_string());
    normalize_ollama_url(&raw)
}

/// Normalize a raw OLLAMA_HOST value into a full base URL.
fn normalize_ollama_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        // Already a full URL — use as-is
        return trimmed.to_string();
    }
    // Bare host or host:port — prefix with http://
    if trimmed.contains(':') {
        // Has a port already
        format!("http://{}", trimmed)
    } else {
        // No port — append default
        format!("http://{}:11434", trimmed)
    }
}

/// Build a reqwest client for OLLAMA calls that explicitly bypasses
/// proxies. Loopback traffic must never go through a corporate proxy
/// or VPN — doing so silently breaks detection on machines with
/// HTTP_PROXY env vars or OS-level PAC/WPAD auto-proxy configured.
///
/// This is the #1 cause of "Ollama is installed but not detected"
/// field reports on Windows machines with corporate VPN/security software.
fn ollama_http_client(timeout_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .expect("failed to build reqwest client for Ollama")
}

/// Build a reqwest client for Ollama inference calls (longer timeout
/// for model loading + generation).
fn ollama_inference_client() -> reqwest::Client {
    ollama_http_client(300) // 5 minutes — cold model loads can take 30+ seconds
}

// ─── Shared Types ─────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
    pub digest: String,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaTagsModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsModel {
    name: String,
    size: u64,
    digest: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateRequest {
    pub model: String,
    pub system_prompt: String,
    pub user_prompt: String,
    pub max_tokens: u32,
    pub temperature: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranslateResponse {
    pub candidates: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OllamaGenerateResponse {
    response: String,
    #[allow(dead_code)]
    done: bool,
}

// ─── Health Check Diagnostics ─────────────────────────────────────

/// Diagnostic info for a single URL attempt in the health check.
/// Returned to the webview so the UI can show the user exactly which
/// URLs were tried and why they failed — not just stderr.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthAttempt {
    pub url: String,
    pub success: bool,
    pub error: Option<String>,
}

/// Structured result of an ollama_health call.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResult {
    pub healthy: bool,
    pub attempts: Vec<HealthAttempt>,
}

// ─── Command: ollama_health ───────────────────────────────────────

/// Check if the Ollama daemon is reachable.
///
/// Tries multiple URL variants to handle common issues:
///   1. The normalized OLLAMA_HOST env var (if set)
///   2. http://127.0.0.1:11434 (IPv4 explicit — most reliable on Windows)
///   3. http://localhost:11434 (fallback for non-standard configs)
///
/// Returns a structured `HealthResult` with per-URL diagnostics so the
/// UI can show the user exactly what was tried and why it failed —
/// not just a boolean. This is critical for field debugging: a
/// screenshot of the UI now contains enough info to diagnose the
/// issue without a remote debugging session.
///
/// ALL requests use `.no_proxy()` to bypass corporate VPNs/proxies
/// that would silently intercept loopback traffic.
#[tauri::command]
pub async fn ollama_health() -> Result<HealthResult, String> {
    let urls = vec![
        format!("{}/api/tags", ollama_base_url()),
        "http://127.0.0.1:11434/api/tags".to_string(),
        "http://localhost:11434/api/tags".to_string(),
    ];

    // 5s timeout per URL, no proxy bypass
    let client = ollama_http_client(5);

    let mut attempts: Vec<HealthAttempt> = Vec::new();

    for url in &urls {
        eprintln!("[ollama_health] Trying: {}", url);
        match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() => {
                eprintln!("[ollama_health] Success via: {}", url);
                attempts.push(HealthAttempt {
                    url: url.clone(),
                    success: true,
                    error: None,
                });
                return Ok(HealthResult {
                    healthy: true,
                    attempts,
                });
            }
            Ok(resp) => {
                let msg = format!("HTTP {}", resp.status());
                eprintln!("[ollama_health] {} returned: {}", url, msg);
                attempts.push(HealthAttempt {
                    url: url.clone(),
                    success: false,
                    error: Some(msg),
                });
            }
            Err(e) => {
                // Classify the error so the UI can show a useful message.
                // Note: reqwest doesn't expose is_dns_failure() directly;
                // we check the error string for DNS-related keywords.
                let error_str = e.to_string();
                let msg = if e.is_connect() {
                    "Connection refused".to_string()
                } else if e.is_timeout() {
                    "Timeout".to_string()
                } else if error_str.contains("dns")
                    || error_str.contains("DNS")
                    || error_str.contains("resolve")
                    || error_str.contains("name resolution")
                {
                    "DNS failure".to_string()
                } else {
                    error_str
                };
                eprintln!("[ollama_health] {} failed: {}", url, msg);
                attempts.push(HealthAttempt {
                    url: url.clone(),
                    success: false,
                    error: Some(msg),
                });
            }
        }
    }

    eprintln!("[ollama_health] All URL variants failed — Ollama not detected.");
    Ok(HealthResult {
        healthy: false,
        attempts,
    })
}

// ─── Command: ollama_list_models ──────────────────────────────────

/// List all models currently installed in the Ollama daemon.
#[tauri::command]
pub async fn ollama_list_models() -> Result<Vec<OllamaModel>, String> {
    let url = format!("{}/api/tags", ollama_base_url());
    let client = ollama_http_client(10);

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Ollama: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama returned status {}", resp.status()));
    }

    let body: OllamaTagsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    Ok(body
        .models
        .into_iter()
        .map(|m| OllamaModel {
            name: m.name,
            size: m.size,
            digest: m.digest,
        })
        .collect())
}

// ─── Command: ollama_pull_model ───────────────────────────────────

/// Pull (download) a model from the Ollama registry.
///
/// Streams progress events to the webview via Tauri's event system
/// on the `ollama-pull-progress` channel.
#[tauri::command]
pub async fn ollama_pull_model(
    app: AppHandle,
    model: String,
) -> Result<(), String> {
    let url = format!("{}/api/pull", ollama_base_url());
    let client = ollama_inference_client();

    eprintln!("[ollama_pull_model] Pulling model: {}", model);

    let resp = client
        .post(&url)
        .json(&serde_json::json!({ "name": model }))
        .send()
        .await
        .map_err(|e| format!("Failed to start pull: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama returned status {}: {}", status, body));
    }

    // Stream the NDJSON response
    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Stream error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline_idx) = buffer.find('\n') {
            let line: String = buffer.drain(..=newline_idx).collect();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                let status = json.get("status").and_then(|s| s.as_str()).unwrap_or("");
                let completed = json
                    .get("completed")
                    .and_then(|c| c.as_u64())
                    .unwrap_or(0);
                let total = json.get("total").and_then(|t| t.as_u64()).unwrap_or(0);

                let percent = if total > 0 {
                    ((completed as f64 / total as f64) * 100.0) as u32
                } else if status == "success" {
                    100
                } else {
                    0
                };

                eprintln!(
                    "[ollama_pull_model] {} — {}% ({}/{})",
                    status, percent, completed, total
                );

                let _ = app.emit(
                    "ollama-pull-progress",
                    serde_json::json!({ "percent": percent, "status": status }),
                );
            }
        }
    }

    eprintln!("[ollama_pull_model] Pull complete: {}", model);
    Ok(())
}

// ─── Command: ollama_remove_model ─────────────────────────────────

/// Delete a model from the Ollama daemon's local store.
#[tauri::command]
pub async fn ollama_remove_model(model: String) -> Result<(), String> {
    let url = format!("{}/api/delete", ollama_base_url());
    let client = ollama_http_client(30);

    let resp = client
        .delete(&url)
        .json(&serde_json::json!({ "name": model }))
        .send()
        .await
        .map_err(|e| format!("Failed to reach Ollama: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama returned status {}: {}", status, body));
    }

    Ok(())
}

// ─── Command: ollama_translate ────────────────────────────────────

/// Generate a translation via the Ollama daemon.
#[tauri::command]
pub async fn ollama_translate(req: TranslateRequest) -> Result<TranslateResponse, String> {
    let url = format!("{}/api/generate", ollama_base_url());
    let client = ollama_inference_client();

    eprintln!(
        "[ollama_translate] model={} max_tokens={} temperature={}",
        req.model, req.max_tokens, req.temperature
    );

    let body = serde_json::json!({
        "model": req.model,
        "system": req.system_prompt,
        "prompt": req.user_prompt,
        "stream": false,
        "options": {
            "num_predict": req.max_tokens,
            "temperature": req.temperature,
        }
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Ollama: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Ok(TranslateResponse {
            candidates: vec![],
            error: Some(format!("Ollama returned status {}: {}", status, body)),
        });
    }

    let gen_resp: OllamaGenerateResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    eprintln!(
        "[ollama_translate] Response received: response='{}' done={}",
        gen_resp.response.chars().take(100).collect::<String>(),
        gen_resp.done
    );

    let translation = gen_resp.response.trim().to_string();

    if translation.is_empty() {
        // Log the full request for debugging
        eprintln!(
            "[ollama_translate] Empty response! Model={}, prompt='{}'",
            req.model,
            req.user_prompt.chars().take(200).collect::<String>()
        );
        return Ok(TranslateResponse {
            candidates: vec![],
            error: Some("Ollama returned an empty translation. The model may not support this prompt format or may need a different temperature setting.".to_string()),
        });
    }

    eprintln!("[ollama_translate] Success: {} chars", translation.len());
    Ok(TranslateResponse {
        candidates: vec![translation],
        error: None,
    })
}
