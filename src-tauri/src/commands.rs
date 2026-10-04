//! Tauri command modules.
//!
//! Each submodule exposes commands that the webview can invoke via
//! `@tauri-apps/api/core → invoke()`.
//!   - `ollama`: local LLM via Ollama daemon (PRIMARY engine)
//!   - `gemini`: cloud fallback via Gemini REST API (SECONDARY)

pub mod gemini;
pub mod ollama;
