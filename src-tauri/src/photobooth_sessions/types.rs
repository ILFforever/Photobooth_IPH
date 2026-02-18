use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PhotoboothSessionInfo {
    pub id: String,
    pub name: String,
    pub folder_name: String,
    pub shot_count: u32,
    pub created_at: String,
    pub last_used_at: String,
    pub thumbnails: Vec<String>, // Thumbnail URLs for the session's photos
    #[serde(default)]
    pub google_drive_metadata: GoogleDriveMetadata,
}

/// Google Drive uploaded image metadata
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DriveUploadedImage {
    pub filename: String,
    pub drive_file_id: String,
    pub uploaded_at: String,
}

/// Google Drive metadata for a session
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveMetadata {
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
    pub folder_link: Option<String>,
    pub account_id: Option<String>,  // Email of the account that created the folder
    pub uploaded_images: Vec<DriveUploadedImage>,
}

/// Photo entry in the .ptb session file
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PtbPhoto {
    pub filename: String,
    pub original_path: String,
    pub camera_path: String,
    pub captured_at: String,
}

/// Session data in the .ptb file
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PtbSessionData {
    pub id: String,
    pub name: String,
    pub folder_name: String,
    pub created_at: String,
    pub last_used_at: String,
    pub shot_count: u32,
    pub photos: Vec<PtbPhoto>,
    #[serde(default)]
    pub google_drive_metadata: GoogleDriveMetadata,
}

/// Delay settings for photobooth operations
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct DelaySettings {
    pub auto_count: u32,
    pub timer_delay: u32,
    pub delay_between_photos: u32,
    pub photo_review_time: u32,
}

/// Root .ptb file structure - stored at working folder root
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PtbWorkspace {
    pub name: String,
    pub created_at: String,
    pub last_used_at: String,
    pub current_session_id: Option<String>,
    pub sessions: Vec<PtbSessionData>,
    #[serde(default)]
    pub delay_settings: DelaySettings,
}
