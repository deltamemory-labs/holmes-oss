mod commands;
mod db;
mod documents;
mod error;
mod keystore;
mod memory;
mod providers;
mod search;
mod tools;

use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    /// Per-project BM25 index cache. Shared `Arc` so background Observer
    /// tasks can also invalidate it if they trigger ingestion.
    pub search: Arc<search::Cache>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Build the main window programmatically so we can vary chrome
            // per-OS. On macOS we want native traffic lights (Overlay titlebar
            // style); on Windows/Linux we want a fully chromeless frame so our
            // React titlebar can own the whole header.
            let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Holmes")
                .inner_size(1200.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .resizable(true);

            #[cfg(target_os = "macos")]
            let win_builder = win_builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                // Nudge the traffic lights down so they sit vertically centred
                // in our 36px titlebar strip.
                .traffic_light_position(tauri::LogicalPosition::new(16.0, 14.0));

            #[cfg(not(target_os = "macos"))]
            let win_builder = win_builder.decorations(false);

            win_builder.build()?;

            let db = db::init(app.handle()).expect("failed to init database");
            db::seed_workflows(&db).expect("failed to seed workflows");

            // Init keystore with app data dir
            let data_dir = app.path().app_data_dir().expect("no app data dir");
            keystore::init(&data_dir);

            app.manage(AppState {
                db,
                search: Arc::new(search::Cache::new()),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::validate_api_key,
            commands::settings::list_ollama_models,
            commands::projects::create_project,
            commands::projects::list_projects,
            commands::projects::get_project,
            commands::projects::delete_project,
            commands::projects::rename_project,
            commands::subfolders::create_subfolder,
            commands::subfolders::list_subfolders,
            commands::subfolders::rename_subfolder,
            commands::subfolders::move_subfolder,
            commands::subfolders::delete_subfolder,
            commands::subfolders::move_document_to_folder,
            commands::documents::upload_document,
            commands::documents::upload_new_version,
            commands::documents::list_document_versions,
            commands::documents::set_active_version,
            commands::documents::list_documents,
            commands::documents::read_document_bytes,
            commands::documents::delete_document,
            commands::documents::extract_docx_html,
            commands::chat::create_chat,
            commands::chat::list_chats,
            commands::chat::get_chat,
            commands::chat::get_chat_messages,
            commands::chat::delete_chat,
            commands::chat::send_message,
            commands::tabular::create_review,
            commands::tabular::list_reviews,
            commands::tabular::get_review_cells,
            commands::tabular::delete_review,
            commands::tabular::rename_review,
            commands::tabular::update_review_columns,
            commands::tabular::extract_single_cell,
            commands::tabular::add_documents_to_review,
            commands::tabular::extract_all_cells,
            commands::workflows::list_workflows,
            commands::workflows::get_workflow,
            commands::workflows::create_workflow,
            commands::workflows::update_workflow,
            commands::workflows::create_review_from_workflow,
            commands::workflows::delete_workflow,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
