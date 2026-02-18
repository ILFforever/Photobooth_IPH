use super::types::{UploadQueueItem, UploadQueueState, UploadStatus, UploadQueueStats};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, RwLock};
use tokio::time::{sleep, timeout};

/// Upload queue manager
#[derive(Clone)]
pub struct UploadQueue {
    state: Arc<RwLock<UploadQueueState>>,
    is_processing: Arc<Mutex<bool>>,
    processor_started: Arc<Mutex<bool>>,
    app_handle: Arc<Mutex<Option<tauri::AppHandle>>>,
}

impl UploadQueue {
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(UploadQueueState::default())),
            is_processing: Arc::new(Mutex::new(false)),
            processor_started: Arc::new(Mutex::new(false)),
            app_handle: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn set_app_handle(&self, app_handle: tauri::AppHandle) {
        let mut handle = self.app_handle.lock().await;
        *handle = Some(app_handle);
    }

    /// Add an item to the upload queue
    pub async fn enqueue(&self, item: UploadQueueItem) -> Result<(), String> {
        let mut state = self.state.write().await;
        state.items.push(item);
        Ok(())
    }

    /// Add multiple items to the upload queue
    pub async fn enqueue_batch(&self, items: Vec<UploadQueueItem>) -> Result<(), String> {
        // Start processor if this is the first enqueue
        {
            let mut started = self.processor_started.lock().await;
            if !*started {
                *started = true;
                drop(started);

                // Get the app handle
                let app_handle_opt = self.app_handle.lock().await;
                if let Some(app_handle) = app_handle_opt.clone() {
                    let queue = Arc::new(self.clone());
                    tokio::spawn(async move {
                        use super::processor::start_upload_queue_processor_with_queue;

                        start_upload_queue_processor_with_queue(queue, app_handle);
                    });
                }
            }
        }

        let mut state = self.state.write().await;
        state.items.extend(items);
        Ok(())
    }

    /// Get all items for a specific session
    pub async fn get_session_items(&self, session_id: &str) -> Vec<UploadQueueItem> {
        let state = self.state.read().await;
        state.items
            .iter()
            .filter(|item| item.session_id == session_id)
            .cloned()
            .collect()
    }

    /// Get the current state of the queue
    pub async fn get_state(&self) -> UploadQueueState {
        let state = self.state.read().await;
        UploadQueueState {
            items: state.items.clone(),
            is_processing: *self.is_processing.lock().await,
            current_upload_id: state.current_upload_id.clone(),
        }
    }

    /// Get queue statistics
    pub async fn get_stats(&self) -> UploadQueueStats {
        let state = self.state.read().await;
        UploadQueueStats::from_items(&state.items)
    }

    /// Remove items from queue (e.g., when a session is deleted)
    pub async fn remove_session_items(&self, session_id: &str) {
        let mut state = self.state.write().await;
        state.items.retain(|item| item.session_id != session_id);
    }

    /// Remove a specific item from the queue
    pub async fn remove_item(&self, item_id: &str) -> Result<(), String> {
        let mut state = self.state.write().await;
        let original_len = state.items.len();
        state.items.retain(|item| item.id != item_id);

        if state.items.len() == original_len {
            return Err(format!("Item not found: {}", item_id));
        }

        Ok(())
    }

    /// Retry a failed upload
    pub async fn retry_item(&self, item_id: &str) -> Result<(), String> {
        let mut state = self.state.write().await;

        if let Some(item) = state.items.iter_mut().find(|i| i.id == item_id) {
            if item.status == UploadStatus::Failed {
                item.status = UploadStatus::Pending;
                item.error = None;
                return Ok(());
            }
            return Err(format!("Item is not in failed state: {}", item_id));
        }

        Err(format!("Item not found: {}", item_id))
    }

    /// Cancel an upload
    pub async fn cancel_item(&self, item_id: &str) -> Result<(), String> {
        let mut state = self.state.write().await;

        if let Some(item) = state.items.iter_mut().find(|i| i.id == item_id) {
            if matches!(item.status, UploadStatus::Pending | UploadStatus::Retrying | UploadStatus::Uploading) {
                item.status = UploadStatus::Cancelled;
                return Ok(());
            }
            return Err(format!("Cannot cancel item in state: {:?}", item.status));
        }

        Err(format!("Item not found: {}", item_id))
    }

    /// Start the queue processor (runs in background)
    pub async fn start_processor<F, Fut>(&self, upload_fn: F)
    where
        F: Fn(UploadQueueItem) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<String, String>> + Send + 'static,
    {
        let state = self.state.clone();
        let is_processing = self.is_processing.clone();

        tokio::spawn(async move {
            loop {
                // Check if already processing
                {
                    let mut processing = is_processing.lock().await;
                    if *processing {
                        sleep(Duration::from_millis(100)).await;
                        continue;
                    }
                    *processing = true;
                }

                // Get next item to process
                let (item_id, item) = {
                    let mut state_write = state.write().await;
                    let item_to_process = state_write.items.iter_mut()
                        .find(|i| matches!(i.status, UploadStatus::Pending | UploadStatus::Retrying));

                    if let Some(item) = item_to_process {
                        // Check if it's time to retry
                        if item.status == UploadStatus::Retrying {
                            if let Some(next_retry) = &item.next_retry_at {
                                if let Ok(next_time) = chrono::DateTime::parse_from_rfc3339(next_retry) {
                                    let now = chrono::Utc::now();
                                    if next_time > now {
                                        // Not time yet, skip
                                        drop(state_write);
                                        *is_processing.lock().await = false;
                                        sleep(Duration::from_secs(1)).await;
                                        continue;
                                    }
                                }
                            }
                        }

                        // Clone the ID before modifying the item
                        let item_id = item.id.clone();

                        // Mark as uploading
                        item.status = UploadStatus::Uploading;
                        item.started_at = Some(chrono::Utc::now().to_rfc3339());
                        item.progress = 0;

                        let item_clone = item.clone();

                        // Now set current_upload_id after we're done with item
                        state_write.current_upload_id = Some(item_id.clone());

                        (item_id, item_clone)
                    } else {
                        // No items to process
                        drop(state_write);
                        *is_processing.lock().await = false;
                        sleep(Duration::from_millis(500)).await;
                        continue;
                    }
                };

                // Process the upload
                let result = timeout(
                    Duration::from_secs(item.timeout_secs as u64),
                    upload_fn(item.clone())
                ).await;

                // Update state based on result
                {
                    let mut state_write = state.write().await;

                    if let Some(queue_item) = state_write.items.iter_mut().find(|i| i.id == item_id) {
                        match result {
                            Ok(Ok(_drive_file_id)) => {
                                // Success
                                queue_item.status = UploadStatus::Completed;
                                queue_item.progress = 100;
                                queue_item.completed_at = Some(chrono::Utc::now().to_rfc3339());
                            }
                            Ok(Err(err)) => {
                                // Upload failed
                                queue_item.error = Some(err.clone());

                                if queue_item.can_retry() {
                                    queue_item.increment_retry();
                                    queue_item.status = UploadStatus::Retrying;

                                    // Calculate exponential backoff: 2^retry_count seconds, max 60 seconds
                                    let backoff_secs = (2u64.pow(queue_item.retry_count.min(6))).min(60);
                                    let next_retry = chrono::Utc::now() + chrono::Duration::seconds(backoff_secs as i64);
                                    queue_item.next_retry_at = Some(next_retry.to_rfc3339());
                                } else {
                                    queue_item.status = UploadStatus::Failed;
                                    queue_item.completed_at = Some(chrono::Utc::now().to_rfc3339());
                                }
                            }
                            Err(_) => {
                                // Timeout
                                queue_item.error = Some("Upload timed out".to_string());

                                if queue_item.can_retry() {
                                    queue_item.increment_retry();
                                    queue_item.status = UploadStatus::Retrying;

                                    let backoff_secs = (2u64.pow(queue_item.retry_count.min(6))).min(60);
                                    let next_retry = chrono::Utc::now() + chrono::Duration::seconds(backoff_secs as i64);
                                    queue_item.next_retry_at = Some(next_retry.to_rfc3339());
                                } else {
                                    queue_item.status = UploadStatus::Failed;
                                    queue_item.completed_at = Some(chrono::Utc::now().to_rfc3339());
                                }
                            }
                        }
                    }

                    state_write.current_upload_id = None;
                }

                // Release processing lock
                *is_processing.lock().await = false;

                // Small delay before processing next item
                sleep(Duration::from_millis(100)).await;
            }
        });
    }
}

impl Default for UploadQueue {
    fn default() -> Self {
        Self::new()
    }
}
