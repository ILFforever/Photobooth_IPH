use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum UploadStatus {
    Pending,
    Uploading,
    Completed,
    Failed,
    Retrying,
    Cancelled,
}

impl UploadStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            UploadStatus::Pending => "pending",
            UploadStatus::Uploading => "uploading",
            UploadStatus::Completed => "completed",
            UploadStatus::Failed => "failed",
            UploadStatus::Retrying => "retrying",
            UploadStatus::Cancelled => "cancelled",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UploadQueueItem {
    pub id: String,
    pub session_id: String,
    pub filename: String,
    pub local_path: String,
    pub drive_folder_id: String,
    pub status: UploadStatus,
    pub progress: u8,
    pub error: Option<String>,
    pub retry_count: u32,
    pub max_retries: u32,
    pub timeout_secs: u64,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub next_retry_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UploadQueueStats {
    pub total: usize,
    pub pending: usize,
    pub uploading: usize,
    pub completed: usize,
    pub failed: usize,
    pub retrying: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UploadQueueState {
    pub items: Vec<UploadQueueItem>,
    pub is_processing: bool,
    pub current_upload_id: Option<String>,
}

impl Default for UploadQueueState {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            is_processing: false,
            current_upload_id: None,
        }
    }
}

impl UploadQueueItem {
    pub fn new(
        id: String,
        session_id: String,
        filename: String,
        local_path: String,
        drive_folder_id: String,
    ) -> Self {
        Self {
            id,
            session_id,
            filename,
            local_path,
            drive_folder_id,
            status: UploadStatus::Pending,
            progress: 0,
            error: None,
            retry_count: 0,
            max_retries: 3,
            timeout_secs: 300, // 5 minutes default
            created_at: chrono::Utc::now().to_rfc3339(),
            started_at: None,
            completed_at: None,
            next_retry_at: None,
        }
    }

    pub fn can_retry(&self) -> bool {
        self.retry_count < self.max_retries
    }

    pub fn increment_retry(&mut self) {
        self.retry_count += 1;
    }

    pub fn get_timeout_duration(&self) -> Duration {
        Duration::from_secs(self.timeout_secs)
    }
}

impl UploadQueueStats {
    pub fn from_items(items: &[UploadQueueItem]) -> Self {
        let mut stats = Self {
            total: items.len(),
            pending: 0,
            uploading: 0,
            completed: 0,
            failed: 0,
            retrying: 0,
        };

        for item in items {
            match item.status {
                UploadStatus::Pending => stats.pending += 1,
                UploadStatus::Uploading => stats.uploading += 1,
                UploadStatus::Completed => stats.completed += 1,
                UploadStatus::Failed => stats.failed += 1,
                UploadStatus::Retrying => stats.retrying += 1,
                UploadStatus::Cancelled => {}
            }
        }

        stats
    }
}
