use serde::{Deserialize, Serialize};

// Result types for operations
#[derive(Serialize, Deserialize, Clone)]
pub struct ProcessResult {
    pub folder_name: String,
    pub link: String,
    pub qr_data: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UploadProgress {
    pub step: String,
    pub current: usize,
    pub total: usize,
    pub message: String,
}

// Working folder image structures
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ImageDimensions {
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WorkingImage {
    pub path: String,
    pub filename: String,
    pub thumbnail: String,
    pub size: u64,
    pub extension: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dimensions: Option<ImageDimensions>,
}

#[derive(Serialize, Deserialize)]
pub struct WorkingFolderInfo {
    pub path: String,
    pub images: Vec<WorkingImage>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ThumbnailLoadProgress {
    pub current: usize,
    pub total: usize,
    pub image: WorkingImage,
}

// File info structures
#[derive(Serialize, Deserialize, Clone)]
pub struct FileInfo {
    pub size: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ImageFileInfo {
    pub path: String,
    pub size: u64,
    pub extension: String,
}

// History structure
#[derive(Serialize, Deserialize, Clone)]
pub struct HistoryItem {
    pub timestamp: String,
    pub folder_name: String,
    pub link: String,
    pub qr_data: String,
}
