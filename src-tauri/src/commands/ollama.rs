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

/// Generate a translation via the Ollama daemon using /api/chat.
///
/// Uses /api/chat instead of /api/generate because:
///   1. /api/chat is the recommended endpoint in Ollama's current API
///   2. It handles system prompts more reliably with small models
///   3. It returns a cleaner message structure
///
/// The raw response body is captured as text first, then parsed,
/// so we can log it for debugging if parsing fails.
#[tauri::command]
pub async fn ollama_translate(req: TranslateRequest) -> Result<TranslateResponse, String> {
    let url = format!("{}/api/chat", ollama_base_url());
    let client = ollama_inference_client();

    eprintln!(
        "[ollama_translate] model={} max_tokens={} temperature={}",
        req.model, req.max_tokens, req.temperature
    );

    // Use /api/chat with messages array (more reliable than /api/generate)
    //
    // For Qwen 3 models (thinking models), use the native "think": false
    // API parameter to disable the thinking phase. This is the official
    // Ollama approach (https://docs.ollama.com/capabilities/thinking)
    // and is more reliable than appending "/no_think" to the prompt.
    let is_qwen3 = req.model.contains("qwen3");

    // Increase max_tokens for Qwen 3 to give room for output
    let effective_max_tokens = if is_qwen3 {
        std::cmp::max(req.max_tokens, 1024)
    } else {
        req.max_tokens
    };

    let body = serde_json::json!({
        "model": req.model,
        "messages": [
            {"role": "system", "content": req.system_prompt},
            {"role": "user", "content": req.user_prompt}
        ],
        "stream": false,
        "think": false,
        "options": {
            "num_predict": effective_max_tokens,
            "temperature": req.temperature,
        }
    });

    eprintln!(
        "[ollama_translate] Sending request to {} with model={}",
        url, req.model
    );

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Ollama: {}", e))?;

    let status = resp.status();
    // Capture raw response text BEFORE parsing
    let raw_body = resp.text().await.unwrap_or_default();

    eprintln!(
        "[ollama_translate] HTTP {} response ({} bytes): {}",
        status,
        raw_body.len(),
        raw_body.chars().take(500).collect::<String>()
    );

    if !status.is_success() {
        return Ok(TranslateResponse {
            candidates: vec![],
            error: Some(format!("Ollama returned status {}: {}", status, raw_body.chars().take(300).collect::<String>())),
        });
    }

    // Parse the raw body as JSON
    let json: serde_json::Value = match serde_json::from_str(&raw_body) {
        Ok(v) => v,
        Err(e) => {
            return Ok(TranslateResponse {
                candidates: vec![],
                error: Some(format!("Failed to parse Ollama JSON response: {} — raw: {}", e, raw_body.chars().take(200).collect::<String>())),
            });
        }
    };

    // Extract the message content from /api/chat response format:
    // { "message": { "role": "assistant", "content": "...", "thinking": "..." }, "done": true }
    //
    // IMPORTANT: Qwen 3 models are "thinking" models. They put their
    // reasoning into the "thinking" field and the final answer into
    // "content". But with low max_tokens (256), the model may use ALL
    // tokens for thinking and leave content empty.
    //
    // Strategy:
    //   1. Try "content" first (normal case)
    //   2. If empty, try "thinking" (model thought but ran out of tokens)
    //   3. If both empty, try /api/generate "response" field (fallback)
    let translation = json
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    // If content is empty, try the thinking field (Qwen 3 fallback)
    let translation = if translation.is_empty() {
        let thinking = json
            .get("message")
            .and_then(|m| m.get("thinking"))
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if !thinking.is_empty() {
            eprintln!(
                "[ollama_translate] Content was empty, using thinking field ({} chars). Model may need more tokens or /no_think.",
                thinking.len()
            );
        }
        thinking
    } else {
        translation
    };

    // Fallback: try /api/generate response format:
    // { "response": "...", "done": true }
    let translation = if translation.is_empty() {
        json.get("response")
            .and_then(|r| r.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    } else {
        translation
    };

    // ── Strip thinking text that leaked into content (Qwen 3) ──
    // Even with /no_think, Qwen 3 sometimes puts reasoning in content.
    // Common patterns: "Okay, let's...", "Let me...", "The user wants...",
    // "I need to...", "First, let's...", "<think>...</think>"
    //
    // Strategy: if the text starts with English reasoning phrases (not
    // Arabic), it's thinking text that leaked. Try to extract the Arabic
    // portion from the end. If no Arabic found, return empty.
    let translation = if is_qwen3 {
        strip_thinking_from_content(&translation)
    } else {
        translation
    };

    eprintln!(
        "[ollama_translate] Extracted translation ({} chars): '{}'",
        translation.len(),
        translation.chars().take(100).collect::<String>()
    );

    if translation.is_empty() {
        eprintln!(
            "[ollama_translate] EMPTY translation! Full response: {}",
            raw_body.chars().take(500).collect::<String>()
        );
        return Ok(TranslateResponse {
            candidates: vec![],
            error: Some(format!(
                "Ollama returned an empty translation. Model: {}. Raw response: {}",
                req.model,
                raw_body.chars().take(200).collect::<String>()
            )),
        });
    }

    eprintln!("[ollama_translate] Success: {} chars", translation.len());
    Ok(TranslateResponse {
        candidates: vec![translation],
        error: None,
    })
}

/// Strip thinking/reasoning text that Qwen 3 leaks into the content field.
///
/// Qwen 3 is supposed to put reasoning in the "thinking" field and the
/// answer in "content". But sometimes (especially without /no_think or
/// when /no_think is ignored), the reasoning leaks into content.
///
/// Patterns to detect and strip:
///   1. "<think>...</think>" tags
///   2. Text starting with English reasoning phrases like "Okay, let's",
///      "Let me", "The user wants", "I need to", "First, let's"
///   3. Any English text before the first Arabic character
///
/// Strategy: find the first Arabic character (Unicode range U+0600-U+06FF)
/// and return everything from that point. If no Arabic found, return empty.
fn strip_thinking_from_content(text: &str) -> String {
    let trimmed = text.trim();

    // If empty, return as-is
    if trimmed.is_empty() {
        return String::new();
    }

    // If the text starts with Arabic, it's probably fine (no thinking leaked)
    if let Some(first_char) = trimmed.chars().next() {
        if is_arabic_char(first_char) {
            return trimmed.to_string();
        }
    }

    // Strip <think>...</think> tags if present
    let without_think_tags = if trimmed.contains("<think>") {
        // Remove everything between <think> and </think> (inclusive)
        let mut result = String::new();
        let mut in_think = false;
        let mut buffer = String::new();
        for c in trimmed.chars() {
            buffer.push(c);
            if buffer.ends_with("<think>") {
                buffer.truncate(buffer.len() - 7);
                in_think = true;
                buffer.clear();
            } else if in_think && buffer.ends_with("</think>") {
                in_think = false;
                buffer.clear();
            } else if !in_think {
                // Only append non-think content
            }
        }
        result + &buffer
    } else {
        trimmed.to_string()
    };

    // Find the first Arabic character and return everything from there
    let cleaned = without_think_tags.trim();
    if cleaned.is_empty() {
        return String::new();
    }

    // Check if starts with Arabic
    if let Some(first_char) = cleaned.chars().next() {
        if is_arabic_char(first_char) {
            return cleaned.to_string();
        }
    }

    // Find first Arabic character position
    for (idx, c) in cleaned.char_indices() {
        if is_arabic_char(c) {
            let result = cleaned[idx..].trim().to_string();
            eprintln!(
                "[ollama_translate] Stripped thinking text ({} chars), extracted Arabic ({} chars)",
                idx,
                result.len()
            );
            return result;
        }
    }

    // No Arabic found at all - this is pure thinking text
    eprintln!(
        "[ollama_translate] No Arabic found in content, treating as pure thinking text (returning empty)"
    );
    String::new()
}

/// Check if a character is in the Arabic Unicode range (U+0600-U+06FF)
/// or Arabic Supplement (U+0750-U+077F) or Arabic Presentation Forms
/// (U+FB50-U+FDFF, U+FE70-U+FEFF).
fn is_arabic_char(c: char) -> bool {
    let code = c as u32;
    code >= 0x0600 && code <= 0x06FF
        || code >= 0x0750 && code <= 0x077F
        || code >= 0xFB50 && code <= 0xFDFF
        || code >= 0xFE70 && code <= 0xFEFF
}
