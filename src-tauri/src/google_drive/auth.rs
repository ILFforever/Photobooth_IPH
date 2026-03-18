use crate::state::{AppState, GoogleAccount};
use tauri::{Manager, State};
use yup_oauth2::{InstalledFlowAuthenticator, InstalledFlowReturnMethod};
use tauri_plugin_shell::ShellExt;

async fn load_client_secret(_app: &tauri::AppHandle) -> Result<yup_oauth2::ApplicationSecret, String> {
    // Embed the client_secret.json at compile time
    const CLIENT_SECRET_JSON: &str = include_str!("../../client_secret.json");

    let json_value: serde_json::Value = serde_json::from_str(CLIENT_SECRET_JSON)
        .map_err(|e| format!("Failed to parse embedded client_secret.json: {}", e))?;

    // Extract the "installed" field and parse it as ApplicationSecret
    let installed = json_value
        .get("installed")
        .ok_or("Missing 'installed' field in client_secret.json")?;

    serde_json::from_value(installed.clone())
        .map_err(|e| format!("Failed to parse ApplicationSecret: {}", e))
}

#[tauri::command]
pub async fn google_login(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<GoogleAccount, String> {
    let secret = load_client_secret(&app).await?;

    struct BrowserOpenerDelegate {
        app: tauri::AppHandle,
    }

    impl yup_oauth2::authenticator_delegate::InstalledFlowDelegate for BrowserOpenerDelegate {
        fn present_user_url<'a>(
            &'a self,
            url: &'a str,
            need_code: bool,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send + 'a>>
        {
            Box::pin(async move {
                // Use Tauri's shell plugin instead of open::that for better browser compatibility
                #[allow(deprecated)]
                let _ = self.app.shell().open(url, None);
                if need_code {
                    yup_oauth2::authenticator_delegate::DefaultInstalledFlowDelegate
                        .present_user_url(url, need_code)
                        .await
                } else {
                    Ok(String::new())
                }
            })
        }
    }

    let cache_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("tokencache_v2.json");

    if let Some(parent) = cache_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let auth = InstalledFlowAuthenticator::builder(secret, InstalledFlowReturnMethod::HTTPRedirect)
        .persist_tokens_to_disk(cache_path)
        .flow_delegate(Box::new(BrowserOpenerDelegate { app: app.clone() }))
        .build()
        .await
        .map_err(|e| format!("Failed to create authenticator: {}", e))?;

    // WARNING: These scopes are required for all Drive features to work. Do not modify.
    let all_scopes = &[
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/drive.meet.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
    ];
    let token = auth
        .token(all_scopes)
        .await
        .map_err(|e| format!("Failed to get token: {}", e))?;

    let client = reqwest::Client::new();
    let token_str = token.token().ok_or("No token available")?;

    let response = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(token_str)
        .send()
        .await
        .map_err(|e| format!("Failed to get user info: {}", e))?;

    if !response.status().is_success() {
        return Err("Failed to get user info".to_string());
    }

    let user_info: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    let account = GoogleAccount {
        email: user_info["email"].as_str().unwrap_or("").to_string(),
        name: user_info["name"].as_str().unwrap_or("User").to_string(),
        picture: user_info["picture"].as_str().map(|s| s.to_string()),
    };

    *state.auth.lock().map_err(|e| format!("State lock poisoned: {}", e))? = Some(auth);
    *state.account.lock().map_err(|e| format!("State lock poisoned: {}", e))? = Some(account.clone());

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }

    Ok(account)
}

#[tauri::command]
pub async fn google_logout(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    *state.auth.lock().map_err(|e| format!("State lock poisoned: {}", e))? = None;
    *state.account.lock().map_err(|e| format!("State lock poisoned: {}", e))? = None;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Remove ALL token cache files (the library may create multiple files)
    let token_cache_files = [
        "tokencache_v2.json",
        "tokenhcache_v2.json", // Old typo version that might exist
    ];

    for filename in token_cache_files {
        let cache_path = app_data_dir.join(filename);
        if cache_path.exists() {
            let _ = std::fs::remove_file(&cache_path);
        }
    }

    // Also check for any yup-oauth2 storage directory
    let oauth_storage_dir = app_data_dir.join("oauth_storage");
    if oauth_storage_dir.exists() && oauth_storage_dir.is_dir() {
        let _ = std::fs::remove_dir_all(&oauth_storage_dir);
    }

    Ok(())
}

#[tauri::command]
pub async fn check_cached_account(
    app: tauri::AppHandle,
) -> Result<Option<GoogleAccount>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let cache_path = app_data_dir.join("tokencache_v2.json");

    if !cache_path.exists() {
        // Also check for the old typo version
        let old_cache_path = app_data_dir.join("tokenhcache_v2.json");
        if old_cache_path.exists() {
            return Ok(None); // Don't use the old cache
        }
        return Ok(None);
    }

    let secret = load_client_secret(&app).await?;

    let auth = InstalledFlowAuthenticator::builder(secret, InstalledFlowReturnMethod::HTTPRedirect)
        .persist_tokens_to_disk(&cache_path)
        .build()
        .await
        .map_err(|e| format!("Failed to create authenticator: {}", e))?;

    let all_scopes = &[
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
    ];

    let token = match auth.token(all_scopes).await {
        Ok(t) => t,
        Err(_) => return Ok(None),
    };

    let client = reqwest::Client::new();
    let token_str = token.token().ok_or("No token available")?;

    let response = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(token_str)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch user info: {}", e))?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let user_info: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    let account = GoogleAccount {
        email: user_info["email"].as_str().unwrap_or("").to_string(),
        name: user_info["name"]
            .as_str()
            .unwrap_or("Unknown")
            .to_string(),
        picture: user_info["picture"].as_str().map(|s| s.to_string()),
    };

    Ok(Some(account))
}

#[tauri::command]
pub async fn get_account(state: State<'_, AppState>) -> Result<Option<GoogleAccount>, String> {
    Ok(state.account.lock().map_err(|e| format!("State lock poisoned: {}", e))?.clone())
}
