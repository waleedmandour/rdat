//! Gemini API proxy commands.
//!
//! In Tauri mode, there are no Vercel serverless functions to proxy
//! Gemini API calls. The webview cannot call generativelanguage.googleapis.com
//! directly because:
//!   1. CORS may block browser-side calls (unverified)
//!   2. Post June 19 2026, unrestricted API keys stop working — keys
//!      must be restricted, and desktop apps can satisfy some
//!      restrictions (IP-based) more easily from Rust than from a browser
//!   3. Keeping the key out of the webview bundle is more secure
//!
//! These commands use reqwest to call the Gemini REST API from the Rust
//! side, with the user-provided key stored in the frontend (localStorage)
//! and passed in the request body on each call.
//!
//! Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//! Docs: https://ai.google.dev/gemini-api/docs/text-generation

use serde::{Deserialize, Serialize};
use std::time::Duration;

const GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .expect("failed to build reqwest client for Gemini")
}

// ─── Request / Response Types ─────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiTranslateRequest {
    /// Gemini model ID (e.g. "gemini-2.5-flash")
    pub model: String,
    pub system_prompt: String,
    pub user_prompt: String,
    pub max_tokens: u32,
    pub temperature: f32,
    /// User-provided Gemini API key (stored in frontend localStorage)
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeminiTranslateResponse {
    pub candidates: Vec<String>,
    pub error: Option<String>,
}

// ─── Gemini REST API Types ────────────────────────────────────────

#[derive(Debug, Serialize)]
struct GeminiRequestBody {
    #[serde(rename = "system_instruction")]
    system_instruction: GeminiContent,
    contents: Vec<GeminiContent>,
    #[serde(rename = "generationConfig")]
    generation_config: GeminiGenerationConfig,
}

#[derive(Debug, Serialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
    role: Option<String>,
}

#[derive(Debug, Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Debug, Serialize)]
struct GeminiGenerationConfig {
    #[serde(rename = "maxOutputTokens")]
    max_output_tokens: u32,
    temperature: f32,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
    #[serde(rename = "promptFeedback")]
    prompt_feedback: Option<GeminiPromptFeedback>,
    error: Option<GeminiError>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiContentResponse>,
}

#[derive(Debug, Deserialize)]
struct GeminiContentResponse {
    parts: Option<Vec<GeminiPartResponse>>,
}

#[derive(Debug, Deserialize)]
struct GeminiPartResponse {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiPromptFeedback {
    #[serde(rename = "blockReason")]
    block_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiError {
    message: String,
    code: Option<u32>,
    status: Option<String>,
}

// ─── Command: gemini_translate ────────────────────────────────────

/// Generate a translation via the Gemini REST API.
///
/// Takes a system prompt + user prompt (same as the Ollama command)
/// plus the user's Gemini API key, and returns 1 translation candidate.
///
/// The system prompt is built by the JS adapter (buildRAGSystemPrompt)
/// and may include RAG context. The user prompt contains the source
/// text and optional target prefix.
#[tauri::command]
pub async fn gemini_translate(req: GeminiTranslateRequest) -> Result<GeminiTranslateResponse, String> {
    if req.api_key.trim().is_empty() {
        return Ok(GeminiTranslateResponse {
            candidates: vec![],
            error: Some(
                "No Gemini API key provided. Please open the API Keys panel and enter your key.".to_string()
            ),
        });
    }

    let model = if req.model.is_empty() { "gemini-2.5-flash".to_string() } else { req.model.clone() };
    let url = format!("{}/{}:generateContent?key={}", GEMINI_BASE_URL, model, req.api_key.trim());

    let body = GeminiRequestBody {
        system_instruction: GeminiContent {
            parts: vec![GeminiPart { text: req.system_prompt }],
            role: None,
        },
        contents: vec![GeminiContent {
            parts: vec![GeminiPart { text: req.user_prompt }],
            role: Some("user".to_string()),
        }],
        generation_config: GeminiGenerationConfig {
            max_output_tokens: req.max_tokens,
            temperature: req.temperature,
        },
    };

    eprintln!("[gemini_translate] model={} max_tokens={}", model, req.max_tokens);

    let client = http_client();
    let resp = match client.post(&url).json(&body).send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(GeminiTranslateResponse {
                candidates: vec![],
                error: Some(format!("Network error calling Gemini: {}", e)),
            });
        }
    };

    let status = resp.status();
    let raw_text = resp.text().await.unwrap_or_default();

    // Try to parse as GeminiResponse
    let gemini_resp: GeminiResponse = match serde_json::from_str(&raw_text) {
        Ok(r) => r,
        Err(e) => {
            return Ok(GeminiTranslateResponse {
                candidates: vec![],
                error: Some(format!(
                    "Failed to parse Gemini response (status {}): {} — preview: {}",
                    status, e, &raw_text[..raw_text.len().min(200)]
                )),
            });
        }
    };

    // Check for API error
    if let Some(err) = gemini_resp.error {
        return Ok(GeminiTranslateResponse {
            candidates: vec![],
            error: Some(format!(
                "Gemini API error ({}): {} — {}",
                err.code.unwrap_or(0),
                err.status.unwrap_or_else(|| "UNKNOWN".to_string()),
                err.message
            )),
        });
    }

    // Check for blocked prompt
    if let Some(feedback) = gemini_resp.prompt_feedback {
        if let Some(reason) = feedback.block_reason {
            return Ok(GeminiTranslateResponse {
                candidates: vec![],
                error: Some(format!("Prompt blocked by Gemini: {}", reason)),
            });
        }
    }

    // Extract text from candidates
    let candidates: Vec<String> = gemini_resp
        .candidates
        .unwrap_or_default()
        .into_iter()
        .filter_map(|c| c.content)
        .filter_map(|content| content.parts)
        .flatten()
        .filter_map(|part| part.text)
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();

    if candidates.is_empty() {
        return Ok(GeminiTranslateResponse {
            candidates: vec![],
            error: Some("Gemini returned an empty translation.".to_string()),
        });
    }

    eprintln!("[gemini_translate] Success — {} candidate(s)", candidates.len());
    Ok(GeminiTranslateResponse {
        candidates,
        error: None,
    })
}
