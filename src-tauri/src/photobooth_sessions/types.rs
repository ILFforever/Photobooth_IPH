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
    #[serde(default = "default_true")]
    pub qr_upload_enabled: bool,
    #[serde(default)]
    pub qr_upload_all_images: bool,
    #[serde(default = "default_photo_naming_scheme")]
    pub photo_naming_scheme: String,
}

fn default_true() -> bool {
    true
}

fn default_photo_naming_scheme() -> String {
    "IPH_{number}".to_string()
}

/// Delay settings for photobooth operations
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DelaySettings {
    pub auto_count: u32,
    pub timer_delay: u32,
    pub delay_between_photos: u32,
    pub photo_review_time: u32,
}

impl Default for DelaySettings {
    fn default() -> Self {
        Self {
            auto_count: 3,
            timer_delay: 3,
            delay_between_photos: 3,
            photo_review_time: 3,
        }
    }
}

/// Photobooth settings for QR upload and photo naming
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PhotoboothSettings {
    pub qr_upload_enabled: bool,
    pub qr_upload_all_images: bool,
    pub photo_naming_scheme: String,
}

impl Default for PhotoboothSettings {
    fn default() -> Self {
        Self {
            qr_upload_enabled: true,
            qr_upload_all_images: false,
            photo_naming_scheme: "IPH_{number}".to_string(),
        }
    }
}

/// Auto GIF settings
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GifSettings {
    pub auto_gif_enabled: bool,
    pub auto_gif_format: String, // "gif" | "both" | "video"
    pub auto_gif_photo_source: String, // "collage" | "all"
}

impl Default for GifSettings {
    fn default() -> Self {
        Self {
            auto_gif_enabled: false,
            auto_gif_format: "both".to_string(),
            auto_gif_photo_source: "collage".to_string(),
        }
    }
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
    #[serde(default)]
    pub photobooth_settings: PhotoboothSettings,
    #[serde(default)]
    pub gif_settings: GifSettings,
}

/// EXIF metadata for a photo
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PhotoExifData {
    pub filename: String,
    pub file_size: Option<u64>,
    pub image_width: Option<u32>,
    pub image_height: Option<u32>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub iso: Option<u32>,
    pub aperture: Option<String>,
    pub shutter_speed: Option<String>,
    pub focal_length: Option<String>,
    pub date_taken: Option<String>,
}
