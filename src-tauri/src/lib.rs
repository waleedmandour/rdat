//! RDAT Copilot — Tauri 2 backend entry point.
//!
//! Registers all Tauri commands (Ollama-related, file dialogs, etc.)
//! and boots the webview pointing at the Vite dev server (dev) or the
//! built `dist/` directory (production).

mod commands;

use commands::gemini::gemini_translate;
use commands::ollama::{
    ollama_health, ollama_list_models, ollama_pull_model, ollama_remove_model, ollama_translate,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        // NOTE: Updater plugin disabled in v0.2.0 — requires signing keypair
        // which is not yet generated. Re-enable in v0.3.0 after running:
        //   npx @tauri-apps/cli signer generate -w ~/.tauri/rdat.key
        // and setting tauri.conf.json → plugins.updater.pubkey + active: true
        // .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            // ── Ollama commands (PRIMARY engine) ──
            ollama_health,
            ollama_list_models,
            ollama_pull_model,
            ollama_remove_model,
            ollama_translate,
            // ── Gemini commands (SECONDARY fallback) ──
            gemini_translate,
        ])
        .setup(|_app| {
            // App setup hook — log a startup banner so users can verify
            // the Rust backend is running.
            println!("[rdat] Tauri backend started. Ollama: http://localhost:11434 | Gemini: REST API proxy");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
