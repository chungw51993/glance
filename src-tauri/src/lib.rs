mod commands;
mod models;
mod providers;
mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // AI provider settings
            commands::settings::save_api_key,
            commands::settings::has_api_key,
            commands::settings::delete_api_key,
            commands::settings::test_provider_connection,
            commands::settings::get_provider_config,
            commands::settings::set_provider_config,
            commands::settings::list_provider_models,
            commands::settings::save_ollama_url,
            commands::settings::get_ollama_url,
            // Ticket provider settings
            commands::settings::save_linear_token,
            commands::settings::has_linear_token,
            commands::settings::delete_linear_token,
            commands::settings::save_jira_credentials,
            commands::settings::has_jira_credentials,
            commands::settings::delete_jira_credentials,
            commands::settings::save_jira_domain,
            commands::settings::get_jira_domain,
            commands::settings::save_asana_token,
            commands::settings::has_asana_token,
            commands::settings::delete_asana_token,
            // Git provider settings
            commands::git_provider::get_git_provider_type,
            commands::git_provider::set_git_provider_type,
            commands::git_provider::save_git_token,
            commands::git_provider::has_git_provider_token,
            commands::git_provider::delete_git_token,
            commands::git_provider::has_git_token,
            // Git provider operations
            commands::git_provider::get_authenticated_user,
            commands::git_provider::list_repos,
            commands::git_provider::list_open_pull_requests,
            commands::git_provider::list_assigned_prs,
            commands::git_provider::get_pull_request_detail,
            commands::git_provider::run_ai_review,
            commands::git_provider::submit_pr_review,
            commands::git_provider::get_pr_merge_status,
            commands::git_provider::merge_pull_request,
            commands::git_provider::get_pr_files,
            commands::git_provider::get_check_status,
            commands::git_provider::fetch_tickets,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
