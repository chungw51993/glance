mod commands;
mod models;
mod providers;
mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::settings::save_api_key,
            commands::settings::has_api_key,
            commands::settings::delete_api_key,
            commands::settings::test_provider_connection,
            commands::settings::get_provider_config,
            commands::settings::set_provider_config,
            commands::settings::list_provider_models,
            commands::settings::save_ollama_url,
            commands::settings::get_ollama_url,
            commands::settings::save_github_token,
            commands::settings::has_github_token,
            commands::settings::delete_github_token,
            commands::settings::save_linear_token,
            commands::settings::has_linear_token,
            commands::settings::delete_linear_token,
            commands::github::list_repos,
            commands::github::list_open_pull_requests,
            commands::github::list_assigned_prs,
            commands::github::get_pull_request_detail,
            commands::github::run_ai_review,
            commands::github::submit_pr_review,
            commands::github::get_pr_merge_status,
            commands::github::merge_pull_request,
            commands::github::get_pr_files,
            commands::github::fetch_linear_tickets,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
