use super::queue::UploadQueue;
use super::types::UploadQueueItem;
use std::sync::Arc;
use tauri::AppHandle;

/// Initialize and start the upload queue processor
#[allow(dead_code)]
pub fn start_upload_queue_processor(
    queue: Arc<UploadQueue>,
    app_handle: AppHandle,
) {
    println!("🚀 Starting upload queue processor...");

    tauri::async_runtime::spawn(async move {
        queue.set_app_handle(app_handle.clone()).await;
        start_upload_queue_processor_with_queue(queue, app_handle);
    });
}

/// Internal function to start processor with queue that already has app handle set
pub fn start_upload_queue_processor_with_queue(
    queue: Arc<UploadQueue>,
    app_handle: AppHandle,
) {
    println!("🚀 Starting upload queue processor (lazy)...");

    tauri::async_runtime::spawn(async move {
        // Define the upload function that will process each queue item
        let upload_fn = move |item: UploadQueueItem| {
            let app = app_handle.clone();

            // Return an async closure that returns Result<String, String>
            async move {
                // Call the internal upload function directly
                use crate::google_drive::queue_upload::upload_photo_to_drive_internal;

                match upload_photo_to_drive_internal(
                    item.local_path.clone(),
                    item.drive_folder_id.clone(),
                    app.clone(),
                ).await {
                    Ok(drive_file_id) => {
                        // Track the uploaded image in session metadata
                        // Parse working folder and session ID from local_path
                        // Expected format: {working_folder}/{session_id}/{filename}
                        if let Some(working_folder) = item.local_path.rsplit_once('/').or_else(|| item.local_path.rsplit_once('\\')) {
                            if let Some(session_id_part) = working_folder.0.rsplit_once('/').or_else(|| working_folder.0.rsplit_once('\\')) {
                                let session_id = session_id_part.1;
                                let folder_path = session_id_part.0;

                                println!("📝 Tracking upload: folder={}, session={}, file={}", folder_path, session_id, item.filename);

                                // Add to session's uploaded images list
                                if let Err(e) = crate::photobooth_sessions::add_session_drive_upload(
                                    folder_path.to_string(),
                                    session_id.to_string(),
                                    item.filename.clone(),
                                    drive_file_id.clone(),
                                ).await {
                                    println!("⚠️  Failed to track uploaded image in session metadata: {}", e);
                                } else {
                                    println!("✅ Upload tracked in session metadata");
                                }
                            }
                        }

                        Ok(drive_file_id)
                    }
                    Err(e) => Err(e)
                }
            }
        };

        // Start the queue processor (this is async and spawns its own task)
        queue.start_processor(upload_fn).await;

        println!("📡 Upload queue processor started (lazy)");
    });
}
