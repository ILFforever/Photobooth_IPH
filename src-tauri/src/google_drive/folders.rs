use crate::state::{AppState, DriveFolder};
use google_drive3::{api::File, DriveHub};
use tauri::State;

#[tauri::command]
pub async fn list_drive_folders(
    state: State<'_, AppState>,
    parent_id: Option<String>,
) -> Result<Vec<DriveFolder>, String> {
    let auth = {
        let auth_guard = state.auth.lock().unwrap();
        auth_guard.as_ref().ok_or("Not logged in")?.clone()
    };

    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|e| format!("HTTPS error: {}", e))?
        .https_or_http()
        .enable_http1()
        .build();

    let client = hyper::Client::builder().build(https);
    let hub = DriveHub::new(client, auth);

    let mut all_items = Vec::new();

    if let Some(pid) = parent_id {
        let query = format!(
            "'{}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
            pid
        );
        let result = hub
            .files()
            .list()
            .q(&query)
            .supports_all_drives(true)
            .include_items_from_all_drives(true)
            .param("fields", "files(id, name)")
            .doit()
            .await;

        if let Ok(res) = result {
            if let Some(files) = res.1.files {
                for file in files {
                    if let (Some(id), Some(name)) = (file.id, file.name) {
                        all_items.push(DriveFolder {
                            id,
                            name,
                            is_shared_drive: false,
                        });
                    }
                }
            }
        }
    } else {
        let drives_result = hub.drives().list().doit().await;
        if let Ok(res) = drives_result {
            if let Some(drives) = res.1.drives {
                for drive in drives {
                    if let (Some(id), Some(name)) = (drive.id, drive.name) {
                        all_items.push(DriveFolder {
                            id,
                            name,
                            is_shared_drive: true,
                        });
                    }
                }
            }
        }

        let root_result = hub
            .files()
            .list()
            .q("'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false")
            .doit()
            .await;

        if let Ok(res) = root_result {
            if let Some(files) = res.1.files {
                for file in files {
                    if let (Some(id), Some(name)) = (file.id, file.name) {
                        all_items.push(DriveFolder {
                            id,
                            name,
                            is_shared_drive: false,
                        });
                    }
                }
            }
        }
    }

    all_items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(all_items)
}

#[tauri::command]
pub async fn create_drive_folder(
    folder_name: String,
    parent_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<DriveFolder, String> {
    let auth = {
        let auth_guard = state.auth.lock().unwrap();
        auth_guard.as_ref().ok_or("Not logged in")?.clone()
    };

    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|e| format!("HTTPS error: {}", e))?
        .https_or_http()
        .enable_http1()
        .build();

    let client = hyper::Client::builder().build(https);
    let hub = DriveHub::new(client, auth);

    let mut folder_metadata = File {
        name: Some(folder_name.clone()),
        mime_type: Some("application/vnd.google-apps.folder".to_string()),
        ..Default::default()
    };

    if let Some(pid) = parent_id {
        folder_metadata.parents = Some(vec![pid]);
    }

    let empty_body: &[u8] = &[];
    let (_response, created_folder) = hub
        .files()
        .create(folder_metadata)
        .supports_all_drives(true)
        .upload(
            std::io::Cursor::new(empty_body),
            "application/vnd.google-apps.folder".parse().unwrap(),
        )
        .await
        .map_err(|e| format!("Failed to create folder: {}", e))?;

    Ok(DriveFolder {
        id: created_folder.id.ok_or("No ID")?,
        name: folder_name,
        is_shared_drive: false,
    })
}

#[tauri::command]
pub async fn set_root_folder(
    folder: DriveFolder,
    state: State<'_, AppState>,
) -> Result<(), String> {
    *state.root_folder.lock().unwrap() = Some(folder);
    Ok(())
}

#[tauri::command]
pub async fn get_root_folder(state: State<'_, AppState>) -> Result<Option<DriveFolder>, String> {
    Ok(state.root_folder.lock().unwrap().clone())
}

#[tauri::command]
pub async fn delete_drive_folder(
    folder_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let auth = {
        let auth_guard = state.auth.lock().unwrap();
        auth_guard.as_ref().ok_or("Not logged in")?.clone()
    };

    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|e| format!("HTTPS error: {}", e))?
        .https_or_http()
        .enable_http1()
        .build();

    let client = hyper::Client::builder().build(https);
    let hub = DriveHub::new(client, auth);

    hub.files()
        .delete(&folder_id)
        .supports_all_drives(true)
        .doit()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
