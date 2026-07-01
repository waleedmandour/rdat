//! Tauri command modules.
//!
//! Each submodule exposes commands that the webview can invoke via
//! `@tauri-apps/api/core → invoke()`. Currently only `ollama` is
//! implemented; future modules (fs_dialog, updater helpers, etc.)
//! can be added here.

pub mod ollama;
