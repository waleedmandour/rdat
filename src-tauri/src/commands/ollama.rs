//! Ollama-related Tauri commands.
//!
//! All HTTP communication with the Ollama daemon (localhost:11434)
//! happens here, on the Rust side. The webview cannot call Ollama
//! directly due to CORS and mixed-content restrictions.
//!
//! Endpoints used:
//!   - GET  /api/tags                 — list installed models
//!   - POST /api/pull                 — download a model (streamed)
//!   - DELETE /api/delete             — remove a model
//!   - POST /api/generate             — synchronous inference
//!
//! All commands return `Result<T, String>` so errors propagate
//! cleanly to the webview as rejected Promise values.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Base URL of the local Ollama daemon. Configurable via OLLAMA_HOST
/// env var (which Ollama itself respects); we fall back to 127.0.0.1.
///
/// IMPORTANT: We use 127.0.0.1 (IPv4 explicit) instead of "localhost"
/// because on Windows, "localhost" can resolve to ::1 (IPv6) first,
/// and Ollama by default only listens on IPv4 127.0.0.1. This causes
/// connection refused errors even when Ollama is running.
fn ollama_base_url() -> String {
    std::env::var("OLLAMA_HOST")
        .unwrap_or_else(|_| "http://127.0.0.1:11434".to_string())
}

/// Build a reqwest client with a generous timeout for inference calls
/// (Ollama's first load of a model can take 30+ seconds on cold disks).
fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .expect("failed to build reqwest client")
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
    done: bool,
}

// ─── Command: ollama_health ───────────────────────────────────────

/// Check if the Ollama daemon is reachable.
///
/// Tries multiple URL variants to handle common Windows issues:
///   1. The OLLAMA_HOST env var (if set)
///   2. http://127.0.0.1:11434 (IPv4 explicit — most reliable on Windows)
///   3. http://localhost:11434 (fallback for non-standard configs)
///
/// Returns `true` if ANY variant responds with HTTP 200 on /api/tags
/// within 5 seconds. Returns `false` (NOT an error) if all variants
/// fail — this lets the JS adapter fall back gracefully.
#[tauri::command]
pub async fn ollama_health() -> Result<bool, String> {
    let urls = vec![
        format!("{}/api/tags", ollama_base_url()),
        "http://127.0.0.1:11434/api/tags".to_string(),
        "http://localhost:11434/api/tags".to_string(),
    ];

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    for url in &urls {
        eprintln!("[ollama_health] Trying: {}", url);
        match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() => {
                eprintln!("[ollama_health] Success via: {}", url);
                return Ok(true);
            }
            Ok(resp) => {
                eprintln!("[ollama_health] {} returned status {}", url, resp.status());
                // Try next URL — daemon might be on a different address
            }
            Err(e) => {
                eprintln!("[ollama_health] {} failed: {}", url, e);
                // Try next URL
            }
        }
    }

    eprintln!("[ollama_health] All URL variants failed — Ollama not detected.");
    Ok(false)
}

// ─── Command: ollama_list_models ──────────────────────────────────

/// List all models currently installed in the Ollama daemon.
#[tauri::command]
pub async fn ollama_list_models() -> Result<Vec<OllamaModel>, String> {
    let url = format!("{}/api/tags", ollama_base_url());
    let client = http_client();

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
/// on the `ollama-pull-progress` channel. The JS adapter subscribes
/// to this channel to update the UI progress bar.
///
/// Returns `Ok(())` on success. On error, returns a string describing
/// what went wrong (network failure, out of disk space, invalid tag, etc.)
#[tauri::command]
pub async fn ollama_pull_model(
    app: AppHandle,
    model: String,
) -> Result<(), String> {
    let url = format!("{}/api/pull", ollama_base_url());
    let client = http_client();

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

    // Stream the response. Ollama emits newline-delimited JSON objects
    // with fields like { "status": "pulling 5e06face", "completed": 100,
    // "total": 1000 }. We compute percent and emit events.
    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Stream error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Process complete lines
        while let Some(newline_idx) = buffer.find('\n') {
            let line: String = buffer.drain(..=newline_idx).collect();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            // Try to parse as JSON and extract progress
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

                // Emit progress event to the webview
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
    let client = http_client();

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
///
/// Uses the `/api/generate` endpoint with a system + user prompt pair.
/// The system prompt is built by the JS adapter (via `buildRAGSystemPrompt`)
/// and may include RAG context entries. The user prompt contains the
/// source text and optional target prefix.
///
/// Returns up to 1 candidate (Ollama's `/api/generate` doesn't natively
/// return multiple completions; if you want N candidates, call this N
/// times with different seeds or use `/api/chat` with `n` parameter
/// — left as a future enhancement).
#[tauri::command]
pub async fn ollama_translate(req: TranslateRequest) -> Result<TranslateResponse, String> {
    let url = format!("{}/api/generate", ollama_base_url());
    let client = http_client();

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

    let translation = gen_resp.response.trim().to_string();

    if translation.is_empty() {
        return Ok(TranslateResponse {
            candidates: vec![],
            error: Some("Ollama returned an empty translation.".to_string()),
        });
    }

    Ok(TranslateResponse {
        candidates: vec![translation],
        error: None,
    })
}
