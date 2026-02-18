use super::types::UploadQueueItem;
use super::queue::UploadQueue;
use tauri::State;
use std::sync::Arc;

/// Global upload queue instance
pub struct UploadQueueStateWrapper {
    pub queue: Arc<UploadQueue>,
}

/// Add items to the upload queue
#[tauri::command]
pub async fn enqueue_upload_items(
    items: Vec<UploadQueueItem>,
    state: State<'_, UploadQueueStateWrapper>,
) -> Result<(), String> {
    state.queue.enqueue_batch(items).await
}

/// Get upload queue state for a session
#[tauri::command]
pub async fn get_session_upload_queue(
    session_id: String,
    state: State<'_, UploadQueueStateWrapper>,
) -> Result<Vec<UploadQueueItem>, String> {
    Ok(state.queue.get_session_items(&session_id).await)
}

/// Get overall queue statistics
#[tauri::command]
pub async fn get_upload_queue_stats(
    state: State<'_, UploadQueueStateWrapper>,
) -> Result<super::types::UploadQueueStats, String> {
    Ok(state.queue.get_stats().await)
}

/// Retry a failed upload
#[tauri::command]
pub async fn retry_upload(
    item_id: String,
    state: State<'_, UploadQueueStateWrapper>,
) -> Result<(), String> {
    state.queue.retry_item(&item_id).await
}

/// Cancel an upload
#[tauri::command]
pub async fn cancel_queued_upload(
    item_id: String,
    state: State<'_, UploadQueueStateWrapper>,
) -> Result<(), String> {
    state.queue.cancel_item(&item_id).await
}

/// Remove all upload items for a session (when session is deleted)
#[tauri::command]
pub async fn remove_session_uploads(
    session_id: String,
    state: State<'_, UploadQueueStateWrapper>,
) -> Result<(), String> {
    state.queue.remove_session_items(&session_id).await;
    Ok(())
}
