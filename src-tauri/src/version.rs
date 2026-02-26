//! Application version constants
//! Single source of truth for version information

/// Embedded app version - update this when releasing a new app build
/// Format: MAJOR.MINOR.PATCH (e.g., "1.0.13")
pub const APP_VERSION: &str = "1.0.15";

/// Application display name
pub const APP_NAME: &str = "Photobooth IPH";

/// Short name for UI
pub const APP_SHORT_NAME: &str = "IPH Photobooth";

/// Company name
pub const COMPANY_NAME: &str = "Intania Production House";

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AppInfo {
    pub version: String,
    pub name: String,
    pub short_name: String,
    pub company: String,
}

/// Get app information (version, name, etc.)
#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        version: APP_VERSION.to_string(),
        name: APP_NAME.to_string(),
        short_name: APP_SHORT_NAME.to_string(),
        company: COMPANY_NAME.to_string(),
    }
}
